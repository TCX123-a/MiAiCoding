/**
 * 壁纸属性显隐条件求值器 —— elysia395/dsh-wallpaper-engine `src/we-cond.js`
 * 的 TS 移植（2026-10-05 P3 第四步「壁纸属性」面板，照源码逐段搬）。
 *
 * 上游：https://github.com/elysia395/dsh-wallpaper-engine
 * 许可证：MIT，Copyright (c) 2026 elysia395；全文见 THIRD-PARTY-CODE-NOTICES.md。
 *
 * 【为什么单独一个文件】真实壁纸里绝大多数可见属性带 `condition`，不求值就会
 * 把一堆无关项摊在面板上；它是纯计算（词法 → 递归下降 → 缓存编译结果），与
 * DOM、设置、宿主都无关，可以独立测（`__tests__/wp-cond.test.ts` 的用例表）。
 *
 * 【与 DSH 原文的两处有意差异】
 * ① 新增 `.endsWith(...)` / `.startsWith(...)` / `.includes(...)` 三个方法调用
 *    （参数只收字符串/数字字面量）—— 本机工坊壁纸 corsair_collection 的
 *    condition 用的就是 `effect.value.endsWith('wave') === true` 这类表达式，
 *    DSH 对该语法抛错后 fail open（恒显示，互斥的两项会同时显示）；我们按
 *    显式白名单求值，选中的一项才显示。其余成员访问仍照 DSH：只认 `ident` /
 *    `ident.value` / `ident.value.方法(字面量)`（实测数据里方法就挂在 `.value`
 *    后面，见 primary 里的注释），别的一律抛错 → fail open。
 * ② 其余语义**一个字没改**：失败即显示（fail open）、宽松相等（"1" == 1）、
 *    按表达式字符串缓存（拖动滑块时每帧要对上百项求值）、无 eval、无副作用。
 *
 * 不变量：
 *   · 受限语法、**不用 eval**；整个文件必须保持浏览器安全（无 Node API）。
 *   · **失败即显示**（fail open）：无法解析 / 求值抛错 / 空条件 一律返回 true ——
 *     真实数据里存在用 JS 三元或赋值写 condition 的壁纸，误判隐藏远比分多
 *     显示一项糟糕。
 */
import type { WallpaperPropValue } from './wallpaper-props'

/** 支持的操作符（多字符在前：startsWith 逐位匹配，顺序敏感） */
const WE_COND_OPS = ['===', '!==', '&&', '||', '==', '!=', '>=', '<=', '>', '<', '!', '(', ')', '.', '-'] as const

/** 新增支持的方法白名单（见文件头差异①）；`value` 是 DSH 原有的成员访问 */
const WE_COND_METHODS = ['endsWith', 'startsWith', 'includes'] as const

export interface CondToken {
  k: 'str' | 'num' | 'id' | 'op'
  v: string
}

/** 编译结果：吃「属性名 → 当前值」的表，吐任意值（外层 Boolean 化） */
export type CondFn = (values: Record<string, unknown>) => unknown

/** 表达式字符串 → 编译结果；null = 语法不支持（恒显示） */
const weCondCache = new Map<string, CondFn | null>()

export function weCondTokenize(src: string): CondToken[] {
  const out: CondToken[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1)
      if (end < 0) throw new Error('unterminated string')
      out.push({ k: 'str', v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      out.push({ k: 'num', v: src.slice(i, j) })
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++
      out.push({ k: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    const op = WE_COND_OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new Error('bad char ' + c)
    out.push({ k: 'op', v: op })
    i += op.length
  }
  return out
}

/** 宽松相等：值经 project.json → 配置存储 → JSON → JS 传递，"1" 与 1 混用是常态 */
function weCondLooseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || a === null || b === undefined || b === null) {
    return (a === undefined || a === null) && (b === undefined || b === null)
  }
  if (typeof a === typeof b) return false
  const na = Number(a)
  const nb = Number(b)
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb
}

function weCondNumCmp(a: unknown, b: unknown, op: string): boolean {
  const x = Number(a)
  const y = Number(b)
  if (Number.isNaN(x) || Number.isNaN(y)) return false
  if (op === '>') return x > y
  if (op === '<') return x < y
  if (op === '>=') return x >= y
  return x <= y
}

/** 受限表达式语法 → 闭包（无副作用；不支持的语法抛错 → 调用方 fail open） */
export function weCondParse(tokens: CondToken[]): CondFn {
  let pos = 0
  const peek = (): CondToken | undefined => tokens[pos]
  const eat = (v: string): void => {
    const t = peek()
    if (!t || t.k !== 'op' || t.v !== v) throw new Error('expect ' + v)
    pos++
  }
  function or(): CondFn {
    let left = and()
    while (peek() && peek()!.k === 'op' && peek()!.v === '||') {
      pos++
      const right = and()
      const l = left
      left = (v) => Boolean(l(v)) || Boolean(right(v))
    }
    return left
  }
  function and(): CondFn {
    let left = cmp()
    while (peek() && peek()!.k === 'op' && peek()!.v === '&&') {
      pos++
      const right = cmp()
      const l = left
      left = (v) => Boolean(l(v)) && Boolean(right(v))
    }
    return left
  }
  function cmp(): CondFn {
    const left = unary()
    const t = peek()
    if (t && t.k === 'op' && ['==', '!=', '===', '!==', '>', '<', '>=', '<='].includes(t.v)) {
      pos++
      const right = unary()
      const op = t.v
      if (op === '==' || op === '===') return (v) => weCondLooseEq(left(v), right(v))
      if (op === '!=' || op === '!==') return (v) => !weCondLooseEq(left(v), right(v))
      return (v) => weCondNumCmp(left(v), right(v), op)
    }
    return left
  }
  function unary(): CondFn {
    const t = peek()
    if (t && t.k === 'op' && t.v === '!') {
      pos++
      const inner = unary()
      return (v) => !inner(v)
    }
    if (t && t.k === 'op' && t.v === '-') {
      pos++
      const inner = unary()
      return (v) => -Number(inner(v))
    }
    return primary()
  }
  function primary(): CondFn {
    const t = peek()
    if (!t) throw new Error('unexpected end')
    if (t.k === 'op' && t.v === '(') {
      pos++
      const inner = or()
      eat(')')
      return inner
    }
    if (t.k === 'num') {
      pos++
      const n = Number(t.v)
      if (Number.isNaN(n)) throw new Error('bad num')
      return () => n
    }
    if (t.k === 'str') {
      pos++
      const s = t.v
      return () => s
    }
    if (t.k === 'id') {
      pos++
      if (t.v === 'true') return () => true
      if (t.v === 'false') return () => false
      const name = t.v
      const get: CondFn = (v) => v[name]
      const dot = peek()
      if (dot && dot.k === 'op' && dot.v === '.') {
        pos++
        let m = peek()
        // `.value` 是「取属性当前值」的语法装饰（DSH 的唯一成员访问）。
        // 【实测数据口径】真实壁纸会把它和方法链起来：
        //   `effect.value.endsWith('wave') === true`（corsair_collection）
        // —— `.value` 后面再出现 `.` 时必须继续读方法，否则整条表达式
        // trailing tokens 抛错 → fail open（互斥的两项会同屏显示）。
        if (m && m.k === 'id' && m.v === 'value') {
          pos++
          const dot2 = peek()
          if (dot2 && dot2.k === 'op' && dot2.v === '.') {
            pos++
            m = peek()
          } else {
            return get // 纯 ident.value（含 rainbowscheme.value 这种整条当布尔用）
          }
        }
        if (!m || m.k !== 'id') throw new Error('only .value / .endsWith / .startsWith / .includes')
        if ((WE_COND_METHODS as readonly string[]).includes(m.v)) {
          // 【差异①】三个字符串方法，参数只收字面量（数字按字符串比）
          pos++
          const method = m.v
          eat('(')
          const arg = peek()
          if (!arg || (arg.k !== 'str' && arg.k !== 'num')) throw new Error('method arg must be a literal')
          pos++
          eat(')')
          const lit = arg.v
          return (v) => {
            const target = get(v)
            // 非字符串时抛错 → 外层 fail open（恒显示）；不静默 false 隐藏
            if (typeof target !== 'string') throw new Error('method target is not a string')
            if (method === 'endsWith') return target.endsWith(lit)
            if (method === 'startsWith') return target.startsWith(lit)
            return target.includes(lit)
          }
        }
        throw new Error('only .value / .endsWith / .startsWith / .includes')
      }
      return get
    }
    throw new Error('unexpected token')
  }
  const root = or()
  if (pos !== tokens.length) throw new Error('trailing tokens')
  return root
}

/** 属性显隐条件：无条件 / 空条件 / 语法不支持 → 一律可见 */
export function weEvalCondition(expr: unknown, values: Record<string, WallpaperPropValue | undefined>): boolean {
  // fail open 第一道：**非字符串**（脏配置/手改文件）一律当「没有条件」。
  // 别用 `!String(expr).trim()` 放行数字 —— 0 会被解析成表达式 '0'，判成假
  // 把属性**藏起来**，方向反了（数字 42 又恰好可见，同一个写法两种结果）。
  if (typeof expr !== 'string' || expr.trim() === '') return true
  const key = expr
  let fn = weCondCache.get(key)
  if (fn === undefined) {
    try {
      const node = weCondParse(weCondTokenize(key))
      fn = (v) => Boolean(node(v))
    } catch {
      fn = null // 不支持的语法 → 恒显示
    }
    weCondCache.set(key, fn)
  }
  if (!fn) return true
  try {
    return Boolean(fn(values))
  } catch {
    return true
  }
}
