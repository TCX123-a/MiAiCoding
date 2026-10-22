import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { stripJsonc, parseJsonc, buildPetConfig } from '../dshpet/config'
import type { PetConfig } from '../../shared/types'

/**
 * dshpet 配置生成器的单测（2026-10-06）。
 *
 * 被测对象是「咪爱宿主 ↔ dsh-pet 渲染端」契约的一半：/config 响应体的形状。
 * 另一半（渲染端怎么消费）在 dsh-pet 的 shared-core.js 里，不归我们测；这里
 * 钉死的是我们这半边的三条承诺：
 *   ① JSONC 剥注释不许在字符串里挖洞（错剥成合法 JSON = 静默喂错配置）；
 *   ② 包内 config.jsonc 逐字能解析（真实文件进场，不拿手搓样本自欺）；
 *   ③ pets 收敛成单只 'main'、宿主数据开关按数据源开关（余额开——宿主真会写叶子；
 *      碎碎念/工作状态关——前者防双生成器抢气泡，后者无数据源。V1-30，2026-10-16 夜）。
 */

const realConfigPath = join(__dirname, '..', '..', '..', 'node_modules', 'dsh-pet', 'assets', 'config.jsonc')

const PET: PetConfig = {
  enabled: true,
  size: 512,
  corner: 'bottom-right',
  followMouse: true,
  hungryRoam: true
}

describe('stripJsonc：字符串态优先，注释只在字符串外生效', () => {
  it('行尾 // 注释被剥掉，JSON 仍可解析', () => {
    expect(JSON.parse(stripJsonc('{"a": 1} // 尾部注释'))).toEqual({ a: 1 })
  })

  it('字符串里的 // 一个字节都不许动（URL 场景）', () => {
    const src = '{"url": "http://example.com/a//b"}'
    expect(stripJsonc(src)).toBe(src)
    expect(JSON.parse(stripJsonc(src)).url).toBe('http://example.com/a//b')
  })

  it('转义引号后面的 // 不会被误判为注释', () => {
    // "say \"//\"" —— 字符串内容是 say "//"，两个 // 都在串内
    const src = '{"s": "say \\"//\\" ok", "n": 2}'
    expect(JSON.parse(stripJsonc(src))).toEqual({ s: 'say "//" ok', n: 2 })
  })

  it('块注释整段剥掉（含跨行）', () => {
    const src = '/* 头注释\n第二行 */ {"a": 3} /* 尾 */'
    expect(JSON.parse(stripJsonc(src))).toEqual({ a: 3 })
  })

  it('未闭合的块注释剥到结尾（宁少剥不可错剥的对偶：这半边选择剥光）', () => {
    expect(stripJsonc('{"a": 4} /* 没有闭合').trim()).toBe('{"a": 4}')
  })

  it('CRLF 行尾下同样正确', () => {
    const src = '{\r\n  "a": 5 // 注释\r\n}'
    expect(JSON.parse(stripJsonc(src))).toEqual({ a: 5 })
  })
})

describe('parseJsonc：真实包内配置能解析', () => {
  it('node_modules/dsh-pet/assets/config.jsonc 逐字能解析成对象', () => {
    // 文件缺席 = 依赖没装好：响亮报出来，别静默跳过（跳过的绿是假的）
    expect(existsSync(realConfigPath), `缺少真实供体文件 ${realConfigPath}`).toBe(true)
    const parsed = parseJsonc<Record<string, unknown>>(readFileSync(realConfigPath, 'utf8'))
    expect(typeof parsed).toBe('object')
    expect(Array.isArray(parsed.pets)).toBe(true)
    expect((parsed.pets as unknown[]).length).toBeGreaterThan(0)
    expect(typeof parsed.animations).toBe('object')
  })
})

describe('buildPetConfig：包内配置 → 咪爱口径 { main: conf }', () => {
  function loadReal(): Record<string, unknown> {
    return parseJsonc<Record<string, unknown>>(readFileSync(realConfigPath, 'utf8'))
  }

  it('壳只有 main 一个条目，pets 收敛成单只 id=main / display=desktop', () => {
    const out = buildPetConfig(loadReal(), PET)
    expect(Object.keys(out)).toEqual(['main'])
    const pets = out.main.pets as Record<string, unknown>[]
    expect(pets.length).toBe(1)
    expect(pets[0].id).toBe('main')
    expect(pets[0].display).toBe('desktop')
    expect(pets[0].size).toBe(512)
  })

  it('宿主数据开关按数据源开关：balance 开（V1-30 宿主真写叶子）/ whisper、workStatus 关', () => {
    const out = buildPetConfig(loadReal(), PET)
    const pet = (out.main.pets as Record<string, unknown>[])[0]
    // balanceEnabled=true（2026-10-16 夜 V1-30，主人裁定「余额档位用户应该能看见啊？
    // 目前不是接了 deepseek 的 API 吗？」）：菜单「查看余额」→ host.refreshBalance
    // 现查 DeepSeek 写 sections.balance 叶子，开着渲染端才收账（档位动画 + 报账气泡）。
    expect(pet.balanceEnabled).toBe(true)
    // whisperEnabled=false：它控的是**供应商的**自动周期生成（周期轮询让宿主现编一句）；
    // 咪爱的碎碎念走自己的 say 链路 + pet-quips 台词池，开着 = 两个生成器抢同一只气泡。
    expect(pet.whisperEnabled).toBe(false)
    // workStatusEnabled=false：DSH 会话遥测在咪爱没有数据源（host 从不写该叶子）。
    expect(pet.workStatusEnabled).toBe(false)
    // menuEvents（V1-30）：菜单树只列**有数据源的**事件组 —— 原来 buildMenuTree 遍历
    // 全部 events 键、不读任何开关，用户会看到「工作状态」这种不存在功能的死组。
    expect(pet.menuEvents).toEqual(['balance', 'whisper'])
  })

  it('落点 corner 写进 position（其余 position 字段保留包内默认）', () => {
    const raw = loadReal()
    const basePos = ((raw.pets as Record<string, unknown>[])[0].position ?? {}) as Record<string, unknown>
    const out = buildPetConfig(raw, { ...PET, corner: 'top-left' })
    const pos = ((out.main.pets as Record<string, unknown>[])[0].position ?? {}) as Record<string, unknown>
    expect(pos.corner).toBe('top-left')
    for (const [k, v] of Object.entries(basePos)) {
      if (k === 'corner') continue
      expect(pos[k], `position.${k} 被意外改动`).toEqual(v)
    }
  })

  it('原对象不被改动，且返回的树与原始树零共享（改写 out 不回流 raw）', () => {
    const raw = loadReal()
    const before = JSON.stringify(raw)
    const out = buildPetConfig(raw, { ...PET, size: 700 })
    expect(JSON.stringify(raw)).toBe(before)

    // 【为什么不是 .not.toBe 身份断言】那两条恒真（开头有 JSON 深拷贝，out 的
    // 任何子对象永远不可能与 raw 同引用）—— 恒真的断言是死比较器，红不了就
    // 不是证据。改成**主动改写探针**：真去动 out 的嵌套结构，泄漏了才会红。
    const rawPet = (raw.pets as Record<string, unknown>[])[0]
    const outPet = (out.main.pets as Record<string, unknown>[])[0]
    const outPos = outPet.position as Record<string, unknown>
    outPos.corner = 'top-left'
    // 先自证动作真的发生了（防「改了但没改着」的 no-op 假绿）
    expect(outPos.corner).toBe('top-left')
    // 再证泄漏为零：raw 的字节与那份 position 都没被这次改写碰到
    expect(JSON.stringify(raw)).toBe(before)
    expect((rawPet.position as Record<string, unknown>).corner).not.toBe('top-left')
  })

  it('名字：恒为「大肥鱼」，不随包内角色名走（V1-29/V2-05 主人裁定）', () => {
    const raw = loadReal()
    const out = buildPetConfig(raw, PET)
    const pet = (out.main.pets as Record<string, unknown>[])[0]
    // 包内 pets[0].name 是上游角色名「蓝毛小女仆」—— 它不许出现在出参里
    expect(pet.name).toBe('大肥鱼')

    // 包内没有 name 也落同一个答案：名字不来自包内，两条路径必须同口径
    const noName = buildPetConfig({ pets: [{ id: 'x' }] }, PET)
    expect((noName.main.pets as Record<string, unknown>[])[0].name).toBe('大肥鱼')
  })

  it('坏输入响亮 throw（null / 数组 / 字符串 / 数字）', () => {
    for (const bad of [null, undefined, [], 'x', 42]) {
      expect(() => buildPetConfig(bad, PET), `输入 ${JSON.stringify(bad)} 应 throw`).toThrow()
    }
  })
})
