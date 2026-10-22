import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * 「换语言必须走 setLang」的接线闸门。
 *
 * 【为什么单独钉一条】
 * 2026-09-13 主人验收时踩到：选了 C 点「打印一句话」，把下拉框拨到 Java
 * 直接点运行 → 应用拿 C 代码当 Java 编译，回「这段代码里没有 class」；
 * 再拨到 Python 跑 → SyntaxError。从主人的视角看，软件坏了。
 *
 * 根因是一行接线：RunnerPanel 的语言下拉框直接写 `runner.lang = v`，
 * 绕过了 store 里的 setLang，于是「选中的语言」和「编辑器里的代码」各说各话。
 * 类型拦不住（lang 本来就设计成可写），界面也看不出来（换了语言、按钮反应正常），
 * 只有真去点运行才炸。所以用一条静态比对钉住它。
 *
 * 【它抓不到什么 —— 说清楚，别当它万能的】
 * 只抓 `runner.lang = ` 这个字面写法。哪天有人把 store 起个别的名字
 * （`const r = useRunnerStore()`）再赋值，这条就漏了。
 * 它挡的是「照原样写回去」这种最可能的回归，不是所有可能的写法。
 */
const rendererSrc = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(vue|ts)$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 排掉整行注释之后再找。
 * 注释里出现这个写法是**正常的** —— RunnerPanel 里就有一条注释专门解释
 * 「必须走 setLang 而不是直接给 runner.lang 赋值」。不排掉的话，
 * 那条解释反而会让闸门自己红掉，下一个人只会把闸门删掉。
 */
function codeText(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

const DIRECT = /runner\.lang\s*=(?!=)/

describe('换语言的接线', () => {
  const files = sourceFiles(rendererSrc)
  const rel = (p: string): string => relative(rendererSrc, p).replace(/\\/g, '/')

  it('自检：确实扫到了源文件（扫不到的话下面全是假绿）', () => {
    expect(files.length, '一个源文件都没扫到，下面的断言都是空的').toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith('RunnerPanel.vue')), '没扫到那个带语言下拉框的文件').toBe(true)
  })

  it('语言下拉框确实调用 setLang', () => {
    const panel = files.find((f) => f.endsWith('RunnerPanel.vue'))!
    expect(codeText(readFileSync(panel, 'utf8'))).toContain('runner.setLang(')
  })

  it('没有任何地方绕过 setLang 直接改 runner.lang', () => {
    const offenders = files.filter((f) => DIRECT.test(codeText(readFileSync(f, 'utf8'))))
    expect(
      offenders.map(rel),
      '这些文件直接给 runner.lang 赋值了 —— 换语言时示例不会跟随，选中的语言和编辑器里的代码又会各说各话'
    ).toEqual([])
  })
})
