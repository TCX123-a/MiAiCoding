/**
 * 练习 store：一次练习会话（M4-01 完整流程：作答 → 即时判分 → 结果页）。
 * M4-05：错题本 —— 答错自动收录（wrongbook:record）、错题重做答对自动消除（wrongbook:clear）。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  PracticeRecordItem,
  Question,
  RunResult,
  WrongBookEntry,
  WrongRecordItem,
  WrongUpdateItem
} from '../../../shared/types'
import { gradeQuestion, isAnswered } from '../../../shared/quiz-grading'
import { initialCodeOf, isRunGraded, verdictFromRun } from '../../../shared/run-grading'
import { isAiKey, questionKey } from '../../../shared/question-key'
import { toIpc } from '../lib/ipc-safe'
import { playSfx } from '../lib/sfx'
import { grantPetRice, reportPetEvent } from '../lib/pet-bridge'
import { reportWrongAnswer } from '../lib/pet-wrong'
import { setQuizActive } from '../lib/quiz-gate'
import { notifyLocalWrite } from '../lib/local-write-bus'
import { useSettingsStore } from './settings'
import { useRewardStore } from './reward'
import { usePracticeStore } from './practice'
import { usePetStore } from './pet'
import { toast } from '../components/base/toast'
import { TOAST } from '../lib/copy'

/**
 * 练习会话的来源。
 *
 * `challenge`（每日挑战）**不是一个新界面**，只是这个枚举多了一个取值 ——
 * 答题区、判分、结果页评价全都沿用同一套代码。理由见 stores/challenge.ts 开头。
 * `extend`（延展练习）同理：它只是"从一道错题出发挑几道相关的题"这种组卷方式，
 * 界面和别的模式一模一样。
 *
 * `stage` / `lang`（阶段 / 整门综合练习）是同一回事的第三次应用：**卷子横跨多节课**，
 * 所以它不能走 `lesson` 那条"课号从会话上拿"的近路 —— 每道题的 key 得从
 * **它自己那节课**的课号拼（`lib/stage-practice.ts` 组卷时已经拼好显式传进来）。
 * 少了这一步的后果见下面 `restart()` 的注释：垃圾 key 进错题本，一声不吭。
 *
 * `review`（每日复习）是第四次：它横跨的课**更多**（按加权从学过的课里抽），
 * 而且组卷规则在 `shared/review-paper.ts`（纯函数、有单测）——
 * 这个枚举对它来说只是一个新的 mode 取值，别的什么都不用知道。
 *
 * `search`（搜索增强的微型卷，§9）是第五次：卷子从**当前这次搜索的题目命中**里组，
 * 横跨哪些课完全不定；记账三问上它和 `extend` 同档（多练一遍，不是重做）。
 * 命中规则在 `shared/search.ts` 的 `searchQuestions`（纯函数、有单测）。
 *
 * ⚠️ 新加模式时**必须显式传 keys**（`startQuiz` 的第 4 个参数）。它的缺省值
 * 是拿 `lessonId` 拼的，对哨兵课号就是 `__stage__:q1` 这种查不出题目的死键。
 */
export type QuizMode =
  | 'lesson'
  | 'random'
  | 'wrong'
  | 'challenge'
  | 'extend'
  | 'fav'
  | 'stage'
  | 'lang'
  | 'review'
  | 'search'

export interface QuizSession {
  mode: QuizMode
  lessonId: string // lesson 模式为课 id；其余为 '__random__'/'__wrong__'/'__challenge__'/'__extend__'/'__fav__'/'__stage__'/'__lang__'/'__review__'/'__search__' 这类哨兵
  /**
   * 这一局的**身份**（进程内严格递增，由 `startQuiz` 的 `++sessionSeq` 发放）。
   *
   * 【为什么必须有】真跑是异步的（真编译，几秒都可能），而**换局**这条路
   * 不关界面：搜索面板点「练相关题」、挑战页重开，都在 QuizCodeRun 还没
   * 卸载、旧 run 还在途时就换了 `session`。没有身份时 `recordRun` 只认
   * 题号，旧局同号题的结果整份落进新局 —— 学员在新题上什么都没做，
   * 输出区却出现旧题输出（2026-10-14 修，完整病灶见 recordRun 的注释）。
   *
   * 【为什么是数字】组件要把身份经 emit 交回 store（与 `:index` 同一条
   * 通道），普通数字最省心；对象引用做相等判断一旦跨过序列化边界就静默
   * 失效。递增（而非随机）保证同一进程内绝不复用 —— 复用的话，上一局的
   * 迟到结果会和这一局新发的身份撞号，钉子形同虚设。
   *
   * 【它不进存档】存档存的是"局面"（错题本/练习史各记各的）；身份只在
   * 进程内存活，重开应用从 1 重发没有任何问题（没有跨进程的迟到结果）。
   */
  sessionId: number
  questions: Question[]
  keys: string[] // 每题对应的错题本 key（wrong 模式为原错题 key）
  index: number // 当前第几题（0 起）
  answers: (string | number | null)[] // 用户作答
  checked: boolean[] // 每题是否已判分
  /**
   * 真跑题型（`codefix` / `codewrite`）**最近一次真跑的结果**，每题一格。
   * 其余题型这一格永远是 `null`。没跑过、或者学员改过代码（旧结果作废）也是 `null`。
   *
   * 【为什么必须存下来，而不是要用时再算】
   * 拿到它要**真跑一遍**（异步，几百毫秒到几十秒）。而用到判定的地方有一堆、
   * 且全在**同步**上下文里：`finish()` 的错题本记账、结果页得分、回顾页逐题对错。
   * 让它们每处都 `await` 一次真编译，既做不到（同步上下文里 await 不了），
   * 也荒唐（同一份代码被试跑三遍，每次都要几秒）。
   * 所以：**跑一次，把结果留在这儿，别处只读。**
   *
   * 【存"结果"而不是存"对错"】
   * 对错是从结果**算**出来的（`verdictFromRun()`），而且中间还有"没跑通"
   * 这第三种状态 —— 编译失败时既不算对也不算错（见 `run-grading.ts` 的说明）。
   * 存成 `boolean | null` 的话，"没跑通"和"还没跑"会挤进同一个 `null` 里，
   * 界面就没法区分「还没点过运行」和「跑了但编不过」这两件事。
   */
  runResults: (RunResult | null)[]
  /**
   * 真跑题型**这道题被判错过几次**，每题一格。其余题型这一格永远是 0。
   *
   * 只服务"自动开口"那一类（见 `REVEAL_AFTER_WRONG`）：解析卡什么时候自己冒出来
   * （`canShowExplanation`）、参考解什么时候自己弹开（`shouldAutoRevealReference`）。
   *
   * ⚠️ 它**不管**「查看猫咪解析」那个按钮了 —— 那个按钮 2026-09-22 起改成
   * "交过卷就有"，理由见 `canRevealReference`。别照着这个计数器去改它。
   *
   * **它不进存档、不进错题本** ——
   * 错题本里那个 `wrongCount` 是跨会话的累计（复习页在用），
   * 这个是**这一局里、这道题上**的挣扎次数，重开一局就该归零：
   * 上一局错两次、这一局第一次就做对的人，不该一进来就被剧透答案。
   *
   * 【为什么必须按题各记各的】
   * 一个 `number` 加在会话上的话，一局五道题里第一道错两次，
   * 后面四道的参考解会**全部**自动弹开 —— 后面那道题他还没碰过。
   */
  wrongCounts: number[]
  /**
   * 「错够次数了、参考解已经自动弹过一次」—— 每题一格。
   *
   * 【为什么必须有它，不能让界面自己看着 `wrongCounts` 弹】
   * `wrongCounts` 是个**会持续为真**的条件：错到两次之后它一直是 2，
   * 学员每再交一次（答错之后提交按钮一直是亮的，见 `canSubmit`）它就再满足一次 ——
   * 于是卡片会在**他每点一次提交时**重新弹出来，而他可能只是想再看看输出。
   * 弹过一次就记下来，「自动」这个词才只兑现一次。
   *
   * 【为什么要按题各记各的】理由同 `wrongCounts`：一个会话级的布尔值，
   * 第一题弹过之后，后面每一题一进去就会自动摊开答案。
   */
  autoRevealed: boolean[]
  /**
   * 本局**从错题本毕业**的题数（V1-26）—— 结果页那句「X 道错题毕业啦喵～」
   * 读的就是它。只有 wrong 模式会涨（答对清错题是它独有的语义，见
   * flushWrongbook 开头第 ② 问）。
   *
   * 【为什么在"写盘成功"的回话里才加】毕业是**盘上的事实**，不是"我们发过
   * 请求"。写盘失败时 catch 会把 key 回滚、收尾补账接着重试 —— 发请求时
   * 就加数的话，结果页会报一个没发生的毕业（正是本项目最忌讳的假话）。
   * 成功回话里加，还白捡一条：补账那次重试成功也如实入账。
   *
   * 【为什么是累加不是赋值】"提交即记"以后 flushWrongbook 一局里会跑多次
   * （每次提交一次 + 收尾补账一次；去重表保证同一题只算一次）。
   * 赋值会把前面几次的毕业数冲掉 —— 一局答对四道错题、分四次提交，
   * 结果页只会显示最后一批的 1。
   */
  lastCleared: number
  startedAt: string
  finishedAt: string | null
}

/**
 * 错几次之后，**我们主动**把解析/参考解摊开给他看。
 *
 * 【为什么是 2 不是 1】错一次就摊答案，这个功能就从"练习"变成了"抄写"。
 * 第一次错是**信息**（他知道自己错了，还有机会自己找出来），
 * 第二次错说明他**真的卡住了** —— 这时候再不给，他只会关掉软件。
 * 这个数字的取舍写在 `docs/04` 的"先让学员自己挣扎一下"那条下面。
 *
 * 【⚠️ 它管的是"主动"，不是"能不能看"（2026-09-22 主人定下的分界）】
 * 这个数字只决定**我们什么时候先开口**：解析卡（`canShowExplanation`）、
 * 自动弹参考解（`shouldAutoRevealReference`）。
 * 学员**自己**要看的那条路（「查看猫咪解析」按钮）**不受它管** ——
 * 交过卷就有按钮。他不想再试了是他的权利，"再想想"不能变成"必须再错一次"。
 *
 * 【为什么敢定在 2】因为真跑题型**没有次数上限**（见 `canSubmit` 的说明）：
 * 做错了还能一直改、一直交。所以门槛卡在这儿不会把人卡死，
 * 顶多让他多想一轮 —— 而那一轮才是真正学到东西的地方。
 */
export const REVEAL_AFTER_WRONG = 2

export const useQuizStore = defineStore('quiz', () => {
  const session = ref<QuizSession | null>(null)
  /**
   * 错题本镜像（练习页页签角标与列表都读它）。写入点：
   * `loadWrongbook`（挂载重载）、`patchWrongbook`（手动增删）、
   * **以及两处写盘成功回话里的刷新**（V2-17）—— 那两处见 flushWrongbook。
   */
  const wrongbook = ref<WrongBookEntry[]>([])
  /**
   * 错题本读回来了没有（2026-10-17 夜间批）。
   *
   * 【为什么必须有】练习页的错题本页签先渲染、再读档：读完之前 `wrongbook`
   * 是空数组 —— 而空数组和「真的没有错题」长得一模一样，页面会先当真地
   * 显示一次「错题本空空如也喵！」再被数据顶掉。同 progress.loaded /
   * favorites.loaded / memo.loaded 一条口径（MemoView.vue:145 的注释
   * 「没读完之前不画列表」说透了这件事）。
   */
  const wrongbookLoaded = ref(false)

  /*
   * 答题会话闸（P10.6）：把「有没有会话在跑」告诉 quiz-gate（叶子模块），
   * 三个整份写 store 的本地写协议靠它决定冲突重载要不要**挂起** ——
   * 会话进行中重载会把会话脚下的状态换掉（docs/21 §8.2：会话结束的安全点
   * 统一收账）。判据就是 session 非空，订阅方在会话**关掉**的那一下收账。
   *
   * 【为什么 watch 放在这一行下面、而不是 startQuiz/finish 里手动调】
   * session 的写入点不止那两个（restart、各种退出路径都改它）—— 逐个记着调
   * setQuizActive 就是 N 处手抄同一件事，漏一处 = 冲突永远挂起（保存静默
   * 停摆）。watch 只有这一处，session 怎么变都跑不掉。
   */
  watch(session, (s) => setQuizActive(s !== null), { flush: 'sync' })

  /**
   * 局身份的发号器（`QuizSession.sessionId` 的源头，见接口上的注释）。
   *
   * 【为什么放 store 闭包、不放 session 里】它是**发号器**不是局面数据：
   * 挂进 session 的话每局一份、重开就归零 —— "严格递增"正是防撞号的
   * 全部意义所在，归零就把它毁了。与错题本那两个 Set 同住闭包，
   * 同样的理由：不是会话数据、不该被任何序列化/克隆碰到。
   */
  let sessionSeq = 0

  /*
   * 错题本**逐题记账的去重**（两个 Set 各守一条链：记错 / 消除）。
   *
   * 【为什么需要】记账从 2026-10-01 起不再只有一个落点：同步判分题在
   * `submit()` 那一刻就送（提交即记），收尾的 `flushWrongbook()` 还会把
   * 所有题再过一遍补账。同一道题被两条路看到就会记两遍 —— wrongCount
   * 虚增、重复给主进程发 clear。两条路都先问这个 Set。
   *
   * 【Set 里的一条 = 「主进程真的收下了」，不是「我们发过了」】
   * 发送是异步的：`add()` 必须在发之前就占位（不然同一 tick 里
   * "提交"与"收尾"会双发同一批），但**失败时必须把这一批 key 删回去**
   * （flushWrongbook 的两个 catch）。不回滚的话：第一发失败、收尾补账
   * 被自己的去重挡掉 —— 「答错了题却没进错题本」这个 2026-10-01 刚修完
   * 的 bug 会从失败路径上原样回来，而且一声不吭（对抗复核在 2026-10-01
   * 抓到过这条）。
   *
   * 【为什么是"会话级" —— startQuiz 里清空就够】
   * 去重只在**一局之内**有意义：新开一局（含 `restart()`，它走的就是
   * startQuiz）时从头开始送。放在 store 闭包里而不是挂上 `QuizSession`，
   * 因为它们**不是会话数据** —— 不该进 session 的类型定义、也不该被任何
   * 序列化/克隆（`toIpc`、structuredClone）碰到。
   */
  const wrongSent = new Set<string>()
  const clearSent = new Set<string>()

  /*
   * 桌宠联动的**逐题去重**（2026-10-06 活体模式）：答对发一碗大白饭、答错念一句，
   * 都是"一类事一个题只该发生一次"。一条链两把锁，都按**题号**（会话内下标）记。
   *
   * 【为什么天然只有一次还要再加锁】
   * 同步判分题提交即锁（`checked`），本来走不到第二次；但真跑题型**答错后
   * 还能再交**（见 `canSubmit` 的长注释），而"交过的那份代码没改"防的是
   * `firstSubmitOfThisRun`，防不住"改坏了再改好"—— 修好一次拿一碗饭是对的，
   * 可来回横跳就会把饭盒刷出水。加锁之后规则变成一句话：**一道题一局之内，
   * 最多发一碗饭、最多念一次错**。会话级（`startQuiz` 清空，与超时/重开同步），
   * 不挂进 `QuizSession`（同错题本那两个 Set 的理由：不是会话数据、不该被序列化）。
   */
  const petRightSent = new Set<number>()
  const petWrongSent = new Set<number>()

  /**
   * 答对一题 → 发 1 碗大白饭（answer 主进程不冒泡，只涨数字，见 doGrant）。
   *
   * 【+1 回执（V2-22）】投递语义不变（发出去就算，不 await 不拦流程），
   * 但成功回话里带着发完的**新快照** —— 拿它跟发之前的余额比，
   * 真涨了才 ping（pet store 的 riceInTick，界面据此闪 🍚 +1）。
   * 日上限 / 满仓那几笔 rice 不动 → 不 ping：界面不许报一笔没落下的账
   * （同主进程"capped 跳过镜像"的门）。`before` 读的可能还是 5s 轮询的
   * 旧值 —— 偏差方向只会让判据更保守（少报，不虚报）。
   */
  function grantPetRiceOnce(i: number): void {
    if (petRightSent.has(i)) return
    petRightSent.add(i)
    const pet = usePetStore()
    const before = pet.snap?.rice ?? null
    const sent = grantPetRice('answer')
    if (!sent) return
    void sent.then((snap) => {
      if (before !== null && snap !== null && snap.rice > before) pet.pingRiceIn()
    })
  }

  /** 答错一题 → 上报知识点（课名等由 lib/pet-wrong 查好，主进程只管说） */
  function reportWrongOnce(i: number, key: string): void {
    if (petWrongSent.has(i)) return
    petWrongSent.add(i)
    reportWrongAnswer(key)
  }

  function startQuiz(mode: QuizMode, lessonId: string, questions: Question[], keys?: string[]) {
    // 新一局 = 记账去重从零开始（restart 走的也是这里，见上面两个 Set 的注释）
    wrongSent.clear()
    clearSent.clear()
    petRightSent.clear()
    petWrongSent.clear()
    session.value = {
      mode,
      lessonId,
      // 新一局 = 新身份（restart 走的也是这里：重开就是换人，迟到的旧结果一律作废）
      sessionId: ++sessionSeq,
      questions,
      keys: keys ?? questions.map((q) => questionKey(lessonId, q.id)),
      index: 0,
      /*
       * 真跑题型的答案**不是空的** —— 它一上来就是一段代码。
       *
       * `codefix` 预填那段坏代码（学员要改的就是它），`codewrite` 预填骨架。
       * 这一步做了，编辑器、提交按钮、判分就都只需要问 `answers[i]` 一个地方，
       * 不必每处再判断一次"这题有没有起始代码"。
       *
       * 【为什么把起始代码写进 `answers`，而不是让界面临时拼】
       * 会话里那份就是**学员交上去的那份**。起始代码不进 `answers` 的话，
       * 「他改都没改就点了运行/提交」这种情况在会话里长得和「他交了一段空代码」
       * 一模一样 —— 而这两件事该给的反馈完全不同（前者是"还没动手喵"）。
       */
      answers: questions.map((q) => (isRunGraded(q) ? initialCodeOf(q) : null)),
      checked: questions.map(() => false),
      runResults: questions.map(() => null),
      wrongCounts: questions.map(() => 0),
      autoRevealed: questions.map(() => false),
      lastCleared: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null
    }
  }

  /**
   * 第 i 题的判定：**这是全项目唯一一处需要分叉「这题要不要真跑」的地方**。
   *
   * 真跑题型的结论在 `runResults[i]` 里（跑完就存下了，见 `QuizSession`）；
   * 其余题型现算，走同步的 `gradeQuestion()`。
   *
   * 【为什么要把分叉收在这一处】
   * 用到判定的地方有四个（提交、当前题对错、得分、错题本记账），
   * 每处各写一遍 `isRunGraded(q) ? ... : ...` 的话，将来加第三类真跑题型
   * 必然漏掉其中一处 —— 而漏掉的表现是**静默判错**。收成一处之后，
   * 新题型只在 `isRunGraded()` 里改一个字，四个地方一起跟着对。
   */
  function verdictOf(s: QuizSession, i: number): boolean {
    const q = s.questions[i]
    return isRunGraded(q) ? verdictFromRun(q, s.runResults[i]) === true : gradeQuestion(q, s.answers[i])
  }

  const current = computed(() => {
    const s = session.value
    return s ? s.questions[s.index] : null
  })

  function answerCurrent(value: string | number) {
    const s = session.value
    if (!s) return
    s.answers[s.index] = value
    /*
     * 真跑题型：**改了代码，上一次的运行结果和判定一起作废**。
     *
     * 【不清 `runResults` 会怎样】
     * 学员跑了一次（输出 A、判错），接着改代码，但**没有再点运行**就按了提交 ——
     * 此时 `runResults[i]` 里还是 A，于是**用旧代码的输出判了新代码的生死**。
     * 他拿到的是"你答错了"，而屏幕上那段代码他压根没跑过。
     * 清掉之后 `canSubmit` 自动变 false（跑通的结果没了），提交按钮灰下去，
     * 逼他重新运行一次 —— 而这本来就是正确的流程：想交，得先跑。
     *
     * 【`checked` 也必须一起清 —— 这一条是补的，两个字段分开清就漏了】
     * 其余题型提交即锁（输入框 readonly），所以 `checked[i] === true` 期间
     * `answers[i]` 不可能变，"判过的那一份"和"现在这一份"永远是同一份。
     * **真跑题型没有这个锁** —— 判错了还能接着改（见 `canSubmit` 的说明）。
     * 于是会出现这么一段状态：`checked[i]` 还是 true、`runResults[i]` 已经清零，
     * 而 `verdictOf()` 把它算成 false（`verdictFromRun(q, null) !== true`）。
     * 落在界面上就是：学员正在改代码，旁边一直挂着一张红的「答错了」卡
     * （`QuizOverlay.vue:161` 就是按 `checked` 显示的）——
     * 而那正是他还没跑过的新代码。这就是"把答案摆在他面前"。
     */
    if (isRunGraded(s.questions[s.index])) {
      s.runResults[s.index] = null
      s.checked[s.index] = false
    }
  }

  /**
   * 能不能提交。
   *
   * 规则本身搬去了 `shared/quiz-grading.ts` 的 `isAnswered()`：它对三个原有题型
   * 与这里原来那行**完全等价**，但多知道一条 —— codefill 要**每个空都填了**才能交。
   * 留在 store 里的话，这条按题型分叉的规则就离判分太远，改判分的人看不见它。
   *
   * 【真跑题型是另一套规则】
   * 对它们来说"答案非空"太松 —— 代码写了一半当然也非空。它们的门槛是
   * **跑通过一次**（`verdictFromRun()` 不是 `null`），也就是"编译过了、跑完了、
   * 输出拿到了"。这一条同时管住两件事：
   *   · 编译都没过的代码**不能被提交**（否则要记进错题本，还得把正确答案摊给学员看）
   *   · 学员连点提交时**不会排出一串真编译**（主进程的任务队列没有取消入口）
   *
   * 【为什么真跑题型答错之后还能再交】
   * 其余题型提交即锁（输入框 `readonly`），一次定生死。真跑题型不行：
   * 学员拿到的本来就是**会报错的代码**，第一次跑不通是常态。所以对它们，
   * 只有**做对了**才封口。"看看猫咪怎么改的喵"那个按钮敢等"错了两次"再出现，
   * 也是因为反正没有次数限制，不给人卡死。
   *
   * ⚠️ **「跑通过一次」和「已经答对了」是两件事，漏掉后者就会出人命** ——
   * 这一条原先写成 `verdictFromRun(...) === false`，意思是"跑通了**而且答错了**才能交"。
   * 于是学员代码一旦写对，`verdictFromRun` 返回 `true`、`canSubmit` 立刻变 false：
   * **提交按钮灰着，他永远交不了卷**，而屏幕上只有一段正确的输出，
   * 一句报错都没有。他要不是碰巧再改一个字（那会把判定作废、重新可交），
   * 就只能卡死在这儿。这个版本修的就是它。
   *
   * 所以现在是两步判断，各自管一件事：
   *   ① 没跑通（`null`）→ 不能交 —— 管"编译失败不能算答错"
   *   ② 已答对且交过 → 不能再交 —— 管"做对了就封口"，免得交上去的按钮一直亮着
   */
  const canSubmit = computed(() => {
    const s = session.value
    if (!s) return false
    const q = s.questions[s.index]
    if (isRunGraded(q)) {
      const verdict = verdictFromRun(q, s.runResults[s.index])
      if (verdict === null) return false
      return !(verdict && s.checked[s.index])
    }
    if (s.checked[s.index]) return false
    return isAnswered(q, s.answers[s.index])
  })

  /** 判分当前题；已判分则重复提交无效。返回是否正确 */
  function submit(): boolean {
    const s = session.value
    if (!s || !canSubmit.value) return false
    const q = s.questions[s.index]
    // 走到这儿 q 一定不是真跑题型（它们的规则由 canSubmit 和 submitRun 接管）。
    // 这一步判断不只是防御 —— 它让 `q` 在这里**收窄成 SyncGradedQuestion**，
    // 于是"忘了给真跑题型接判分"在编译期就被拦下，而不是等到有人做到那道题、
    // 发现"答对了也判错"。
    if (isRunGraded(q)) return false
    const ok = gradeQuestion(q, s.answers[s.index])
    s.checked[s.index] = true
    /*
     * 判分的声音挂在**判出来的那一行**，不挂在按钮上 —— 和音效全域的规矩一致
     * （见 `docs/04` §10.3「触发点为什么全在 store」）。
     *
     * 【为什么不会重复响】
     * 这个函数头顶就是 `if (!canSubmit.value) return false`，而 `canSubmit`
     * 在 `checked` 之后就为假 —— 也就是说**同一题交第二次根本走不到这一行**。
     * 连点有这一个闸挡着，`SFX_THROTTLE_MS` 只是第二道。
     */
    playSfx(ok ? 'answerRight' : 'answerWrong')
    /*
     * 提交即记账（2026-10-01 修）：同步判分题提交后输入框 `readonly`，
     * 判定即最终态 —— 所以这一刻就把它送进错题本，之后哪怕 ✕ 中途退出
     * 也不丢。收尾的 `flushWrongbook` 会按 `wrongSent` 去重跳过它。
     * 真跑题型**不**走这条快路径（最终态在收尾才知道），见 `submitRun()`。
     */
    flushWrongbook(s)
    /*
     * 桌宠联动（2026-10-06）：答对发饭、答错念一句。挂在这一行而不是按钮上，
     * 理由与上面那声判分音效同源 —— 跟着**判定**走，界面怎么摆都错不了。
     */
    if (ok) grantPetRiceOnce(s.index)
    else reportWrongOnce(s.index, s.keys[s.index])
    return ok
  }

  /**
   * 学员点了「运行」，跑完了 —— 把结果记下来。
   *
   * 【为什么它要顺手清掉 `checked`】
   * 学员改完代码重新跑，说明**上一次的提交已经不作数了**（他交的是那份旧代码）。
   * 不清的话：上一轮判出的红绿会继续挂在界面上，而它对应的代码已经不存在了。
   * 这跟 `codefill` 那个"改了答案界面不更新"的静默 bug 是同一类问题 ——
   * **界面上留着的东西必须对应界面下真实的状态**。
   *
   * 【`at`：这一趟运行属于**哪一题** —— 必须由发起方钉着交回来】（2026-10-14 修）
   * 真跑是异步的（真编译，几秒都可能），而"跑完之前切走"是有路的：答错交过一次
   * 之后按钮排就多出「下一题」，同时「运行」按钮还在（答错了还能改、还能重跑）——
   * 重跑期间点「下一题」，`session.index` 就换人了。
   *
   * 旧实现用**完成时刻**的 `s.index` 落账，于是题 0 的输出整份盖到题 1 头上：
   * 题 1 凭空"跑通过了"（输出凑巧对上它的 `expectedOutput` 时还会被放行提交），
   * 而真正跑的那一题结果丢了。全程静默 —— 不抛错、不崩、日志一个字都没有。
   * （回归测试：quiz-run.test.ts「结果必须落在发起那一题上」。）
   *
   * 所以 `QuizCodeRun` 在开跑那一刻把 `props.index` 钉下来（在第一个 `await`
   * 之前），跑完连结果一起 emit 回来。`at` 缺省＝当前题，给的是**同步调用者**
   * （测试里"跑到当前题上"这一类）—— 真界面那条路永远显式带题号。
   *
   * 【`token`：这一趟运行属于**哪一局** —— 同样由发起方钉着交回来】（2026-10-14 修）
   * 上面那条修掉了"同一局里换题号"，但**换局**这条路还开着：搜索面板点
   * 「练相关题」是不关遮罩、不卸载 QuizCodeRun 就换的局（SearchPanel 的
   * z-index 9500 压在遮罩 9000 上、Ctrl+K 全局无条件开）。旧局那趟还在路上的
   * 运行跑完时，新局已经就位 —— 只认题号的话，新局同号题照单全收：
   * 学员在新题上什么都没做，输出区却出现了旧题的输出。全程静默。
   * （真窗复现：探针 probe-x1，修复前构建上实测污染落地。）
   *
   * `QuizCodeRun` 现在把 `props.sessionId` 与 `props.index` **一起**在两处
   * emit 里交回；`token` 缺省＝受信的同步/测试调用者（与 `at` 缺省同一纪律，
   * 老语义一分不变）。两层防线各自独立：认局、认座号，谁的用例都能单独
   * 证明自己拦得住（quiz-run.test.ts 两个 describe 各自守着）。
   */
  function recordRun(result: RunResult, at?: number, token?: number): void {
    const s = session.value
    if (!s) return
    // ① 先认人：带了身份就必须是**本局**的（跨局迟到 = 丢弃）
    if (token !== undefined && token !== s.sessionId) return
    const i = at ?? s.index
    // ② 再看座号：越界 / 指到不真跑的题 → 丢弃（跑完时这一局可能已经换了、没了，
    //    或题号是旧的）。不抛错 —— 跑代码的结果迟到是常态，不是异常。
    if (!Number.isInteger(i) || i < 0 || i >= s.questions.length) return
    if (!isRunGraded(s.questions[i])) return
    s.runResults[i] = toIpc(result)
    s.checked[i] = false
  }

  /**
   * 学员点了「提交」——把当前这次运行的结果判定下来。
   *
   * 【判分本身不在这儿】它在 `verdictFromRun()`（纯函数，能单测）；
   * 跑代码那件事也不在这儿（组件里，要 `await` IPC）。store 只做记账 ——
   * 这样"判分规则"和"会话状态"两件事各住各的，谁改都不用碰另一个。
   *
   * 【没跑通时返回 false，什么都不改】
   * 编译失败被当成"答错了"的后果有两个，都很糟：学员**连一次都没改**
   * 就先被记进错题本；界面上还会显示「应该是：xxx」—— 那是**把答案告诉他**了。
   *
   * ⚠️ **给做界面的人（第 4 步）留一条**：`QuizOverlay.vue` 底部那排按钮现在是
   * "`checked` 了就换成「下一题」"（`:183`）。真跑题型**不能照这个走** ——
   * 答错之后 `checked` 也是 true，按钮会变成「下一题」，而「提交」消失，
   * 于是"错了还能再交"这条规则（`canSubmit` 特意为它留的）**在界面上按不到**。
   * 真跑题型的按钮排必须从题型判断（`isRunGraded`），不能从 `checked` 判断：
   * 「运行」和「提交」要一直在，`checked` 只决定要不要多给一个「下一题」。
   */
  function submitRun(): boolean {
    const s = session.value
    if (!s) return false
    const q = s.questions[s.index]
    if (!isRunGraded(q)) return false
    const verdict = verdictFromRun(q, s.runResults[s.index])
    if (verdict === null) return false

    /*
     * 只有「这一轮运行的头一次提交」才算一次错。
     *
     * 【为什么需要这个闸 —— 不加的话计数是虚的】
     * `canSubmit` 对真跑题型的规则是"跑通了、而且不是(已答对且交过)"。
     * 答错之后这个条件**仍然成立**（`verdict && checked` 是 false），
     * 所以学员**什么都没改、直接再点一次「提交」也是允许的** —— 按钮亮着。
     * 没有这道闸，连点两下就从 0 跳到 2，参考解按钮在他**只错了一次**
     * 的时候就冒出来了。而这个功能的全部意义就在于"让他真的挣扎两轮"，
     * 计数虚高等于把这个设计悄悄拆掉了 —— 而且不报错、不崩溃，
     * 只是那个按钮出现得比设计的早。
     *
     * 【为什么用 `checked` 当判据就够】
     * 这两个字段是一对：`recordRun()`（跑完）和 `answerCurrent()`（改代码）
     * 都会把 `checked[i]` 清成 false，`submitRun()` 把它置 true。
     * 于是"`checked` 还是 false"精确地意味着**这份运行结果还没被交过**，
     * 也就是"这一轮"。（要读在下面那行赋值**之前**，赋值之后就恒为 true 了。）
     */
    const firstSubmitOfThisRun = !s.checked[s.index]
    s.checked[s.index] = true
    if (!verdict && firstSubmitOfThisRun) s.wrongCounts[s.index]++
    /*
     * 桌宠联动：只认"这一轮运行的头一次提交"。真跑题型的 `submitRun()` 会被
     * 同一份结果重复调用（理由见上面 firstSubmitOfThisRun 的长注释），
     * 不加这道闸，连点提交就会变成"连发大白饭 / 连念错题"。
     * 上一行那个 `if` 管的是界面里的 `wrongCounts`，这里管的是鱼 ——
     * 两者判据相同但去处不同，刻意各写一行（合并的话，将来谁改其中一条口径
     * 都会悄悄带走另一条）。
     */
    if (firstSubmitOfThisRun) {
      if (verdict) grantPetRiceOnce(s.index)
      else reportWrongOnce(s.index, s.keys[s.index])
    }
    /*
     * 判分的声音 —— 和 `submit()` 里那一行同源，两边都跟着 `verdict` 走。
     *
     * ⚠️ 【这里**不能**照抄 `submit()` 的"交第二次走不到"】
     * 真跑题型答错之后 `canSubmit` 仍然为真（那是刻意的：错了还能再改再交），
     * 所以这个函数**会被同一份结果重复调用**。差别在于：重复调用时
     * `firstSubmitOfThisRun` 是假的 —— 但声音**照样要响**。
     * 记账（`wrongCounts`）和反馈（这一声）是两件事：
     * 记账只认头一次，否则参考解按钮会提前冒出来；而反馈每次都该响，
     * 不响的话学员点了「提交」**屏幕上什么动静都没有**，只会以为按钮坏了，
     * 然后接着点。连点由 `SFX_THROTTLE_MS` 挡（320ms），不会叠成爆音。
     */
    playSfx(verdict ? 'answerRight' : 'answerWrong')
    return verdict
  }

  /**
   * 现在这道题要不要给「查看猫咪解析」那个按钮。
   *
   * 【门槛为什么从"错够两次"改成了"交过卷"】
   * 原来它是和解析共用同一道闸（`REVEAL_AFTER_WRONG`）。主人 2026-09-22 把这条判了：
   * **不给自动看，不等于不给看**。卡住的人需要的是一条**自己点开**的路 ——
   * 没有它，卡死的人只能关掉软件，而那正是"错两次"这道闸本来想避免的事。
   *
   * 所以现在分工是：
   *   · 错的**第一次** → 诊断卡（指路，不给答案），外加这个按钮（想放弃思考时才点）
   *   · 还没交卷 → 没有按钮。他还没表态，摆一个"看答案"的入口是在催他放弃
   *   · 交过卷（对错都算）→ 按钮一直在。答对之后留着它是刻意的：
   *     用自己那套写法跑对的人，这时候对照一眼参考解是这一整段里最值钱的一刻
   *
   * 【答对之后为什么还留着】见上一条最后一行。
   * 【为什么判据是 `checked` 而不是 `isCurrentCorrect === false`】
   * `checked` 一被清（改了代码、重跑了）按钮就跟着消失 —— 它讲的是
   * 「我已经交过这一版了」。留着的话，学员一改代码就看见「看答案」，
   * 而他手上那份新代码自己还没试过。
   */
  const canRevealReference = computed(() => {
    const s = session.value
    if (!s) return false
    if (!isRunGraded(s.questions[s.index])) return false
    return s.checked[s.index]
  })

  /**
   * 这一题**该不该把参考解自动摊开** —— 错够 `REVEAL_AFTER_WRONG` 次了。
   *
   * 【它和上面那个按钮是两件事，别合并】
   * 「自动弹」是**推**（他卡住了，我们替他打开），「有按钮」是**拉**（他想看，自己点）。
   * 合并成一个条件的话，要么第一次错就把解析糊到脸上，要么把"随时能看"这条退路又关掉。
   *
   * 【为什么要 `!autoRevealed[i]`】
   * 见 `QuizSession.autoRevealed`：不加它，学员每点一次提交它都重新弹一次。
   *
   * 【组件读它、弹完必须调 `ackAutoReveal()`】
   * 这个 computed 只回答「该不该弹」，**不自己改状态** ——
   * 一个求值就会改状态的 computed，在 Vue 里是随时会咬人的东西
   * （重渲染的次数、时机都不由调用方说了算）。改状态走下面那个显式动作。
   */
  const shouldAutoRevealReference = computed(() => {
    const s = session.value
    if (!s) return false
    const i = s.index
    if (!isRunGraded(s.questions[i])) return false
    if (!s.checked[i]) return false
    if (verdictOf(s, i)) return false
    if (s.wrongCounts[i] < REVEAL_AFTER_WRONG) return false
    return !s.autoRevealed[i]
  })

  /** 界面已经把参考解弹出来了 —— 记下来，别再弹第二次 */
  function ackAutoReveal() {
    const s = session.value
    if (s) s.autoRevealed[s.index] = true
  }

  /**
   * 现在这道题的**猫咪解析**要不要露出来。
   *
   * 【为什么真跑题型要单独一道门槛】
   * 其余五个题型的解析是「讲为什么」，判完就该看见。真跑题型不一样 ——
   * 它的解析**就是答案本身**（「改成 `i <= 5` 就对了喵～」）。
   * 答错一次就把它摆出来，「让他先自己挣扎一轮」这件事就被跳过了。
   *
   * 【它和「查看猫咪解析」按钮**不再**共用一道闸（2026-09-22 改）】
   * 原来两者同门：错不够次数按钮不给、解析也不给。主人把这条判了 ——
   * **不给自动看 ≠ 不给看**。现在：
   *   · 解析卡（这张，自动出现的那一份）→ 仍然压在 `REVEAL_AFTER_WRONG` 后面
   *   · 「查看猫咪解析」按钮（他自己点）→ 交过卷就有，随时能开
   * 差别的全部意义在于**是谁先开口**：自动摊开是我们替他决定，点按钮是他自己决定。
   *
   * 【答对之后当然要给】
   * 做对了还压着解析不讲，那才真说不通。所以判据是「答对」**或者**「错够次数」。
   *
   * 【没判分之前一律不给】
   * `checked` 是前提。真跑题型跑完但没提交时它是 false —— 那时学员自己都还没表态，
   * 摆一张"你答错了"的红卡出来，是在替一件还没发生的事下结论。
   */
  const canShowExplanation = computed(() => {
    const s = session.value
    if (!s) return false
    if (!s.checked[s.index]) return false
    if (!isRunGraded(s.questions[s.index])) return true
    return verdictOf(s, s.index) || s.wrongCounts[s.index] >= REVEAL_AFTER_WRONG
  })

  /**
   * 第 i 题的判定 —— **对外那一份**（`verdictOf` 的公开入口）。
   *
   * 【为什么要有它，而不是让调用方自己去调 `gradeQuestion`】
   * 每日挑战收工时要把每一题的判定抄进存档（`ChallengeAnswer.ok`）。
   * 它原来直接调 `gradeQuestion(q, answer)` —— 那对真跑题型是**错的**
   * （真跑题型的结论在 `runResults` 里，同步算不出来）。
   * 与其让挑战那边自己写一遍 `isRunGraded` 的分支（那就是第二套判分，
   * 两套一旦漂移同一道题会两处结论不同），不如把分叉留在它该在的地方：
   * **判分只有一条路，就是这里。**
   */
  function verdictAt(i: number): boolean {
    const s = session.value
    if (!s) return false
    return verdictOf(s, i)
  }

  const isCurrentCorrect = computed(() => {
    const s = session.value
    if (!s || !s.checked[s.index]) return null
    return verdictOf(s, s.index)
  })

  function next() {
    const s = session.value
    if (!s) return
    if (s.index < s.questions.length - 1) s.index++
    else finish()
  }

  /**
   * 错题本记账：把这一局里**已经判过、还没送过**的题按规矩送出去。
   *
   * 【为什么它有两个落点 —— 2026-10-01 主人实测 bug 的修复】
   * 原先记账的唯一落点是 `finish()`，而 finish 只在「最后一题点下一题」时
   * 触发；✕ 中途退出走的 `close()` 把 session 一置空、一行都不记。
   * 主人「答错了题，错题没有自动进错题本」的实测，真身全是中途退出 ——
   * 答了半卷、错了好几道，以为错题本会跟上，结果全丢（探针复现见
   * `<workspace>/_wbprobe-20261001/result-repro.json`（不随仓库分发）：提交+退出全程 wrongbook
   * 零写盘）。现在改成两个落点：
   *   · `submit()` —— 同步判分题提交后输入框锁死、**判定即最终态**，
   *     当场就送。答错一道记一道，哪怕下一题没做就退出，也已经在账上。
   *   · `finish()` / `close()` —— 收尾补账：真跑题型的最终态只有收尾时
   *     才知道（答错还能改、还能重交），半场退出也把已判过的题记上。
   *   两条路都过 `wrongSent` / `clearSent` 去重，同一题一局只送一次。
   *
   * 【每个模式在这里显式回答三件事（新加模式时逐条过）】
   *   ① 答错记不记错题？  —— lesson/random/wrong/challenge/extend/stage/lang/review/search
   *      全记（规格）；**fav 看设置**（`config.favWrongToBook`，默认 true）—— 主人拍板：
   *      收藏练习答错照常进错题本，但给一个开关关掉它
   *   ② 答对清不清错题？  —— **只有 wrong**（"重做答对就毕业"是它独有的语义；
   *      extend / fav / stage / lang 等模式答对不清除 —— 它们都是"多练"，
   *      不是"再来一遍那道错题"。fav 尤其不能清：收藏夹里挑出来的题，
   *      答对了只说明这次做对了，那道错题要毕业得回错题本老老实实重做。
   *      **stage/lang 同理**：综合卷里撞上一道以前错过的题、这次做对了，
   *      是"这一阶段整体掌握了"的证据，不是"那道错题被我重做了一遍" ——
   *      它连原错题本里那条都没打开过）
   *   ③ 发不发奖励？      —— 不在这里：在 finish() 里。每日复习**整卷都作答**
   *      就发一张图（2026-10-17 起不看对错；没作答的题不算完成），
   *      全对只额外记进 perfectPasses / 发大白饭。
   *      （连同"练习史全模式都记"那条，各在各自段落的注释里）。
   *
   * 【为什么每道题都要 `checked` 才算数】
   * 没提交的题**根本没有判定**（`verdictOf` 会对空答案现算出一个 false）——
   * 拿它记账等于"把没答的题判成答错"。P3 探针（开卷不答直接退）钉的就是它。
   *
   * 【设置为什么每次现读】
   * 开关的语义是"以后都别记"，不是"这一局别记" —— 会话中途去设置页关掉
   * 开关，回来再交的题也得按新设置办事。同步读是安全的：main.ts 启动时就
   * `await settings.load()` 了（设置页的 soundEnabled 也是这么读的）。
   */
  function flushWrongbook(s: QuizSession) {
    const settings = useSettingsStore()
    const recordWrong = s.mode !== 'fav' || settings.config.favWrongToBook

    const wrongItems: WrongRecordItem[] = []
    const clearKeys: string[] = []
    s.questions.forEach((q, i) => {
      if (!s.checked[i]) return
      const key = s.keys[i]
      const ok = verdictOf(s, i)
      if (!ok) {
        // ⚠️ 这一层**必须留在 `!ok` 里面**：写成 `if (!ok && recordWrong) … else if (mode==='wrong')`
        // 的话，答错但开关关着时会掉进 else —— 把一道**答错的**题当成答对去消除。
        // （眼下 wrong 模式恒为 recordWrong，够不到；但那是巧合，不是设计。）
        if (!recordWrong) return
        if (wrongSent.has(key)) return
        wrongSent.add(key)
        // 【AI 题也收，但必须带上题目本体】（主人 2026-09-13 拍板改的规矩）
        // 以前是「AI 题一律不进错题本」—— 因为错题本靠「课号+题号」去内容包里
        // 把题目找回原样，而 AI 题不在任何一课里，收进来就是一条**死条目**：
        // 题干显示成「题目已被移走喵」、点重做被静默跳过、答对了也消除不掉。
        // 本体一起存下来，那两个问题就同时没了（显示和重做都用它）。
        //
        // ⚠️ `toIpc` 不能省：`q` 是从 store 上读出来的响应式代理，
        // 而 ipcRenderer.invoke 用结构化克隆，克隆不了代理 —— 抛出来的错
        // 会被下面的 catch 吞掉，表现是「AI 错题一条都没记上」，一句报错都没有。
        //
        // 内置题**不带**本体：内容包里就有，存了就是第二份真源。
        // 主进程也会把误传的丢掉，不让上游的 bug 写进磁盘。
        //
        // `source` = 这次在哪错的（模式名）—— 错题本上的来源徽章用它，
        // 表示**进入途径**（每日挑战/课后练习/…），不是"内容来源"。
        // 主进程把它跟着"最近一次答错"走（mergeWrongRecord :87）
        wrongItems.push(
          isAiKey(key) ? { key, ai: toIpc(q), source: s.mode } : { key, source: s.mode }
        )
      } else if (s.mode === 'wrong') {
        if (clearSent.has(key)) return
        clearSent.add(key)
        clearKeys.push(key)
      }
    })
    if (wrongItems.length > 0) {
      void window.miai
        .recordWrongbook(wrongItems)
        .then((revived) => {
          // 错题本在盘上真变了 → 广播（同步节拍器防抖后触发一轮云同步，P10.6）。
          // 广播点在成功回话里：`.catch` 那条路一个字节都没写，报了也是骗节拍器
          notifyLocalWrite('wrongbook')
          /*
           * 「这条你删过，又答错了喵」—— **不静默复活**。
           *
           * 主进程在合并之前算出「这次记的里面，哪些是曾经被删过（removed）的」，
           * 随回复带回来（合并之后这个信息就没了，见 findRevivedKeys 的注释）。
           * 用户以为删掉的东西自己回来了，不给一句话解释，他会以为删除功能坏了 ——
           * 那比"不复活"更糟。这里只负责把话说了；复活本身（计数累加、
           * 摘掉 removed 字段）是主进程 mergeWrongRecord 的事。
           *
           * 【提交即记以后，这句 toast 会来得更早】
           * 以前它总在结果页之后才冒；现在答错提交那一刻就会冒（若这条曾被删过）——
           * 时机更贴近"你刚刚又答错了"这句说法本身，文案不用改。
           */
          if (Array.isArray(revived) && revived.length > 0) {
            toast(TOAST.wrongRevived(revived.length), 'info')
          }
          /*
           * 角标即时（V2-17）：写盘成功 → 把 store 镜像重拉一遍。
           *
           * 【原来错在哪】`wrongbook` 只在 loadWrongbook（点进页签才跑）和
           * patchWrongbook 里被写；做完一局回到练习页，页签还挂着旧数字
           * （或对新人干脆不带数字）——用户会以为刚才答错的没记上，
           * 点进去才发现都记着。数字这才跳出来。
           *
           * 【为什么重拉而不是就地改镜像】主进程 mergeWrongRecord 会做合并
           * （计数累加、复活去 removed、AI 题按本体覆盖），这里重演一遍
           * 就是第二份真源；重拉拿到的是盘上真列表，同一时刻只有一份。
           * 读失败时 loadWrongbook 会把镜像清成空 —— 那是它原有的口径
           * （点页签也走同一条），不在这次改动范围里。
           */
          void loadWrongbook()
        })
        .catch(() => {
          /*
           * 收录失败：**把这一批的 key 从去重表里删回去**，让收尾补账
           * （finish / close）还能重试 —— `wrongSent.add` 是"发送前占位"
           * （见上面两个 Set 的注释），占位只该防"同一批发两遍"，
           * 不该把**一笔没送到的账**当成送过了。不回滚的话：主进程一拒，
           * 这道题在本局内再也补不上，而退出弹窗刚改的正文还写着
           * "答错的题会照常进错题本" —— 那就成了本项目最忌讳的假话。
           *
           * 提示不能省（失败不许静默）：文案说清"没记上"，并给出**真实
           * 存在**的补救路径 —— 本局收尾会自动重试一次；真没补上，
           * 回头再练一遍这道题也会重新记（新一局 startQuiz 会清空去重表）。
           * 不写成"退出时一定帮你记上"：这句 toast 也可能正是收尾那次
           * 重试失败时弹的，那个时刻"退出时还会再试"就成了新的假话。
           */
          for (const it of wrongItems) wrongSent.delete(it.key)
          toast(TOAST.WRONGBOOK_WRITE_FAILED, 'error')
        })
    }
    if (clearKeys.length > 0) {
      void window.miai
        .clearWrongbook(clearKeys)
        .then(() => {
          // 消除也是一次真写盘 → 广播（同 recordWrongbook 那条；成功才播）
          notifyLocalWrite('wrongbook')
          // 毕业如实入账（V1-26）：结果页的「X 道错题毕业啦」读它。
          // 只在成功回话里加（发请求时加 = 写盘失败也报喜），且累加
          // （一局多次 flush，赋值会冲掉前几批）—— 两条理由都在
          // `QuizSession.lastCleared` 的字段注释里。
          s.lastCleared += clearKeys.length
          // 消除同样是盘上变化 → 角标同步（V2-17，理由同上面 record 那条）
          void loadWrongbook()
        })
        .catch(() => {
          /*
           * 消除失败同理回滚：这道题在「错题重做」里答对了，但"毕业"没写盘 ——
           * 删回 key 让收尾补账能再试一次；再失败也还有下次：它下次答对
           * 还会走到这里。这里**不弹提示**：和记错不同，"答对却还留在
           * 错题本里"用户下次打开错题本一眼就看见，而这局他刚答对，
           * 盖一句"没更新上"除了添堵没有别的用。
           */
          for (const k of clearKeys) clearSent.delete(k)
        })
    }
  }

  function finish() {
    const s = session.value
    if (!s || s.finishedAt) return
    s.finishedAt = new Date().toISOString()

    /*
     * 收尾第一件事：把这一局还没送出去的错题记账补上。
     *
     * 记账本体（含"每个模式三问"的规格）搬去了 `flushWrongbook()` ——
     * 它现在有**两个落点**（提交即记 + 收尾补账），完整注释在那边。
     * 这里只需要知道：已经送过的题会被 `wrongSent` / `clearSent` 去重跳过，
     * 所以从 `submit()` 快路径记过的题不会记第二遍。
     */
    flushWrongbook(s)

    /*
     * 练习史：**全项目唯一写口**（见 shared/types.ts 里 practice 那一节）。
     * 每日复习的加权抽样靠它算"哪些课错得多"（`(错+1)/(尝试+2)`），
     * 将来接服务器也是这一条流水。
     *
     * 【为什么另起一个循环，不塞进上面那个】
     * 上面那个循环里藏着 `if (!recordWrong) return` —— 把记练习史写在它后面，
     * 就等于"关掉收藏练习的错题开关，顺手把练习史也停了"，静默少记一半数据。
     * 两件事的**跳题口径**也不同（错题本只关心错题和 wrong 模式的答对题，
     * 练习史全都要），合成一个循环迟早会有人按其中一边的规则改另一边。
     *
     * 【为什么只记 `checked[i]` 为真的题 —— 这是口径，不是省事】
     * 记全卷的话，**没做的题会被写成 `ok: false`** —— 那等于替他记了一次错答。
     * 而每日复习的权重正是拿 `(错+1)/(尝试+2)` 算的（`shared/review-paper.ts`），
     * 凭空多出来的错答会把权重越搅越偏：一局只做了 3 道就退出、剩下 7 道
     * 全算错，那节课从此被判定成"重灾区"。没答的题就是没答，
     * 对它最诚实的记录是"这一次里没有它"。
     *
     * 【返回值为什么现在要接住了】主进程回的是**写完之后**那一整份练习史。
     * 每日复习的加权要读它（`stores/practice.ts`）——不接住的话，
     * 用户做完一局马上点进复习页，拿到的可能是写盘落地**之前**读的那份：
     * 刚做错的那几道没进权重，这一轮复习不照顾它们，而这事一声不吭。
     * `adopt` 把返回值换上，时序上就没有"读到的比写过的旧"这条缝。
     * 失败也不抛给界面：练习史记不上只影响**以后**的复习权重，
     * 跟这一局的对错、跟用户此刻看到的结果页毫无关系 —— 为它弹个报错是噪音。
     */
    const practiceItems: PracticeRecordItem[] = []
    s.questions.forEach((_q, i) => {
      if (!s!.checked[i]) return
      practiceItems.push({ key: s!.keys[i], ok: verdictOf(s!, i) })
    })
    if (practiceItems.length > 0) {
      void window.miai
        .recordPractice({ mode: s.mode, items: practiceItems })
        .then((file) => {
          if (file) usePracticeStore().adopt(file)
          // 练习史真写盘了 → 广播（同步节拍器防抖后触发一轮云同步，P10.6）
          notifyLocalWrite('practice')
        })
        .catch(() => {
          /* 记不上不打断结果页 */
        })
    }

    /*
     * ③ 发奖励：每日复习**整卷都作答**就发一张（2026-10-17 主人改口径：
     * 不再要求全对，考得好不好都发；全对只额外记 perfectPasses 与桌宠奖励）。
     *
     * 【为什么条件是"每一道都 checked"】`checked[i]` = 这道题已经交过、判过。
     * 少答一道就不是"完成了一轮复习"—— 空卷/挑简单题做几道再翻到最后，
     * 不该拿到图。全对与否**不**参与发图裁决：那正是这次改口径要放开的。
     *
     * 【为什么还要单独算 allCorrect】全对仍然有额外的两笔：桌宠大白饭与
     * 好感度（P3 ④），以及主进程台账 perfectPasses。判分走 `verdictOf`
     * （全项目唯一判分入口，真跑题型在那里读 `runResults`），不重写第二套。
     *
     * 【为什么真跑题型也照收】同 verdictOf，不另判。
     *
     * 【为什么 fire-and-forget】发奖要过 IPC（主进程合并写档案），
     * 而 finish() 是同步收尾 —— 等它回来会拖住结果页。失败在 store 里
     * 自己 toast（见 stores/reward.ts：记账失败**不庆祝**，不许假装发过）。
     */
    if (s.mode === 'review') {
      const answeredAll = s.questions.length > 0 && s.questions.every((_q, i) => s!.checked[i])
      const allCorrect = answeredAll && s.questions.every((_q, i) => verdictOf(s!, i))
      if (answeredAll) void useRewardStore().grant(allCorrect)
      if (allCorrect) {
        // 桌宠：复习全对 = 2 碗大白饭（kind 'review' 主进程会说一句并记进
        // 记忆环）。这是全对专属，与发图分开 —— 发图只看 answeredAll。
        grantPetRice('review')
        // P3 ④ 好感度：复习满分 +5（日上限 1，超限由主进程静默丢弃）。
        // 同一条 allCorrect 判据，不另立第二份定义。
        reportPetEvent('review')
      }
    }

    /*
     * 收工音效。
     *
     * 【为什么放在 store 里，而不是 QuizOverlay 的"下一题"按钮上】
     * 因为**只有这里知道"这次真的结束了"**。按钮那一侧看到的是 `quiz.next()`，
     * 而 next() 在非最后一题时只是翻页 —— 要判断"这是不是最后一题"，得把
     * `index === questions.length - 1` 这个条件在视图里再写一遍，于是
     * 「会话结束」这个事实就有了两份定义，将来任何一份改动都会让另一份失准。
     * 上面那行 `if (!s || s.finishedAt) return` 已经保证了它**一次会话只响一次**，
     * 这是白捡的。
     *
     * 【为什么挑战和普通练习是两个音】见 lib/sfx.ts 的 SFX_FILES 表 ——
     * 两者是同一位演奏者的两段录音，挑战那段更隆重。用户不需要被告知，
     * 听一遍就分得出哪个"更大"。
     * （早先这两段是我用振荡器合成的，主人嫌"太电子"已改由他自备素材；
     *   所以这里现在只说"两段录音"，不再承诺是"同一个动机"。）
     */
    playSfx(s.mode === 'challenge' ? 'challengeDone' : 'chapterDone')
  }

  /**
   * 原地重开一局：题目、**以及 keys** 原样保留。
   *
   * 【为什么必须把 keys 一起带上 —— 这是修一个真 bug】
   * 这个动作原来写在 `QuizOverlay.vue` 的 `restart()` 里，解构的是
   * `{ mode, lessonId, questions }` —— **keys 被漏掉了**，于是重开一局会退回
   * `startQuiz` 的默认 key（`${lessonId}:${题号}`，错题本场景下就是 `__wrong__:q1`）。
   * 后果有两个，都不报错、只是安静地不对：
   *   1. 答对了也**消除不掉**错题 —— 判分时拿 `__wrong__:q1` 去比对原错题 key，永远对不上
   *   2. 还往错题本里**新增**一批 `__wrong__:*` 垃圾条目
   *
   * 搬进 store 还有第二个理由：它在组件里就没法单测，
   * 而「重开之后 key 还在不在」恰恰是最该被测试钉住的地方。
   */
  function restart() {
    const s = session.value
    if (!s) return
    startQuiz(s.mode, s.lessonId, s.questions, s.keys)
  }

  function close() {
    const s = session.value
    /*
     * 半场退出**先补账再关**（2026-10-01 修，同 flushWrongbook 的注释）。
     *
     * 【为什么不设 finishedAt】
     * `finishedAt` 是"这局结算过了"的标志：挑战页的 watcher 盯着它做收尾
     * 结算、finish 靠它防重复。半场退出**没有结算** —— 设了它，一局残卷
     * 会被当成完卷走结算路径。这里只做"把已经判过的题记上"这一件事。
     *
     * 【为什么不记练习史】
     * 练习史的口径是"一局做完记一笔"（见 finish 里那段的注释）：半场退出
     * 记的是残卷，会把每日复习的加权算进一堆没见过全貌的数据。错题本不一样——
     * 每一道**已经判过**的题本身就是一个完整事实，与"这卷做没做完"无关。
     */
    if (s && !s.finishedAt) flushWrongbook(s)
    session.value = null
  }

  const correctCount = computed(() => {
    const s = session.value
    if (!s) return 0
    return s.questions.reduce((n, _q, i) => n + (s.checked[i] && verdictOf(s, i) ? 1 : 0), 0)
  })

  /** 加载错题本（M4-05：练习页错题本页签挂载时调用） */
  async function loadWrongbook() {
    try {
      wrongbook.value = await window.miai.getWrongbook()
    } catch {
      // 读失败 ≠ 错题没了（2026-10-17 夜间批，V1-53 同款口径）：原来这里
      // 静默清空，页签列表空、角标 0，与「错题全被删了」不可区分。出声，
      // 并且 loaded 照置 —— 页面等的是「这趟读完了」，不是「读成功了」，
      // 卡在转圈上比看到空列表还糟。
      toast(TOAST.STORE_READ_FAILED, 'error')
      wrongbook.value = []
    }
    wrongbookLoaded.value = true
  }

  /**
   * 手动动一条错题：软删 / 恢复 / 标（取消）知识点漏洞。
   *
   * 【为什么返回成功与否】
   * 调用方要据此决定弹哪句话、要不要接着弹撤销——失败还说自己成功了，
   * 用户点完"移除"看不到行消失会以为界面坏了。失败时这里**自己**把
   * 磁盘上的真列表重新拉一遍：失败几乎总是"这次请求没落下"，
   * 而界面手里那份快照可能已经被别的操作改过，重载比猜哪个字段没改稳。
   *
   * 【为什么不"乐观更新"（先改界面再发请求）】
   * 主进程的 `applyWrongUpdate` 会返回**合并后的新列表**，直接把它换上，
   * 界面和磁盘同一时刻就是同一份 —— 没有"写成功了、读到的还是旧的"这种缝。
   * 乐观更新省下的那几十毫秒，代价是两处状态要各自维护，不值。
   */
  async function patchWrongbook(updates: WrongUpdateItem[]): Promise<boolean> {
    try {
      wrongbook.value = await window.miai.updateWrongbook(toIpc(updates))
      // 第三条写口（移除/恢复/标漏洞）也走同一条广播 —— 错题本的每一处
      // 盘上变化对同步节拍器都必须是可见的（P10.6）
      notifyLocalWrite('wrongbook')
      return true
    } catch {
      toast(TOAST.WRONG_UPDATE_FAILED, 'error')
      void loadWrongbook()
      return false
    }
  }

  /**
   * 把本局**裁到只剩当前这一题为止**（当前题保留，后面全部切掉）。
   *
   * 【谁在用】每日挑战。2026-10-10 主人令：挑战改「答对继续、答错立即停止」——
   * 答错的那一题就是本局最后一题，后面抽出来但还没做的题不该再出现在卷子里
   * （否则进度行还在数整池几千道、结果页会拿没做过的题当分母，
   * 全是在虚报他根本没做的题）。挑战 store 在判出错误的同一下一刀。
   *
   * 【为什么是「切数组」而不是「另设一个已结束标志」】
   * `next()` 走到最后一题会自动 `finish()`，「最后一题」这个位置就是现成的
   * 收工信号：切完长度等于 index+1，按钮文案自动变「看结果」，结果页、
   * 回顾页、错题本记账全都只看得见做过的那几题 —— 不用给每条路径
   * 各加一个「但是挑战答错了」的分支（那种分支迟早漏掉一处）。
   *
   * 【七组平行数组必须一起切】它们按下标一一对应（`questions[i]` 配
   * `keys[i]`/`answers[i]`/`checked[i]`/`runResults[i]`/`wrongCounts[i]`/`autoRevealed[i]`），
   * 只切一半会让下标错位 —— 下一题的判定读到上一题的运行结果，且不报错。
   *
   * 【去重集不受影响】`wrongSent`/`clearSent` 按 key、`petRightSent`/`petWrongSent`
   * 按下标记账，切的全是尾部未占用的格子，已有记录一个不动。
   *
   * 【幂等】已经收工（`finishedAt` 有值）或本来就只剩当前题时不做事 ——
   * 重复调用（比如 watcher 因索引移动再触发一次）没有副作用。
   */
  function truncateAfterCurrent() {
    const s = session.value
    if (!s || s.finishedAt) return
    const n = s.index + 1
    if (s.questions.length <= n) return
    s.questions.splice(n)
    s.keys.splice(n)
    s.answers.splice(n)
    s.checked.splice(n)
    s.runResults.splice(n)
    s.wrongCounts.splice(n)
    s.autoRevealed.splice(n)
  }

  /**
   * 给**当前这一局**追加一批题（每日挑战「答对继续、题目耗尽」的无缝补题）。
   *
   * 【七组平行数组必须一起长】它们按下标一一对应（`questions[i]` 配
   * `keys[i]`/`answers[i]`/`checked[i]`/`runResults[i]`/`wrongCounts[i]`/`autoRevealed[i]`）。
   * 只 push 题目、忘了扩后面的数组，下一题一进来就会读到 `undefined`：
   * 判分说「没答过」、运行结果对不上号，而且**不会抛错**。
   *
   * 【为什么返回布尔】调用方（挑战 store）要据此决定「盘上要不要跟着存一份」。
   * 会话已经收工 / 被换掉时返回 false —— 迟到的 AI 结果不该往一局已经结束的
   * 卷子里塞题，那会让结果页的分母凭空变大。
   *
   * 【只在挑战用】其它模式（课后练习、错题、复习）的题数是产品定死的，
   * 追加会改变它们的计分与「整卷作答」判据。
   */
  function appendQuestions(questions: Question[], keys: string[]): boolean {
    const s = session.value
    if (!s || s.finishedAt) return false
    if (questions.length === 0) return false
    // 长度不一致 = 键和题会错位，而错位的记账不报错。宁可这批不要
    if (keys.length !== questions.length) return false
    s.questions.push(...questions)
    s.keys.push(...keys)
    s.answers.push(...questions.map((q) => (isRunGraded(q) ? initialCodeOf(q) : null)))
    s.checked.push(...questions.map(() => false))
    s.runResults.push(...questions.map(() => null))
    s.wrongCounts.push(...questions.map(() => 0))
    s.autoRevealed.push(...questions.map(() => false))
    return true
  }

  return {
    session,
    wrongbook,
    wrongbookLoaded,
    current,
    startQuiz,
    answerCurrent,
    canSubmit,
    canRevealReference,
    shouldAutoRevealReference,
    ackAutoReveal,
    canShowExplanation,
    submit,
    recordRun,
    submitRun,
    verdictAt,
    isCurrentCorrect,
    next,
    finish,
    restart,
    close,
    truncateAfterCurrent,
    appendQuestions,
    correctCount,
    loadWrongbook,
    patchWrongbook
  }
})
