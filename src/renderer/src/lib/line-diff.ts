/**
 * 行级差异：把「你的代码」和「参考解」对齐成一张可以并排看的表。
 *
 * 【为什么必须有它，而不是把两段代码并排摆出来就完事】
 * 「参考解对比」这个功能要回答的问题只有一个：**我哪里不一样**。
 * 而两段代码并排摆着，这个答案是要学员**用眼睛去找**的 —— 偏偏这正是
 * 零基础学员最不擅长的事：一段 8 行的代码改了一个字符，两栏看起来一模一样，
 * 他扫三遍也扫不出来，最后只会觉得"这不就是一样的吗，软件坏了吧"。
 *
 * 多写这 60 行，换来的是**改动的行自己跳出来**。教学价值全在这儿。
 *
 * 【为什么是"行"不是"字符"】
 * 字符级 diff（`git diff --word-diff` 那种）在散文里好用，在代码里会把
 * `printf` 拆成 `pr`+`intf` 这种碎片，对初学者是纯噪音。
 * 行是代码天然的语义单位 —— 而且这一版要教的就是"哪一行不对"。
 *
 * 【为什么不用现成的库】
 * 项目零新增依赖是既有约束（离线优先），而 LCS 就这几十行、还能单测。
 * 引入 `diff` 那种包只为这一个界面，不划算。
 */

/** 一行在两边的关系。`change` 是"这一行两边都有但内容不同"，最容易看懂的那种差异 */
export type DiffKind =
  /** 两边一模一样 */
  | 'same'
  /** 两边都有、内容不同（改过） */
  | 'change'
  /** 只有「你的代码」有（你多写/参考解里删掉了） */
  | 'remove'
  /** 只有「参考解」有（你少了这一行） */
  | 'add'

/**
 * 对齐后的一行。左右两侧各自带**原始行号**（1 起）。
 *
 * 行号是刻意留着的：学员看完对比要回去改自己那份，
 * 「参考解第 4 行」比「参考解中间那行」有用得多。
 * 某一侧为 `null` 表示这一侧没有对应的行（对面独有）——
 * 用 `null` 而不是空字符串，是因为**"这里没有这行"和"这里是一个空行"
 * 是两件事**，界面上一个该留白、一个该显示行号。
 */
export interface DiffRow {
  kind: DiffKind
  yoursNo: number | null
  yours: string | null
  refNo: number | null
  ref: string | null
}

/**
 * 按行切开，并丢掉**末尾那一个空行**。
 *
 * `"a\nb\n"` 切成 `['a','b','']`，最后那个 `''` 是"文件以换行结尾"的产物，
 * 不是一行空代码。留着它，对比表末尾会凭空多出一行空白，
 * 看起来像是参考解比你多一个空行。**中间**的空行照留 —— 那些是真内容。
 *
 * 顺带把 `\r\n` 和孤立的 `\r` 一起收掉：Windows 上编辑器交上来的代码
 * 常常带 `\r`，不收的话，两边视觉上完全相同的行会判成"改过"
 * （`'}'` 和 `'}\r'` 是两个不同的字符串）。
 */
export function splitCodeLines(code: string): string[] {
  const lines = code.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 最长公共子序列的**长度表**，`dp[i][j]` = 你从第 i 行起、参考解从第 j 行起
 * 还能对上多少行。
 *
 * 从右下往左上填：这样回溯的时候从 `(0,0)` 一路往右下走，
 * 每一步都能直接问"往哪边走更长"。
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

/** 编辑脚本里的一步。内部用，不对外 */
type Op =
  | { type: 'same'; text: string; aIdx: number; bIdx: number }
  | { type: 'del'; text: string; aIdx: number }
  | { type: 'ins'; text: string; bIdx: number }

/**
 * 把两段代码对齐着比出来。
 *
 * 【为什么把连续的"删一堆 + 插一堆"配成成对的 `change` 行】
 * 纯 LCS 出来的脚本是"删第 4 行、插第 4 行"这样两条独立记录，
 * 直接铺在表里就是左右错开一行、下面多出一行空白 —— 而学员一眼想看到的
 * 恰恰是「**这**一行的**这**个地方不一样」。所以成对的删/插合并成一行，
 * 两边内容不同但**位置对齐**，差异就在同一水平线上。数量对不上的部分
 * （删 3 行只插了 1 行）才落成单独的 `remove` / `add`。
 *
 * 【tie-break 为什么偏 `del`】
 * `dp[i+1][j] >= dp[i][j+1]` 里的等号：长度一样时先走"删"。
 * 这样成对合并时**左边那行先到位**，视觉上是"你这里原来是这样、参考解改成这样"，
 * 顺序符合阅读习惯；反过来会变成"参考解是这样、你原来是那样"，读着别扭。
 */
export function diffLines(yours: string, reference: string): DiffRow[] {
  const a = splitCodeLines(yours)
  const b = splitCodeLines(reference)
  const dp = lcsTable(a, b)

  // ① 先按 LCS 得到编辑脚本
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i], aIdx: i + 1, bIdx: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i], aIdx: i + 1 })
      i++
    } else {
      ops.push({ type: 'ins', text: b[j], bIdx: j + 1 })
      j++
    }
  }
  while (i < a.length) ops.push({ type: 'del', text: a[i], aIdx: ++i })
  while (j < b.length) ops.push({ type: 'ins', text: b[j], bIdx: ++j })

  // ② 把每一段连续的"删/插"配成对
  const rows: DiffRow[] = []
  let k = 0
  while (k < ops.length) {
    const op = ops[k]
    if (op.type === 'same') {
      rows.push({
        kind: 'same',
        yoursNo: op.aIdx,
        yours: op.text,
        refNo: op.bIdx,
        ref: op.text
      })
      k++
      continue
    }
    const dels: Op[] = []
    const inss: Op[] = []
    while (k < ops.length && ops[k].type !== 'same') {
      const cur = ops[k]
      if (cur.type === 'del') dels.push(cur)
      else inss.push(cur)
      k++
    }
    const span = Math.max(dels.length, inss.length)
    for (let t = 0; t < span; t++) {
      const d = dels[t] as Extract<Op, { type: 'del' }> | undefined
      const s = inss[t] as Extract<Op, { type: 'ins' }> | undefined
      rows.push({
        kind: d && s ? 'change' : d ? 'remove' : 'add',
        yoursNo: d ? d.aIdx : null,
        yours: d ? d.text : null,
        refNo: s ? s.bIdx : null,
        ref: s ? s.text : null
      })
    }
  }
  return rows
}

/** 这一行是不是"不一样的地方"。界面拿它决定要不要涂色 */
export function isDiffRow(kind: DiffKind): boolean {
  return kind !== 'same'
}
