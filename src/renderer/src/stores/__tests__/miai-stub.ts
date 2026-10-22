/**
 * 假的 `window.miai`：把错题本的几次 IPC 调用**如实**记下来，供测试断言。
 *
 * 【为什么单独一个文件】
 * 两个测试文件都要它（会话记账、真跑题型的记账）。各写一份的话，
 * "假 IPC 到底多真"这件事就有了两份标准 —— 而这里最要紧的恰恰是**它有多真**：
 * 下面那个 `structuredClone` 不是装饰。
 *
 * 【为什么必须用真的结构化克隆】
 * 真 IPC 的守门员就是结构化克隆：渲染进程塞一个响应式代理（Vue 的 ref 代理）
 * 进来，它会当场抛。而那个抛错会被 `finish()` 里的 catch 吞掉 ——
 * 表现是「错题一条都没记上」而界面一切正常，一句报错都没有。
 * 项目在这个坑上栽过三次，所以替身**必须带着这个守门员**，
 * 否则测试会放行一个真机上必然失败的载荷。
 *
 * 【2026-09-29 学习闭环】加了 `updateWrongbook`（软删/恢复/标漏洞）、
 * `recordWrongbook` 的**返回值**（复活名单）、以及让 update **失败**的开关
 * （`failUpdate` —— 失败那条路上的界面行为也要有单测，不然它永远没人验）。
 * 替身**不重实现 merge**（那是主进程纯函数的活，有它自己的单测）——
 * 它只做三件事：记录调用、返回测试**点名要的那个值**、按开关拒绝。
 * 返回值不可配置的话，「删过又答错弹提示」这条链在渲染层就永远只能测到"没弹"。
 *
 * 【2026-09-30】又加了 `recordPractice`。不是"为了新功能补一个方法"——
 * `finish()` 现在每次收工都会调它，替身少了这个方法，**所有走完一局的用例
 * 都会在收工那一刻炸**（`window.miai.recordPractice is not a function`），
 * 而报错长得像业务 bug。所以它不是可选项，是这套替身跟上生产代码的必要一步。
 *
 * 【2026-10-01】再加 `failRecord` / `failClear`：记错 / 消除两条链各自的
 * 失败开关（照 `failUpdate` 的先例）。对抗复核抓到"收录失败被空 catch
 * 静默吞掉、去重表还把重试挡在门外"，修法是失败回滚 + 收尾重试 ——
 * 这条修复全靠"让 record 失败一次"才测得出来。
 * 开关是可变字段：用例可以中途 `log.failRecord = false`，验"重试成功"。
 *
 * 【2026-10-08（P3 ②）】加 `memo`（`memo.get` / `memo.save`）：
 * 备忘 store 在 setup 里就 `void load()` 去读档，这个替身少了那个口，
 * 建立 store 的那行就是一条 unhandled rejection（报错还长得像业务 bug）。
 * 三个可配位照老规矩：**内容可配**（`memoExisting`，测"读回来的是我的笔记"）、
 * **失败可开**（`failMemoSave`，测"存不上时界面怎么说话"）、
 * **载荷如实记录**（`memoSaved`，已克隆 —— 备忘录的落盘断言看它）。
 *
 * 【2026-10-08（P3 ①）】加 `checkinSubmit`：progress store 的 `checkInToday()`
 * 走它。三个可配位同上：`checkinResult`（断言"换上的是主进程返回的那份"）、
 * `failCheckin`（写盘失败那条 toast）、`checkinCalls`（断言签的是哪个日键 ——
 * 「第二次 false」「跨月 streak=2」这些时序用例全靠注入日键，见 progress.test.ts）。
 *
 * 【2026-10-08（P3 ④）】加 `petEvent`：学习收工事件（挑战完成 / 复习满分）
 * 的上报口。它没有返回值也不是 Promise（单向 send），所以替身只需要一个
 * 如实记录的数组（`petEventCalls`）—— 「什么时候发、发了几次」正是
 * 好感度判据要钉的东西（少发 = 白学，多发 = 一次收工记两遍）。
 *
 * 【2026-10-08（P3 ④）二笔】再补 `petInit` / `petAct` / `onPetState`：
 * 桌宠镜像 store（stores/pet.ts）的轮询器判据全靠**数 petInit 被调了几次**
 * （5s 一拍 / 停表 / 退订幂等，没有别的读数验得了），快照形状取自
 * shared/pet.ts 的真构造器（手写字段表 = 形状漂了先在替身上假红）。
 * `onPetState` 收下订阅回调：用例可推一条广播，验"镜像跟着广播走"。
 *
 * 【2026-10-11（P10.6）读写口翻成带戳信封】`getProfile` 回 `{data, stamp}`、
 * `saveProfile` 收 `stamp` 回 `DocWriteResult`、`memo.get/save` 同款、
 * `checkinResult` 带上 `stamp` —— 形状照 shared/doc-write.ts。
 * ⚠️ `saveProfile` 原来回的是 `Promise.resolve()`（undefined）：新写协议下
 * `res.ok` 是 falsy，会被当成**冲突**走重载重放（adopt(undefined) 把档案
 * 重置回空档）—— 静默的假绿/假红都从这里来，所以返回值必须是真形状。
 *
 * 【2026-10-16（V1-38 每日一次 + 满池不空弹）】加 `grantReward`：奖励 store
 * 按主进程回话的 kind 三分支（granted 弹窗 / daily-limit 与 full 各说一句话），
 * 三条路都要能测。三个可配位照老规矩：**内容可配**（`grantResult`：回哪种 kind、
 * 换哪份 rewards）、**失败可开**（`failGrant`：记账失败那条 toast）、
 * **调用如实记录**（`grantCalls`：渲染层抽的是哪张 id；`grantPerfects`：这一轮
 * 是不是全对 —— 2026-10-17 起发图不看分数，但全对旗仍要真的送到主进程）。
 * 裁决本身（每日一次 / 满池判定）**不在这里重实现** —— 那是 shared/gallery.ts
 * 纯函数的活，有它自己的单测；替身只回答"主进程说了什么"，返回克隆。
 */
import { defaultPetState, snapshotOf, type PetAction, type PetSnapshot } from '../../../../shared/pet'
import {
  CURRENT_MEMO_VERSION,
  DEFAULT_PROFILE,
  type CheckinSubmitResult,
  type MemoFile,
  type PracticeFile,
  type PracticeRecordInput,
  type ProfileRewards,
  type UserProfile,
  type WrongBookEntry,
  type WrongRecordItem,
  type WrongUpdateItem
} from '../../../../shared/types'
import type { BoxStamp, DocWriteResult, StampedDoc } from '../../../../shared/doc-write'
import type { RewardGrantKind } from '../../../../shared/gallery'

export interface MiaiLog {
  /** 每次 `recordWrongbook` 收到的载荷（已克隆，等同于真 IPC 会看到的） */
  recorded: WrongRecordItem[][]
  /** 每次 `clearWrongbook` 收到的 key 清单 */
  cleared: string[][]
  /** 每次 `updateWrongbook` 收到的 patch 清单 */
  updates: WrongUpdateItem[][]
  /** 每次 `recordPractice` 收到的载荷（已克隆）—— 练习史记账的断言看它 */
  practice: PracticeRecordInput[]
  /** `recordWrongbook` 下一次要返回的复活名单（默认空数组） */
  revived: string[]
  /** `updateWrongbook` 下一次要返回的新列表（默认空数组） */
  updateResult: WrongBookEntry[]
  /** 让 `updateWrongbook` 直接 reject —— 测「失败了界面怎么办」那条路 */
  failUpdate: boolean
  /** 让 `recordWrongbook` 直接 reject —— 测「记错失败回滚 + 收尾重试」（可变：中途改回 false 验重试成功） */
  failRecord: boolean
  /** 让 `clearWrongbook` 直接 reject —— 测「消除失败回滚 + 收尾重试」 */
  failClear: boolean
  /** 每次 `memo.save` 收到的载荷（已克隆）—— 备忘录的落盘断言看它 */
  memoSaved: MemoFile[]
  /** `memo.get` 下一次返回什么（默认**空表**，见 window.miai 里那段注释） */
  memoExisting: MemoFile
  /** 让 `memo.save` 直接 reject —— 测「存不上时界面怎么说话」 */
  failMemoSave: boolean
  /** 每次 `checkinSubmit` 收到的日键（P3 ①）—— 断言"签的是哪天"看它 */
  checkinCalls: string[]
  /** `checkinSubmit` 下一次返回什么（默认：签到成功、发了饭、checkin 取自默认档案） */
  checkinResult: CheckinSubmitResult
  /** 让 `checkinSubmit` 直接 reject —— 测「写盘失败时界面怎么说话」那条路 */
  failCheckin: boolean
  /** 每次 `petEvent` 收到的 kind（P3 ④）—— 断言"收工事件发没发、发了几次"看它 */
  petEventCalls: ('challenge' | 'review')[]
  /** 每次 `petInit` 被调用（P3 ④ 轮询器判据的读数：5s 一拍就 +1） */
  petInitCalls: number
  /** `petInit` 下一次返回的快照（默认 = 真形状的 50 分档，见 stubs 尾部注释） */
  petSnapshot: PetSnapshot
  /** 每次 `petAct` 收到的动作（断言"动作真的送出去了"看它） */
  petActCalls: PetAction[]
  /** `petAct` 之后返回的快照（默认与 `petSnapshot` 同一份） */
  petActResult: PetSnapshot
  /** `onPetState` 被订阅了几次（init 里的 subscribed 守卫：应为 1） */
  petStateSubs: number
  /** 订阅回调们（用例推一条广播：`log.petStateListeners[0](snap)`） */
  petStateListeners: ((s: PetSnapshot) => void)[]
  /** 每次 `grantReward` 收到的 id（V1-38：断言"渲染层抽的是哪张"看它） */
  grantCalls: (string | null)[]
  /** 每次 `grantReward` 收到的 perfect 旗（2026-10-17：发图不看分数，全对只影响台账） */
  grantPerfects: boolean[]
  /** `grantReward` 下一次返回什么（默认：granted、空图鉴、零戳） */
  grantResult: { rewards: ProfileRewards; stamp: BoxStamp; kind: RewardGrantKind }
  /** 让 `grantReward` 直接 reject —— 测「记账失败就不庆祝」那条路 */
  failGrant: boolean
}

export function stubMiai(
  init?: Partial<
    Pick<
      MiaiLog,
      | 'revived'
      | 'updateResult'
      | 'failUpdate'
      | 'failRecord'
      | 'failClear'
      | 'memoExisting'
      | 'failMemoSave'
      | 'checkinResult'
      | 'failCheckin'
      | 'petSnapshot'
      | 'petActResult'
      | 'grantResult'
      | 'failGrant'
    >
  >
): MiaiLog {
  /** 主进程侧的写计数（写成功 +1）—— 戳转发链在这个替身里的底座（P10.6） */
  let rev = 0
  const stampNow = (): BoxStamp => ({ epoch: 0, rev })
  const log: MiaiLog = {
    recorded: [],
    cleared: [],
    updates: [],
    practice: [],
    revived: [],
    updateResult: [],
    failUpdate: false,
    failRecord: false,
    failClear: false,
    memoSaved: [],
    memoExisting: { version: CURRENT_MEMO_VERSION, items: [] },
    failMemoSave: false,
    checkinCalls: [],
    // 默认那份 = 「第一次签到成功、饭也发到了」——用默认档案的 checkin 形状当底座，
    // 形状只有 shared/types.ts 一份真源；用例要别的状态就在 init 里整体替换
    checkinResult: {
      ok: true,
      awarded: true,
      // 默认这份不是断签（空转[2]）：用例要演"断签了"就在 init 里整体换一份
      // 带 streakReset: true 的（形状只有 shared/types.ts 一份真源）
      streakReset: false,
      checkin: structuredClone(DEFAULT_PROFILE.checkin),
      riceGranted: true,
      riceCredited: 2,
      // 签到是主进程 RMW，回包必带现戳（P10.6；形状照 shared/types.ts 的字段注释）
      stamp: { epoch: 0, rev: 0 }
    },
    failCheckin: false,
    petEventCalls: [],
    petInitCalls: 0,
    // 快照底座用真构造器造（不手写字段表：形状漂了这条替身先红）
    petSnapshot: snapshotOf(
      defaultPetState(new Date(2026, 9, 6, 12, 0, 0).toISOString()),
      new Date(2026, 9, 6, 12, 0, 0).toISOString()
    ),
    petActCalls: [],
    petActResult: snapshotOf(
      defaultPetState(new Date(2026, 9, 6, 12, 0, 0).toISOString()),
      new Date(2026, 9, 6, 12, 0, 0).toISOString()
    ),
    petStateSubs: 0,
    petStateListeners: [],
    grantCalls: [],
    grantPerfects: [],
    // 默认那份 = 「granted、还没收集到任何一张」——rewards 底座用默认档案的
    // （形状只有 shared/types.ts 一份真源）；用例要别的 kind 就整体替换
    grantResult: {
      rewards: structuredClone(DEFAULT_PROFILE.rewards),
      stamp: { epoch: 0, rev: 0 },
      kind: 'granted'
    },
    failGrant: false
  }
  if (init?.revived) log.revived = init.revived
  if (init?.updateResult) log.updateResult = init.updateResult
  if (init?.failUpdate) log.failUpdate = true
  if (init?.failRecord) log.failRecord = true
  if (init?.failClear) log.failClear = true
  if (init?.memoExisting) log.memoExisting = init.memoExisting
  if (init?.failMemoSave) log.failMemoSave = true
  if (init?.checkinResult) log.checkinResult = init.checkinResult
  if (init?.failCheckin) log.failCheckin = true
  if (init?.petSnapshot) log.petSnapshot = init.petSnapshot
  if (init?.petActResult) log.petActResult = init.petActResult
  if (init?.grantResult) log.grantResult = init.grantResult
  if (init?.failGrant) log.failGrant = true
  ;(globalThis as unknown as { window: unknown }).window = {
    /*
     * 假 window 也得**像个 window**：progress store 在 setup 里就
     * `window.addEventListener('beforeunload', flush)`（progress.ts:99），
     * 少了这一对，凡是牵连到内容 store（→ progress）的测试**连 store 都建不起来**，
     * 报错还长得像业务 bug。不记录、不回放 —— 要测"关窗口刷存"的是
     * progress.test.ts 自己的替身（它记得比这里细）。
     */
    addEventListener: () => {},
    removeEventListener: () => {},
    /*
     * 定时器两口（P3 ④）：桌宠镜像 store 的轮询器走 `window.setInterval`。
     * 假 window 不给这两口，`ensurePetPoller` 第一行就是 `not a function` ——
     * 同上面 addEventListener 的教训：假 window 也得像个 window。
     * **调用时才转发**到 globalThis（不是建 window 时抄一份函数引用）：
     * vi.useFakeTimers() 换的是 globalThis 上那套，抄引用会漏掉假表。
     */
    setInterval: (fn: () => void, ms?: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number) => globalThis.clearInterval(id),
    miai: {
      /*
       * 错题本相关（被测的重点）
       */
      recordWrongbook: (items: WrongRecordItem[]) => {
        log.recorded.push(structuredClone(items))
        // 注意顺序：**先记录再拒绝** —— `recorded` 记的是"这一批发出去过"，
        // 不是"主进程收下了"。测重试用的正是"发过两次"这个事实
        if (log.failRecord) return Promise.reject(new Error('stub: record failed'))
        // 返回的是**克隆**：真 IPC 的返回值也是克隆过的，
        // 让测试能对返回值做原地修改而不会波及 log 里那份
        return Promise.resolve(structuredClone(log.revived))
      },
      clearWrongbook: (keys: string[]) => {
        log.cleared.push(structuredClone(keys))
        if (log.failClear) return Promise.reject(new Error('stub: clear failed'))
        return Promise.resolve()
      },
      updateWrongbook: (updates: WrongUpdateItem[]) => {
        log.updates.push(structuredClone(updates))
        if (log.failUpdate) return Promise.reject(new Error('stub: update failed'))
        return Promise.resolve(structuredClone(log.updateResult))
      },
      getWrongbook: () => Promise.resolve([]),
      recordPractice: (input: PracticeRecordInput) => {
        log.practice.push(structuredClone(input))
        // 回的是**新的整份练习史**（真 IPC 就这么回的）。这里给个最小合法形状：
        // 渲染层现在不读它，但"回一个 undefined"会让将来第一个读它的人
        // 在真机上才第一次见到真形状 —— 替身的返回值也该是真的。
        const file: PracticeFile = { version: 1, history: [] }
        return Promise.resolve(file)
      },
      /*
       * 大肥鱼备忘录（P3 ②）。默认回**空表**而不是 null：真 IPC 的
       * `memo:get` 永远回一份完整的文件（主进程读口把 null/坏文件翻成空表），
       * 替身要跟真形状一致 —— 回 null 的话，测"读档"的用例其实在测一条
       * 真机上不存在的路。
       */
      memo: {
        get: (): Promise<StampedDoc<MemoFile>> =>
          Promise.resolve({ data: structuredClone(log.memoExisting), stamp: stampNow() }),
        save: (file: MemoFile, _stamp?: BoxStamp | null): Promise<DocWriteResult<MemoFile>> => {
          // 先记录再拒绝（同 recordWrongbook）：记的是"这一批发出去过"
          log.memoSaved.push(structuredClone(file))
          if (log.failMemoSave) return Promise.reject(new Error('stub: memo save failed'))
          rev += 1
          return Promise.resolve({ ok: true, stamp: stampNow() })
        }
      },
      /*
       * 每日签到（P3 ①）。三个可配位照老规矩：**内容可配**（checkinResult）、
       * **失败可开**（failCheckin）、**调用如实记录**（checkinCalls）。
       * 返回值给的是**克隆**：真 IPC 的回包也是克隆过的 —— 用例可以对返回值
       * 做原地修改而不会波及 log 里那份配置。
       */
      checkinSubmit: (day: string) => {
        // 先记录再拒绝（同 recordWrongbook）：记的是"这一下发出去过"
        log.checkinCalls.push(day)
        if (log.failCheckin) return Promise.reject(new Error('stub: checkin failed'))
        return Promise.resolve(structuredClone(log.checkinResult))
      },
      /*
       * 桌宠镜像（P3 ④ 轮询器）。petInit **如实计数** —— 「5s 一拍/停表/
       * 退订幂等」的判据全靠它；返回值走结构化克隆（真 IPC 同款守门员）。
       */
      petInit: () => {
        log.petInitCalls += 1
        return Promise.resolve(structuredClone(log.petSnapshot))
      },
      petAct: (action: PetAction) => {
        log.petActCalls.push(action)
        return Promise.resolve(structuredClone(log.petActResult))
      },
      onPetState: (cb: (s: PetSnapshot) => void) => {
        log.petStateSubs += 1
        log.petStateListeners.push(cb)
      },
      /*
       * 学习收工事件（P3 ④ 好感度）。单向 send，无返回值 —— 如实记下 kind，
       * 断言侧只看这个数组（"该发的发了、不该发的一次都没有"）。
       */
      petEvent: (kind: 'challenge' | 'review') => {
        log.petEventCalls.push(kind)
      },
      /*
       * 发奖励图（学习闭环 §7 / V1-38 每日一次；2026-10-17 起不看分数）。
       * 三个可配位照老规矩：**内容可配**（grantResult —— 三种 kind 各测一条）、
       * **失败可开**（failGrant —— "记账失败就不庆祝"那条 toast）、
       * **调用如实记录**（grantCalls 记 id、grantPerfects 记全对旗）。
       * 裁决本身（每日一次 / 满池判定）**不在这里重实现**：那是
       * shared/gallery.ts 纯函数的活、有它自己的单测；替身只回答
       * "主进程说了什么"，返回克隆（真 IPC 同款守门员）。
       */
      grantReward: (id: string | null, perfect: boolean) => {
        // 先记录再拒绝（同 recordWrongbook）：记的是"这一下发出去过"
        log.grantCalls.push(id)
        log.grantPerfects.push(perfect)
        if (log.failGrant) return Promise.reject(new Error('stub: grant failed'))
        return Promise.resolve(structuredClone(log.grantResult))
      },
      /*
       * 顺带把档案口也给上：内容 store → progress store 是**连带实例化**的
       * （content.ts 里 useProgressStore()），它 setup 时会 `void load()`
       * 去读档案。不给这个方法就是一条 unhandled rejection ——
       * 测试照样"绿"，但 vitest 会把它记成整个文件的问题。
       * 返回 null = 首次运行（progress 的空档默认值），正是这些用例想要的。
       * 读口回信封、写口回 DocWriteResult（P10.6 的带戳形状，见文件头）。
       */
      getProfile: (): Promise<StampedDoc<UserProfile | null>> =>
        Promise.resolve({ data: null, stamp: stampNow() }),
      saveProfile: (
        _profile: UserProfile,
        _stamp?: BoxStamp | null
      ): Promise<DocWriteResult<UserProfile | null>> => {
        rev += 1
        return Promise.resolve({ ok: true, stamp: stampNow() })
      }
    }
  }
  return log
}

/** 记录过的 key 清单（摊平所有批次） */
export function recKeys(log: MiaiLog): string[] {
  return log.recorded.flat().map((it) => it.key)
}

/** 某次记录里那条的**题目本体**。内置题应该是 undefined（不存第二份真源） */
export function recBody(
  log: MiaiLog,
  key: string
): WrongRecordItem['ai'] | undefined {
  return log.recorded.flat().find((it) => it.key === key)?.ai
}
