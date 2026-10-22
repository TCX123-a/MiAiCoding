import { describe, expect, it } from 'vitest'
import { blankReport, langsToRecheck } from '../env-cache'
import { LANG_OF_CODE, type EnvReport, type LangEnv, type LangOfCode } from '../types'

/**
 * 环境报告「缓存保鲜」的闸门。
 *
 * 【这个文件守的是什么】
 * 2026-09-13 主人验收时踩到一个真 bug：13:05 第一次开应用（那会儿确实没装 gcc/Java），
 * 缓存把 c/cpp/java 记成「没找到」；13:45 工具链装好了，**重启应用也不重检**，
 * 于是点 C/C++/Java 永远回「还没找到翻译官喵～」。装好了却一口咬定没装。
 *
 * 所以这里守的不是「函数返回了个数组」，而是两件相反方向的事：
 *   ① **报「没找到」的必须重查** —— 漏了就是主人那个 bug，装完也永远用不了；
 *   ② **报「找到了」的绝不重查** —— 多查了就是每次跑代码都白起几个进程，
 *      而且这条更隐蔽：功能照样对，只是白白慢，测试不盯就没人发现。
 */

const OK: LangEnv = { found: true, path: 'C:\\fake\\fake.exe', version: '1.0' }

/** 按「哪几门语言已装好」拼一份检测报告 */
function report(found: Partial<Record<LangOfCode, boolean>>): EnvReport {
  const base = blankReport()
  for (const lang of LANG_OF_CODE) {
    if (found[lang]) base[lang] = { ...OK }
  }
  return base
}

describe('blankReport：空报告', () => {
  it('四门语言都记「没找到」', () => {
    const b = blankReport()
    for (const lang of LANG_OF_CODE) {
      expect(b[lang].found, `${lang} 应该是没找到`).toBe(false)
    }
  })

  it('四门各是独立对象 —— 改一门不能顺带把另一门也改了', () => {
    const b = blankReport()
    b.c.found = true
    expect(b.cpp.found).toBe(false)
    expect(b.java.found).toBe(false)
    expect(b.python.found).toBe(false)
  })
})

describe('langsToRecheck：哪些结论必须当场复核', () => {
  it('没有缓存时，四门全部要查', () => {
    expect(langsToRecheck(undefined)).toEqual([...LANG_OF_CODE])
  })

  it('没有缓存 + 只关心一门时，只查那一门', () => {
    expect(langsToRecheck(undefined, 'python')).toEqual(['python'])
  })

  it('缓存里报「没找到」的语言必须重查（主人那次就是这样：只有 python 装好了）', () => {
    expect(langsToRecheck(report({ python: true }))).toEqual(['c', 'cpp', 'java'])
  })

  it('四门全都报「找到了」时，一个都不查 —— 跑代码不该白起进程', () => {
    expect(langsToRecheck(report({ c: true, cpp: true, java: true, python: true }))).toEqual([])
  })

  it('报「找到了」的语言永远不重查（防止有人把规则改成「每次都全量重检」）', () => {
    const mixed = langsToRecheck(report({ c: true, python: true }))
    expect(mixed).not.toContain('c')
    expect(mixed).not.toContain('python')
    expect(mixed).toEqual(['cpp', 'java'])
  })

  it('只关心一门时，另外几门缺不缺都不去查（跑 python 不该被缺 C 拖慢）', () => {
    expect(langsToRecheck(report({ python: true }), 'python')).toEqual([])
    expect(langsToRecheck(report({ c: true }), 'python')).toEqual(['python'])
  })

  it('只关心一门、而那门恰好已找到时，什么都不查', () => {
    expect(langsToRecheck(report({ c: true }), 'c')).toEqual([])
  })
})
