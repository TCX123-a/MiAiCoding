/**
 * 归零静默闸门（P3 ③，2026-10-08）
 *
 * 【契约与修正案】「satiety=0 时除喂饭回复外一切主动出声全停」，且修正案
 * C2 点名：闸门必须落在**气泡叶子的两个写方**（host.ts 的 sayText 与
 * sayQuip）——只包 sayText 会漏 whisper/plead 那条路。两个写方在本文件里
 * 收敛成唯一实现 writeSayLeaf()，host 只负责把数据备齐（谁、说什么、
 * 现在多饿）。
 *
 * 【为什么单独一个文件】host.ts 顶层 import electron，vitest 进不来 ——
 * 让"说不说"的判定与"怎么写叶子"的动作住在一个不碰 electron 的模块里，
 * 「0 档下 say 叶子 counter 不变」这条判据才有机器证据（不是只靠真机探针）。
 *
 * 【判定方向】只认**有证据的饿**：satiety<=0 ⇒ 关门（白名单除外）。
 * 读不到读数（vitals 叶子还没写过）⇒ 放行 + 留一行日志 —— 桌宠突然变哑巴
 * 比多说一句糟得多；而且「以为闸门在保护、其实从没生效」这种假绿，
 * 恰恰就是那行日志要抓的。判定为真（静默）的路上没有不需要证据的分支。
 *
 * 【零中文纪律】本文件在 src/ 下、会被文案闸门扫：字符串字面量一律 ASCII
 * （日志标签、白名单都是英文；台词真源在 shared/copy.ts）。
 */

/** 气泡叶子的形状（host /state 的 pets.main.say；counter 严格递增） */
export interface SayLeaf {
  counter: number
  data: null | { text: string; image?: string }
}

/**
 * 归零后仍允许说的 tag 白名单（其余一律闭嘴）。每一格都要说得出
 * 「为什么它不能被静默」—— 名单不是"顺手加几个"，是三条来源：
 *
 *   ① 契约点名的例外：
 *      · hungry-sob    归零那一声叹息（既有台词复用，之后彻底安静）
 *      · chase-hungry  饿扁拒跑（用户按下"跑"之后，回答"为什么不动"）
 *      · feed-*        喂饭回复（契约写死的唯一例外；饭盒空/吃饱了也要回话）
 *   ② 既有测试钉死的语义：
 *      · greet*        出场问候（dshpet-brain.test.ts「多日不见盖过饿」就是
 *                      satiety=0 + 三天没见，必须能说 greet:away —— 把问候
 *                      也静默掉的话，那句会永远出不来，因为 ≥48h 没见
 *                      必然饿到 0）
 *   ③ 已付钱/回应用户动作的聊天：
 *      · chat-gate     护栏台词（含"饿得讲不动"那条 CHAT_HUNGRY —— 它就是
 *                      归零档该被听见的那句"为什么"）
 *      · chat/chat-fail 回复已经在路上（聊天本身扣饱食度，可能正是它把
 *                      satiety 打到 0 的）—— 静默 = 白烧用户的 token
 *   ④ 对用户动作的即时应答（2026-10-10 图五修复加入）：
 *      · plead         关闭挽留。三个入口（悬停关闭键 / 右键菜单项 / 设置卡
 *                      开关）都是**用户把手放上去了**才触发 —— 它是应答，
 *                      不是主动出声。而且挽留的动作线（recall 叶子）本来就
 *                      不过这道闸门：不放行的话归零档就只剩"游过去原地撒娇
 *                      但一言不发"，正是主人报的「第一次悬停无语言无图片、
 *                      第二次才齐」（当年第二次能出声是因为有别的互动把
 *                      satiety 顶离了 0；V1-46 起摸头不再涨饱食度，这条
 *                      白名单就成了归零档里它唯一能出声的路，更不能撤）。
 *                      与 greet 同族：只在特定交互里出现，被闸门吞掉 =
 *                      永远出不来 —— 归零档可以持续几小时，而这期间每一次
 *                      悬停都会被吞。
 *      · 学习/运行的奖励回执（V1-50，2026-10-15 夜主人裁定）：
 *        grant-lesson / grant-review / grant-checkin / rice-full / rice-cap
 *        ——"你刚干了活，这是回执"。它们只在用户**刚做完动作**的那一拍出现，
 *        不是主动搭话；而且它们说的数（credited）决定饭盒数字涨没涨 ——
 *        吞掉 = 数字不涨却零解释（正是 V1-42 要修的静默）。归零档恰恰是
 *        "学完一课就有一碗大白饭能救它"最该被听见的时刻，把回执静默掉等于
 *        关掉了这条路的回声。
 *        注意与它们相邻的两声**不在**白名单：spin（连学彩蛋，庆祝性质、
 *        不等于账目回执）与 nag/nuzzle（主动催饭）—— 归零档该安静的部分
 *        照旧安静。
 *      · run-ok / run-reward  跑通代码的表扬与发饭回执（同上：只应"跑"这一
 *        动作而来；零 API、零 token，纯粹是对用户动作的回话）。
 *
 * 被挡的典型：sayQuip 五个场景（menu/idle/lateNight/startup/affection，
 * 即 whisper/菜单点播/好感跨档）与 brain 的主动类（proactive/
 * proactive-memory/cpu-hot/nag/nuzzle 等）。
 */
export const SAY_ALLOW_AT_ZERO: ReadonlySet<string> = new Set([
  'hungry-sob',
  'chase-hungry',
  'feed-ok',
  'feed-empty',
  'feed-full',
  'greet',
  'greet:away',
  'greet:hungry',
  'greet:sleepy',
  'chat-gate',
  'chat',
  'chat-fail',
  'plead',
  // V1-50：对用户动作的即时应答（学习/运行回执）
  'grant-lesson',
  'grant-review',
  'grant-checkin',
  'rice-full',
  'rice-cap',
  'run-ok',
  'run-reward'
])

/**
 * 闸门判定：能否在"饿到这个读数"时说话。
 * satiety<=0 且 tag 不在白名单 ⇒ false（闭嘴）。NaN/负数按"饿"算（同上）。
 */
export function sayAllowedAtZero(satiety: number, tag: string): boolean {
  if (Number.isFinite(satiety) && satiety > 0) return true
  return SAY_ALLOW_AT_ZERO.has(tag)
}

/**
 * 写气泡叶子（host 的 sayText / sayQuip 唯一实现）。返回是否真的写了。
 *
 * · 被闸门拦下：**不动 counter、不写 data**（渲染端就不会看见一条"什么都没有"
 *   的新条目），日志里留一行 `say dropped (starving …) tag=…` —— 静默必须可归因。
 * · satiety 读不到（null）：放行 + 留一行 `say gate: vitals missing …`。
 * · 写成功：counter+1、data 落值，日志格式与旧版逐字一致
 *   （`say#N (tag) text +meme`）—— 既有探针按这个格式解析，不许漂。
 * · `logTag`（P3 ④ C3，可选）= 只进日志的**二级标签**：日志行变成
 *   `say#N (tag) logTag text`。叶子的 tag 与 data 都不带它 —— 闸门白名单
 *   与 recent 记账都以场景名（tag）为键，二级标签是给探针对账看的
 *   （好感跨档的 affection-up / affection-down）。不传时旧格式逐字不变。
 */
export function writeSayLeaf(
  leaf: SayLeaf,
  entry: { tag: string; text: string; meme?: string; logTag?: string },
  satiety: number | null,
  log: (line: string) => void
): boolean {
  if (satiety === null) {
    log(`say gate: vitals missing, fail-open (${entry.tag})`)
  } else if (!sayAllowedAtZero(satiety, entry.tag)) {
    log(`say dropped (starving ${satiety}) tag=${entry.tag}`)
    return false
  }
  leaf.counter += 1
  leaf.data = entry.meme ? { text: entry.text, image: entry.meme } : { text: entry.text }
  log(
    `say#${leaf.counter} (${entry.tag}) ${entry.logTag ? entry.logTag + ' ' : ''}${entry.text}${entry.meme ? ' +' + entry.meme : ''}`
  )
  return true
}
