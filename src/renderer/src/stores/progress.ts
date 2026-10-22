/**
 * 学习进度 store：已学/收藏/学习历史。
 * M3-04 接入主进程 profile.json 持久化（json-store 原子写）：启动加载 + 变更防抖落盘 + 退出冲刷。
 *
 * 【⚠️ 保存必须走 `toIpc()`，不能裸 `structuredClone()`】
 * 这里踩过一个从 M3 一直潜伏到 M6 的 bug：保存时写的是
 * `structuredClone(profile.value)`，而 `profile.value` 是 **reactive 代理**，
 * `structuredClone` **克隆不了代理**，会当场同步抛
 * `#<Object> could not be cloned`。
 *
 * 后果是**学习进度从来没写进过硬盘**：防抖那条路 `.catch(() => {})` 把错吞了，
 * 退出冲刷那条路在 `beforeunload` 里抛错也没人接 —— 两条路都一声不吭，
 * 表现是「学了一晚上，关掉应用再打开，进度归零」。
 *
 * `toIpc()` = `structuredClone(toRaw(v))`：先用 `toRaw` 把代理揭开、拿到原始对象
 * 再克隆。这个坑项目里已经踩过第四次了（settings 的 save、challenge 的 terms、
 * 挑战记账），统一入口在 lib/ipc-safe.ts。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { playSfx } from '../lib/sfx'
import { grantPetRice } from '../lib/pet-bridge'
import { DEFAULT_PROFILE, type UserProfile } from '../../../shared/types'
import { toIpc } from '../lib/ipc-safe'
import { today } from '../lib/day-clock'
import { todayKey } from '../../../shared/dates'
import { toast } from '../components/base/toast'
import { TOAST } from '../lib/copy'
import { createDocWriter } from '../lib/doc-writer'
import { isQuizActive, onQuizIdle } from '../lib/quiz-gate'
import { notifyLocalWrite } from '../lib/local-write-bus'
import type { BoxStamp } from '../../../shared/doc-write'

/**
 * 初始档案 = **共享常量的一份深拷贝**。
 *
 * 【为什么不就地写字面量】这里原来硬编码 `version: 1` —— 档案升到 v2 之后，
 * 这个字面量不会跟着变，而防抖保存是**整份写回**的：用户在版本号还没从主进程
 * 读回来之前先点了一下收藏，写回去的就是 v1，迁移下次启动又得再跑一遍。
 * 更糟的是少字段那几版：rewards 不在 INITIAL 里，一次提前保存就把磁盘上
 * 那一节抹成了 undefined。版本号和默认形状**只能有一个定义**，在 shared/types.ts。
 */
const INITIAL: UserProfile = structuredClone(DEFAULT_PROFILE)

/** 变更后多久落盘。**导出是给测试用的**：测试里写死 300 的话，
 *  哪天这个值调大，测试会变成「等 400ms 断言保存过了」的假绿 */
export const SAVE_DEBOUNCE_MS = 300

/**
 * 本地写协议的一条变更（P10.6，docs/21 §8.2）。
 *
 * 记的是**具体变更**（谁把哪一课设成了什么），不是"当时那份完整档案"——
 * 冲突发生时主进程会回一份**更新的**档案（同步引擎刚并进云端的），
 * 重放这条变更到那份上才是对的；重放旧快照等于把云端数据又覆盖回去。
 * 全部 applyOp 都是**幂等 ensure 语义**：重放两次和一次结局相同。
 *
 * `at` 只在头一次学会时进 history（history 是追加型，重放时带上当时的
 * 时间戳，而不是"重放那一刻"—— 时间戳属于那次动作，不属于这行代码）。
 */
type ProgressOp =
  | { k: 'learned'; id: string; on: boolean; at: string }
  | { k: 'fav'; id: string; on: boolean }

export const useProgressStore = defineStore('progress', () => {
  const profile = ref<UserProfile>(structuredClone(INITIAL))

  const learnedSet = computed(() => new Set(profile.value.learned))
  const favoriteSet = computed(() => new Set(profile.value.favorites))

  // ---- 持久化：启动加载 → 变更防抖保存 → 关闭前冲刷
  let ready = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 本地写协议执行器（P10.6，docs/21 §8.2「条件写 + 重载重放 + per-doc 串行」）。
   *
   * 【它接管了什么】原来是「防抖 → 裸 saveProfile」：整份覆盖、撞上账号切换
   * 或别的写口（签到/发图/同步引擎）就整份顶掉。现在写口带 `{epoch, rev}`
   * 戳：戳对才写，对不上主进程一个字节不写并回最新数据，这台机器把最新数据
   * 装进 store、把账本（journal）在其上重放、再带新戳重写 —— **用户操作永不丢**。
   *
   * 【为什么 applyOp 和 UI 动作分开写】UI 动作带副作用（音效、发饭、toast），
   * 重放绝不能重放副作用 —— 用户答对一课的"嘎"和两碗饭只属于那一刻。
   * applyOp 是同一变更的**纯状态版本**（幂等 ensure）。
   *
   * 【F 为什么是 `UserProfile | null`】读口（readProfile）在档案还没建时
   * 回 null；写口冲突时回的 `current` 与读口同形状，所以这里也收 null
   * （adopt 收到 null = 重置回初始档，随后账本照样重放）。
   * 写侧窄一档（第三个类型参数 `W = UserProfile`，见 lib/doc-writer.ts）：
   * `snapshot()` 读的是 `profile.value`，永远是完整一份 —— null 传不进写口，
   * 这个不变量由类型担保，不在调用点上强转。
   */
  /**
   * 把主进程权威的一份装进 store（读口 / 冲突回话 / 同步重载共同走这里）。
   * learnedCount 是派生镜像：磁盘那份不一定带着正确的值（老档 / 别的写口
   * 写的），装进来就地重算，和 load 同一条口径。
   */
  function adoptProfile(data: UserProfile | null): void {
    profile.value = data ?? structuredClone(INITIAL)
    profile.value.stats.learnedCount = profile.value.learned.length
  }

  const writer = createDocWriter<UserProfile | null, ProgressOp, UserProfile>({
    save: (payload, stamp) => window.miai.saveProfile(payload, stamp),
    reload: () => window.miai.getProfile(),
    snapshot: () => toIpc(profile.value),
    adopt: adoptProfile,
    applyOp: (op) => {
      const p = profile.value
      if (op.k === 'learned') {
        const i = p.learned.indexOf(op.id)
        if (op.on && i === -1) {
          p.learned.push(op.id)
          p.history.push({ lessonId: op.id, finishedAt: op.at })
        } else if (!op.on && i !== -1) {
          p.learned.splice(i, 1)
        }
        p.stats.learnedCount = p.learned.length
        return
      }
      const arr = p.favorites
      const i = arr.indexOf(op.id)
      if (op.on && i === -1) arr.push(op.id)
      else if (!op.on && i !== -1) arr.splice(i, 1)
    },
    canResolve: () => !isQuizActive(),
    onError: () => {
      /*
       * 写失败出声（2026-10-17 夜间批）。原来这里只有一条"账本原样留着，
       * 下次变更再试"的注释：瞬时失败（写撞上冲突重载）确实能靠账本补回，
       * 但**持久失败**（磁盘满 / 只读 / 文件被锁）下一笔变更照样失败、
       * beforeunload 的 flush 还是同一个结局 —— 全程零提示。favorites.ts /
       * memo.ts 同位置都弹吐司，三份整份写文档的口径在这里对齐。
       */
      toast(TOAST.PROFILE_SAVE_FAILED, 'error')
    },
    // 写成功了 → 通知同步节拍器（防抖后触发一轮云同步，P10.6）
    onSaved: () => notifyLocalWrite('profile')
  })

  // 答题会话结束 = 安全点：会话中挂起过的冲突在这里统一「重载 → 重放 → 保存」
  onQuizIdle(() => writer.resolveNow())

  /**
   * 档案读完了没有。**这是给「读不完就不能下结论」的页面用的**。
   *
   * 【为什么必须暴露出来】
   * 加载是异步的，完成之前 `learned` 是空数组 —— 而空数组和「真的什么都没学」
   * 长得一模一样。每日挑战就是被这个坑到的：它靠 `learned` 判断「有没有题可出」，
   * 读档还没回来时会**当真地显示「先去学一课喵」**，然后在几十毫秒后自己消失。
   * 用户看到的是一个明确说错话、又自己改口的界面 —— 比转个圈难看得多。
   *
   * 有了这个标记，页面就能区分「还没读到」和「读到了，是空的」：
   * 前者等，后者才显示空状态。
   */
  const loaded = ref(false)

  async function load() {
    try {
      const env = await window.miai.getProfile()
      // 装入走 adoptProfile（与冲突重载同一条路）：数据、戳、派生字段重算
      // 只有一份实现，两处各写各的迟早漂移
      adoptProfile(env.data)
      writer.noteStamp(env.stamp)
      // 读档返回前记下的操作（启动瞬间的点击）：上面的装入可能把它顶掉，
      // 交给写协议「重载 → 重放 → 保存」收账（账本空时是零开销 no-op）
      if (writer.pendingCount() > 0) writer.resolveNow()
    } catch {
      /*
       * 读口真的失败了（主进程 IPC 抛了）：保持初始空档，但不再装没事
       * （2026-10-17 夜间批，V1-53 同款口径）。「进度全没了」和「读不出来」
       * 在界面上长得一模一样 —— 一声不吭的话，用户会以为数据被删了，接着
       * 写进去盖掉现场。首次运行不走这条：主进程读口对缺失文件回干净的空档，不抛。
       */
      toast(TOAST.STORE_READ_FAILED, 'error')
    }
    ready = true
    loaded.value = true
  }
  void load()

  function persist() {
    if (!ready) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      writer.writeNow()
    }, SAVE_DEBOUNCE_MS)
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (ready) writer.writeNow()
  }

  watch(profile, persist, { deep: true })
  window.addEventListener('beforeunload', flush)

  function markLearned(lessonId: string, learned: boolean) {
    const arr = profile.value.learned
    const i = arr.indexOf(lessonId)
    if (learned && i === -1) {
      arr.push(lessonId)
      // 同一个时间戳进两处：history 那条记录、以及写协议账本里的这条变更
      // （冲突重放时 history 用的就是它 —— 时间属于那次动作，不属于重放那一刻）
      const at = new Date().toISOString()
      /*
       * 发饭幂等（2026-10-17 夜间批）：判断必须在 history.push **之前** ——
       * 追加完再看就永远"出现过"。原口径是"每次 未学→已学 转换都发"，于是
       * 取消标记再重新标记就能在日上限内白刷一轮饭（history 会留下第二条）。
       * history 是追加型、无上限，`at` 只在头一次学会时写入 —— 所以
       * "history 里出现过这个 lessonId" ⇔ 这一课的饭**发过**，跨重启也成立。
       * （账本重放路径 applyOp 不调 grantPetRice，不受这里影响。）
       */
      const riceAlreadyGranted = profile.value.history.some((h) => h.lessonId === lessonId)
      profile.value.history.push({ lessonId, finishedAt: at })
      // 记账（P10.6）：这次变更进本地写协议账本 —— 保存失败/冲突重载时
      // 靠它把"学过这一课"重放到最新数据上
      writer.record({ k: 'learned', id: lessonId, on: true, at })
      /*
       * 学完一课 —— 正反馈音效。
       *
       * 【为什么只响在这一支，不响在 `!learned` 那一支】
       * 这个函数是**双向**的（打勾 / 取消打勾，视图上同一个按钮切来切去）。
       * 取消学习进度是"我搞错了，退回去"，不是成就，给它配一段上扬的琶音
       * 完全是反的。而 `i === -1` 这个条件正好精确圈出"**头一次**学完这一课"：
       * 已经学过的课再点一次打勾，会走 else 两个分支都不进，也就不会重复响。
       * 这一段是**唯一**一个同时满足那两个条件的位置，所以放这儿。
       */
      playSfx('lessonDone')
      /*
       * 桌宠发饭（2026-10-06 活体模式）：学完一课 = 2 碗大白饭。
       *
       * 【为什么挂在 store 里而不是 LessonDetailView 的勾选按钮上】
       * 同上面那声音效的口径（docs/04 §10.3「触发点为什么全在 store」）：
       * 触发条件是这个分支（**头一次**学完），而"头一次"只有这里算得出来 ——
       * 视图里再推一遍 `!wasLearned` 就是在第二处重新定义同一件事。
       * pet-bridge 是叶子（不import任何 store），所以这里直连不会形成环 ——
       * 依赖方向 progress → pet-bridge → 纯函数 lib，单向。
       *
       * 触发条件 = 头一次学完**且这一课从没发过饭**（`riceAlreadyGranted`
       * 见上面那段：取消再标记不重发，2026-10-17 夜间批）。
       */
      if (!riceAlreadyGranted) grantPetRice('lesson', lessonId)
    } else if (!learned && i !== -1) {
      arr.splice(i, 1)
      writer.record({ k: 'learned', id: lessonId, on: false, at: new Date().toISOString() })
    }
    profile.value.stats.learnedCount = arr.length
  }

  function toggleFavorite(lessonId: string) {
    const arr = profile.value.favorites
    const i = arr.indexOf(lessonId)
    if (i === -1) arr.push(lessonId)
    else arr.splice(i, 1)
    writer.record({ k: 'fav', id: lessonId, on: i === -1 })
  }

  // ---- 每日签到（P3 ①，2026-10-08）

  /** 档案里的签到一节（视图直接读它画月历） */
  const checkin = computed(() => profile.value.checkin)

  /**
   * 今天签过没有 —— 按钮态/月历的"今天"格子都读它。
   * 判据与主进程的发饭闸门**同一个**（今天的日键在不在 days 里）：
   * 两边若各写各的（比如这里看 lastDate），时钟回拨时会出现
   * 「按钮说今天签过了、主进程说不算数」这种互相打脸的状态。
   *
   * 【高-5，2026-10-15：读活时钟的 `today`，不再调 `todayKey()`】
   * 原来写的是 `computed(() => ...includes(todayKey()))` —— 求值函数里没有
   * 任何响应式依赖，Vue 缓存到进程结束。常驻应用开着过零点后，这个按钮
   * 一直显示"今天签过啦"（其实已是新的一天，该亮"签到"）—— 和挑战页
   * 是同一个病。`today` 是 ref（lib/day-clock.ts），跨天自己翻值。
   * 而下面 checkInToday 的**默认参数**照旧用 todayKey()：那是调用时刻
   * 现算的，本来就是活的，不需要也不该换成 ref（ref 要靠复检才跟上）。
   */
  const checkedInToday = computed(() => profile.value.checkin.days.includes(today.value))

  /** 签到在飞（2026-10-17 夜间批：按钮 disabled 绑派生值挡不住连点，见下方闸的注释） */
  let checkinInFlight = false

  /**
   * 签到（按钮与将来任何入口的**唯一**通道）。
   *
   * 【为什么本地状态只在 `res.ok === true` 时更新】主进程那条链是
   * 判重 → 写档 → 发饭：写档抛错时它**当场 throw**（catch 到就是没签上），
   * 本地跟着不标记 —— 按钮仍然可按，用户再点一次即可。
   * 而 `res.ok` 为真时，`res.checkin` 是**磁盘上刚写下的那一份**，
   * 拿它直接替换本地值，就不会出现"界面自作主张先打勾"的乐观更新
   * （乐观更新的坏处：写盘失败时打过的勾要收回来，那一下比不响应还难看）。
   *
   * 【toast 的四种出口和它们各自为什么】
   *   · awarded=false（今天已签过）：**什么也不弹**。幂等重放不是错误，
   *     用户看到的按钮本来就是"今天签过啦"；弹一句反而是噪音。
   *   · awarded 且 riceCredited > 0：成功播报（碗数取**真进盒**的
   *     riceCredited，不取名义常量 —— 半仓截断时 2 碗的宣告是假话，V1-42）。
   *   · awarded、riceCredited === 0 且 riceGranted：签到了、发饭也执行了，
   *     但饭盒满仓装不下（V1-42 / 空转[1]）—— 不是错误，但必须出声，
   *     否则用户以为饭到手了。
   *   · awarded 但 !riceGranted：签到记下了、饭没发出去（桌宠没开/宿主出错）——
   *     这句必须弹：不弹的话用户以为饭到手了，而它根本没进鱼盆。
   *
   * 【断签要说出来（空转[2]，2026-10-16）】`res.streakReset` 为真时，上面
   * 三种 awarded 出口都换成 copy 里"先说断签"的版本：大白饭照报，但明说
   * "连签断啦、从今天重新数起"。以前这条事实谁也没说 —— 用户是看着卡片
   * 从「30 天」当场变「1 天」才知道的。判定在 applyCheckin（主进程侧按
   * 接续规则现算），渲染层只转述，**不复刻规则**（抄第二份就是等它漂）。
   *
   * 【day 参数留出来是给测试的】视图调用永远不传（取本地"今天"）。
   * 跨月连签 / 时钟回拨这些时序用例靠注入日键才测得动 —— 而"今天"
   * 只能由渲染层算（主进程不知道用户时区，见 ipc-channels 的注释）。
   */
  async function checkInToday(day: string = todayKey()): Promise<boolean> {
    if (!loaded.value) return false
    /*
     * 在飞闸（2026-10-17 夜间批）：按钮的 disabled 只绑 `checkedInToday`，
     * 而它是**派生值** —— 要等回话回来才翻真，连点一下就是第二个 checkinSubmit
     * IPC（主进程日键幂等兜底得住，但白跑写盘与广播）。闸放 store 这一层：
     * 视图将来多一个签到入口也不用各记一遍。第二下返回 false 与"没签成"
     * 同形 —— 视图本来就 `void` 掉返回值、界面态等回话，无可见差异。
     */
    if (checkinInFlight) return false
    checkinInFlight = true
    try {
      const res = await window.miai.checkinSubmit(day)
      if (res && res.ok === true) {
        // 签到是主进程对档案的 RMW：写口顶掉了我们手里那份戳，拿回话里的
        // 现戳对齐 —— 不对齐的话下一次防抖保存会撞 STALE_REV 假冲突
        writer.noteStamp(res.stamp)
        profile.value.checkin = res.checkin
        // 连续天数是派生镜像，主进程已经算好写在返回值里 —— 同步过来，
        // 不然「月历多了一格、连续天数还是旧数」要等下次读档才对齐
        profile.value.stats.streakDays = res.checkin.streakDays
        // 这条写绕过了 doc-writer（直接走主进程 RMW 口）—— 它的 onSaved
        // 不会响，这里手动补一次广播，否则"签到"这份本地写对同步节拍器是隐形的
        notifyLocalWrite('profile')
        if (res.awarded === true) {
          // 成功播报是 'success'（全项目成功 toast 的统一口径），
          // "饭盒满了"与"饭没端稳"都是 'warn' —— 都不是错误（签到本身记下了），
          // 但也不是喜报
          const credited = res.riceCredited
          if (credited !== null && credited > 0) {
            toast(TOAST.CHECKIN_OK(credited, res.streakReset), 'success')
          } else if (res.riceGranted === true) {
            toast(TOAST.CHECKIN_RICE_FULL(res.streakReset), 'warn')
          } else {
            toast(TOAST.CHECKIN_RICE_FAILED(res.streakReset), 'warn')
          }
        }
        return true
      }
      return false
    } catch {
      // 写盘失败（或 IPC 本身出岔子）：本地不标记、按钮保持可按，如实说
      toast(TOAST.CHECKIN_FAILED, 'error')
      return false
    } finally {
      checkinInFlight = false
    }
  }

  /*
   * 「学习总进度」这个 computed 原来在这儿，写的是 `learned.length / 192` ——
   * 192 是主人当初手写的课数，内容涨到 229 之后它一直在撒谎（全学完只显示 84%）。
   *
   * 【为什么修法是把它**搬走**，不是把 192 换成 229】
   * 换数字治不了病：下次补内容它又开始骗人。正确的分母是
   * `content.bundle.lessons.length`，而**这个 store 读不到内容 store** ——
   * 依赖方向是 content → progress（内容的解锁要问学习进度），
   * 反过来 import 就是一条循环依赖。
   * 所以算式搬去 `lib/overview.ts` 的 `overallPercent()`（纯函数、有单测），
   * 分母由两个调用点（侧栏、总览页）各自从内容 store 取 —— **一份定义，两处用**。
   */

  return {
    profile,
    loaded,
    learnedSet,
    favoriteSet,
    markLearned,
    toggleFavorite,
    checkin,
    checkedInToday,
    checkInToday,
    flush,
    /**
     * 别的通道（发奖励图）带回的档案戳 —— 转给写协议，免得下次保存撞假冲突。
     * 签名收 BoxStamp 而不是让调用方摸 writer：执行器是 store 的内部件。
     */
    noteProfileStamp(stamp: BoxStamp) {
      writer.noteStamp(stamp)
    },
    /**
     * 外部盘面变了（同步引擎并进了云端的档案）：重载一次并按账本重放
     * （P10.6 同步节拍的安全点协调器调用）。答题会话中自动挂起，会话结束收账。
     */
    resolveExternal() {
      writer.resolveNow(true)
    },
    /** 等在飞的写全部落定（激活/登出前的干涸协议；beforeunload 来不及等，尽力） */
    whenIdle() {
      return writer.whenIdle()
    }
  }
})
