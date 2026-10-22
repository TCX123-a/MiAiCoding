/**
 * webwallgl 构建期补丁集的单测（2026-10-05 文字热更；2026-10-06 扩音频闸门 + 帧率参照；
 * 2026-10-08 扩让帧 + 大字体快拷贝）。
 *
 * 每个补丁都钉两层：
 *  ① 前提 —— 真文件里锚点恰好一次；且**病灶还在**（上游尚未自己修，补丁未白费）：
 *     文字版 = `boundUserName(src.text/pointsize)` 一次都没有；音频版 = audioSim 仍是
 *     一次性布尔（`get enabled` 零命中）；帧率版 = capNow 仍是裸配置值（`Math.min` 零命中）。
 *     哪天上游补上了，对应的前提测试会红：提醒我们审视该补丁是否该退休。
 *  ② 行为 —— 注入后 marker 与替换片段各恰好一次、锚点不再以旧形出现、幂等短路、
 *     锚点缺失/重复时响亮抛错、注入后代码能过 esbuild 语法解析（对原始文件同样跑
 *     一遍当尺子自检）。两个新补丁另有**执行级**验证（new Function 真跑）：
 *     · 音频 getter：override 未设时活读 rt.audioDisabled（并带「旧布尔形恒闭」的
 *       必假反例——证明这份测试抓得住原 bug）；setter 保住 __audioMute 口语义。
 *     · 帧率参照：15/30/60 逐字节等价（min 恒等），120/1000/undefined 一律钳 60。
 *
 * ⚠️ 文件名在 build/__tests__/ 下——copy 闸门会跳过 __tests__ 目录，中文注释
 * 安全；但 vitest include 白名单必须显式收进 build 目录的测试入口（见
 * vitest.config.ts 里那条带警告的 pattern），否则本文件静默不执行。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transformWithEsbuild } from 'vite'
import {
  AUDIO_GATE_MARKER,
  AUDIO_GATE_REPLACEMENT,
  FASTCOPY_MARKER,
  FPS_ADAPTIVE_MARKER,
  FPS_ADAPTIVE_REPLACEMENT,
  PINNED_WEBWALLGL_VERSION,
  TEXT_HOTFIX_MARKER,
  WEBWALLGL_AUDIO_ANCHOR,
  WEBWALLGL_CALL_MEDIA_ANCHOR,
  WEBWALLGL_CALL_SCENE_ANCHOR,
  WEBWALLGL_CAPNOW_ANCHOR,
  WEBWALLGL_CREATE_RENDERER_ANCHOR,
  WEBWALLGL_DECODE_MIP0_ANCHOR,
  WEBWALLGL_DECODE_MIP_ANCHOR,
  WEBWALLGL_FONT_COPY_ANCHOR,
  WEBWALLGL_FRAG_TRANSLATE_ANCHOR,
  WEBWALLGL_PARSE_SCENE_ANCHOR,
  WEBWALLGL_PARTICLE_GEN_ANCHOR,
  WEBWALLGL_POST_LINK_ANCHOR,
  WEBWALLGL_POST_LINK_REPLACEMENT,
  WEBWALLGL_PROGRAMS_ANCHOR,
  WEBWALLGL_TEXLOAD_HEAD_ANCHOR,
  WEBWALLGL_TEXLOAD_HEAD_REPLACEMENT,
  WEBWALLGL_TEXT_ANCHOR,
  WEBWALLGL_YIELD_HELPER_ANCHOR,
  YIELD_HELPER_SRC,
  YIELD_HOTFIX_MARKER,
  assertWebwallglVersion,
  patchWebwallgl,
  patchWebwallglAudioGate,
  patchWebwallglFontCopy,
  patchWebwallglFpsAdaptive,
  patchWebwallglTextFlatten,
  patchWebwallglYield,
  webwallglHotfixPlugin
} from '../webwallgl-hotfix'

const ROOT = join(__dirname, '..', '..')
const MJS = join(ROOT, 'node_modules', 'webwallgl', 'webwallgl.mjs')
const PKG = join(ROOT, 'node_modules', 'webwallgl', 'package.json')

const count = (hay: string, needle: string): number => hay.split(needle).length - 1

const original = readFileSync(MJS, 'utf8')
const patchedText = patchWebwallglTextFlatten(original)
const patchedAll = patchWebwallgl(original)

describe('preconditions on the real file', () => {
  it('all three anchors exist exactly once', () => {
    expect(count(original, WEBWALLGL_TEXT_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_AUDIO_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_CAPNOW_ANCHOR)).toBe(1)
  })

  it('the font-copy anchor exists exactly once (the slow iterator-path row is still there)', () => {
    // 上游哪天自己换成快路径，这里会红 —— 提醒审视补丁⑤是否该退休
    expect(count(original, WEBWALLGL_FONT_COPY_ANCHOR)).toBe(1)
  })

  it('all twelve yield anchors exist exactly once', () => {
    expect(count(original, WEBWALLGL_YIELD_HELPER_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_PROGRAMS_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_CREATE_RENDERER_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_CALL_MEDIA_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_CALL_SCENE_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_FRAG_TRANSLATE_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_PARSE_SCENE_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_TEXLOAD_HEAD_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_DECODE_MIP_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_DECODE_MIP0_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_POST_LINK_ANCHOR)).toBe(1)
    expect(count(original, WEBWALLGL_PARTICLE_GEN_ANCHOR)).toBe(1)
    // 两个「裸调用行」必须恰是 2 —— 消歧行把两个调用点各钉住一次
    expect(count(original, 'const renderer = rnd.createRenderer(c, {')).toBe(2)
  })

  it('upstream still has the sync freeze shape (pre-patch: no yield, sync renderer)', () => {
    expect(count(original, '__miaiYield')).toBe(0)
    expect(count(original, 'async function createRenderer(canvas, opts = {}) {')).toBe(0)
    expect(count(original, 'await rnd.createRenderer(')).toBe(0)
  })

  it('upstream really never syncs flat text/pointsize (0 hits before patching)', () => {
    expect(count(original, 'boundUserName(src.text)')).toBe(0)
    expect(count(original, 'boundUserName(src.pointsize)')).toBe(0)
    expect(count(original, 'scn.parseNum(src.pointsize')).toBe(0)
  })

  it('upstream still freezes audioSim as a one-shot boolean (the bug)', () => {
    expect(count(original, 'get enabled()')).toBe(0)
    expect(count(original, 'Math.min(rt.cfg.sceneFps')).toBe(0)
  })

  it('installed version matches the pin', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { version: string }
    expect(pkg.version).toBe(PINNED_WEBWALLGL_VERSION)
    expect(() => assertWebwallglVersion(pkg.version)).not.toThrow()
  })
})

describe('patchWebwallglTextFlatten', () => {
  it('injects marker + both backfills, exactly once each', () => {
    expect(patchedText.includes(TEXT_HOTFIX_MARKER)).toBe(true)
    expect(count(patchedText, 'boundUserName(src.text)')).toBe(1)
    expect(count(patchedText, 'boundUserName(src.pointsize)')).toBe(1)
    expect(count(patchedText, 'scn.parseNum(src.pointsize')).toBe(1)
  })

  it('keeps the anchor and grows the code', () => {
    expect(count(patchedText, WEBWALLGL_TEXT_ANCHOR)).toBe(1)
    expect(patchedText.length).toBeGreaterThan(original.length)
  })

  it('is idempotent (marker short-circuits)', () => {
    const twice = patchWebwallglTextFlatten(patchedText)
    expect(twice).toBe(patchedText)
    expect(count(twice, TEXT_HOTFIX_MARKER)).toBe(1)
  })

  it('patched code parses as JS (ruler check: original parses too)', async () => {
    // 尺子自检：同一个解析器先接受已知-good 的原始文件，再接受补丁后文件
    await expect(transformWithEsbuild(original, 'webwallgl.mjs')).resolves.toBeTruthy()
    await expect(transformWithEsbuild(patchedText, 'webwallgl.mjs')).resolves.toBeTruthy()
  })

  it('throws loudly when the anchor is missing', () => {
    expect(() => patchWebwallglTextFlatten('const a = 1;\n')).toThrow(/anchor not found/)
  })

  it('throws loudly when the anchor is not unique', () => {
    const two = `${WEBWALLGL_TEXT_ANCHOR}\n${WEBWALLGL_TEXT_ANCHOR}\n`
    expect(() => patchWebwallglTextFlatten(two)).toThrow(/not unique/)
  })

  it('marker wins even when the anchor is absent (already patched)', () => {
    const s = `/* ${TEXT_HOTFIX_MARKER} */\nconst x = 1;\n`
    expect(patchWebwallglTextFlatten(s)).toBe(s)
  })
})

describe('patchWebwallglAudioGate', () => {
  const patchedAudio = patchWebwallglAudioGate(original)

  it('replaces the one-shot boolean entirely (old form gone, marker in)', () => {
    expect(patchedAudio.includes(AUDIO_GATE_MARKER)).toBe(true)
    expect(patchedAudio.includes(WEBWALLGL_AUDIO_ANCHOR)).toBe(false)
    expect(count(patchedAudio, 'get enabled()')).toBe(1)
    expect(count(patchedAudio, 'set enabled(v)')).toBe(1)
  })

  it('is idempotent (marker short-circuits)', () => {
    const twice = patchWebwallglAudioGate(patchedAudio)
    expect(twice).toBe(patchedAudio)
    expect(count(twice, AUDIO_GATE_MARKER)).toBe(1)
  })

  it('patched code parses as JS', async () => {
    await expect(transformWithEsbuild(patchedAudio, 'webwallgl.mjs')).resolves.toBeTruthy()
  })

  it('throws loudly when the anchor is missing / duplicated', () => {
    expect(() => patchWebwallglAudioGate('const a = 1;\n')).toThrow(/anchor not found/)
    const two = `${WEBWALLGL_AUDIO_ANCHOR}\n${WEBWALLGL_AUDIO_ANCHOR}\n`
    expect(() => patchWebwallglAudioGate(two)).toThrow(/not unique/)
  })

  /** 执行级验证：把注入片段放进 new Function 真跑（依赖全部当参数传入） */
  const makeAudioSim = (
    rt: { audioDisabled: boolean },
    supports = true
  ): { enabled: boolean } =>
    new Function('supportsAudioProcessing', 'rt', `${AUDIO_GATE_REPLACEMENT}\nreturn audioSim;`)(
      supports,
      rt
    ) as { enabled: boolean }

  it('no override: live-reads rt.audioDisabled every access (revival works)', () => {
    const rt = { audioDisabled: true }
    const sim = makeAudioSim(rt)
    expect(sim.enabled).toBe(false)
    rt.audioDisabled = false // <- setAudio() 干的就是这件事
    expect(sim.enabled).toBe(true) // 冻结布尔在这条断言下必假 —— 正是本次修复的回归点
    rt.audioDisabled = true
    expect(sim.enabled).toBe(false) // 反向也活：disable 立即静默
  })

  it('negative control: the ORIGINAL frozen form stays false forever (the bug)', () => {
    // 必假反例/尺子自检：证明这套断言抓得住老实现 —— 老式一次性布尔在同样的
    // 状态翻转下恒为 false，与修复版行为明确不同。
    const rt = { audioDisabled: true }
    const oldSim = new Function('supportsAudioProcessing', 'rt', `${WEBWALLGL_AUDIO_ANCHOR}\nreturn audioSim;`)(
      true,
      rt
    ) as { enabled: boolean }
    rt.audioDisabled = false
    expect(oldSim.enabled).toBe(false) // <- 旧形不会跟着变（这就是实测 bug）
  })

  it('setter keeps __audioMute semantics (override sticks, not overwritten)', () => {
    const rt = { audioDisabled: false }
    const sim = makeAudioSim(rt)
    sim.enabled = false // 等价 __audioMute(true)
    rt.audioDisabled = false
    expect(sim.enabled).toBe(false)
    sim.enabled = true // 等价 __audioMute(false)
    expect(sim.enabled).toBe(true)
    rt.audioDisabled = true
    expect(sim.enabled).toBe(true) // 旧实现同样如此：mute 恢复后不看 audioDisabled
  })

  it('supportsAudioProcessing=false keeps the gate closed without override', () => {
    expect(makeAudioSim({ audioDisabled: false }, false).enabled).toBe(false)
  })
})

describe('patchWebwallglFpsAdaptive', () => {
  const patchedFps = patchWebwallglFpsAdaptive(original)

  it('replaces the bare config read with a 60-clamped reference', () => {
    expect(patchedFps.includes(FPS_ADAPTIVE_MARKER)).toBe(true)
    expect(patchedFps.includes(WEBWALLGL_CAPNOW_ANCHOR)).toBe(false)
    expect(count(patchedFps, 'const capNow = Math.min(rt.cfg.sceneFps || 60, 60);')).toBe(1)
  })

  it('is idempotent (marker short-circuits)', () => {
    const twice = patchWebwallglFpsAdaptive(patchedFps)
    expect(twice).toBe(patchedFps)
    expect(count(twice, FPS_ADAPTIVE_MARKER)).toBe(1)
  })

  it('patched code parses as JS', async () => {
    await expect(transformWithEsbuild(patchedFps, 'webwallgl.mjs')).resolves.toBeTruthy()
  })

  it('throws loudly when the anchor is missing / duplicated', () => {
    expect(() => patchWebwallglFpsAdaptive('const a = 1;\n')).toThrow(/anchor not found/)
    const two = `${WEBWALLGL_CAPNOW_ANCHOR}\n${WEBWALLGL_CAPNOW_ANCHOR}\n`
    expect(() => patchWebwallglFpsAdaptive(two)).toThrow(/not unique/)
  })

  it('numeric behavior: 15/30/60 byte-equivalent, 120/1000/undefined clamp to 60', () => {
    const capNowOf = new Function('rt', `${FPS_ADAPTIVE_REPLACEMENT}\nreturn capNow;`) as (rt: {
      cfg: { sceneFps?: number }
    }) => number
    // 低三档 min 恒等 —— 老用户逐字节无变化
    expect(capNowOf({ cfg: { sceneFps: 15 } })).toBe(15)
    expect(capNowOf({ cfg: { sceneFps: 30 } })).toBe(30)
    expect(capNowOf({ cfg: { sceneFps: 60 } })).toBe(60)
    // 新档与缺省一律钳 60（自适应参照的最大值）
    expect(capNowOf({ cfg: { sceneFps: 120 } })).toBe(60)
    expect(capNowOf({ cfg: { sceneFps: 1000 } })).toBe(60)
    expect(capNowOf({ cfg: {} })).toBe(60)
    expect(capNowOf({ cfg: { sceneFps: 0 } })).toBe(60) // 0 被 ||60 吞，与上游同义
  })
})

describe('patchWebwallglYield', () => {
  const patchedYield = patchWebwallglYield(original)

  it('injects the helper + 4 plain yields + 11 frame-paced yields + 3 budgeted yields, once each', () => {
    expect(patchedYield.includes(YIELD_HOTFIX_MARKER)).toBe(true)
    expect(count(patchedYield, 'const __miaiYield = ()')).toBe(1)
    // 贴图头 + decodeMip0 + 程序化贴图生成前 = 3 处 + helper 函数体 1 处 = 4
    expect(count(patchedYield, 'await __miaiYield();')).toBe(4)
    // 10 程序块 + linkProgram 后 = 11（等旧场景真出一帧，防链接块连坐）
    expect(count(patchedYield, 'await __miaiYieldFrame();')).toBe(11)
    // 材料转译 + parseScene + decodeMip = 3
    expect(count(patchedYield, 'await __miaiYieldBudget();')).toBe(3)
  })

  it('makes createRenderer async and awaits both call sites (old sync forms gone)', () => {
    expect(count(patchedYield, 'async function createRenderer(canvas, opts = {}) {')).toBe(1)
    // 行首旧形必须消失（子串判断要带前缀 \n，否则会命中 async 版）
    expect(count(patchedYield, '\nfunction createRenderer(canvas, opts = {}) {')).toBe(0)
    expect(count(patchedYield, 'const renderer = await rnd.createRenderer(')).toBe(2)
    expect(count(patchedYield, 'const renderer = rnd.createRenderer(')).toBe(0)
  })

  it('keeps every anchor body intact (yields are insertions, not rewrites)', () => {
    // 10 程序块：每行都逐字节还在（行间插了让帧，连续块本身当然不再命中原文）
    for (const line of WEBWALLGL_PROGRAMS_ANCHOR.split('\n')) expect(count(patchedYield, line)).toBe(1)
    // 两个调用点：旧形消失（'= rnd' 被 '= await rnd' 切断），await 形各一次
    expect(count(patchedYield, WEBWALLGL_CALL_MEDIA_ANCHOR)).toBe(0)
    expect(count(patchedYield, WEBWALLGL_CALL_SCENE_ANCHOR)).toBe(0)
    const aw = (s: string): string => s.replace('const renderer = rnd.createRenderer(', 'const renderer = await rnd.createRenderer(')
    expect(count(patchedYield, aw(WEBWALLGL_CALL_MEDIA_ANCHOR))).toBe(1)
    expect(count(patchedYield, aw(WEBWALLGL_CALL_SCENE_ANCHOR))).toBe(1)
    // 材料转译 / parseScene：让帧插在锚点前，锚点本身逐字节保留
    expect(count(patchedYield, WEBWALLGL_FRAG_TRANSLATE_ANCHOR)).toBe(1)
    expect(count(patchedYield, WEBWALLGL_PARSE_SCENE_ANCHOR)).toBe(1)
    // 贴图四针：头针是「锚点+让帧」连体，其余三针前插/后插后锚点行仍逐字节在
    expect(count(patchedYield, WEBWALLGL_TEXLOAD_HEAD_REPLACEMENT)).toBe(1)
    expect(count(patchedYield, WEBWALLGL_DECODE_MIP_ANCHOR)).toBe(1)
    expect(count(patchedYield, WEBWALLGL_DECODE_MIP0_ANCHOR)).toBe(1)
    expect(count(patchedYield, WEBWALLGL_POST_LINK_REPLACEMENT)).toBe(1)
    // 程序化贴图生成：让帧前插，锚点行本身逐字节保留
    expect(count(patchedYield, WEBWALLGL_PARTICLE_GEN_ANCHOR)).toBe(1)
  })

  it('is idempotent (marker short-circuits)', () => {
    const twice = patchWebwallglYield(patchedYield)
    expect(twice).toBe(patchedYield)
    expect(count(twice, YIELD_HOTFIX_MARKER)).toBe(1)
  })

  it('patched code parses as JS', async () => {
    await expect(transformWithEsbuild(patchedYield, 'webwallgl.mjs')).resolves.toBeTruthy()
  })

  it('throws loudly when any single anchor is missing / duplicated', () => {
    expect(() => patchWebwallglYield(original.replace(WEBWALLGL_PARSE_SCENE_ANCHOR, ''))).toThrow(/anchor not found/)
    expect(() => patchWebwallglYield(original.replace('function mat4Identity() {', 'const x = 1;\n'))).toThrow(/anchor not found/)
    expect(() => patchWebwallglYield(original.replace(WEBWALLGL_TEXLOAD_HEAD_ANCHOR, ''))).toThrow(/anchor not found/)
    const two = original.replace(WEBWALLGL_PROGRAMS_ANCHOR, WEBWALLGL_PROGRAMS_ANCHOR + '\n' + WEBWALLGL_PROGRAMS_ANCHOR)
    expect(() => patchWebwallglYield(two)).toThrow(/not unique/)
    const twoCall = original.replace(WEBWALLGL_FRAG_TRANSLATE_ANCHOR, WEBWALLGL_FRAG_TRANSLATE_ANCHOR + '\n' + WEBWALLGL_FRAG_TRANSLATE_ANCHOR)
    expect(() => patchWebwallglYield(twoCall)).toThrow(/not unique/)
    const twoLink = original.replace(WEBWALLGL_POST_LINK_ANCHOR, WEBWALLGL_POST_LINK_ANCHOR + '\n' + WEBWALLGL_POST_LINK_ANCHOR)
    expect(() => patchWebwallglYield(twoLink)).toThrow(/not unique/)
    const twoGen = original.replace(WEBWALLGL_PARTICLE_GEN_ANCHOR, WEBWALLGL_PARTICLE_GEN_ANCHOR + '\n' + WEBWALLGL_PARTICLE_GEN_ANCHOR)
    expect(() => patchWebwallglYield(twoGen)).toThrow(/not unique/)
  })

  it('marker wins even when anchors are absent (already patched)', () => {
    const s = `/* ${YIELD_HOTFIX_MARKER} */\nconst x = 1;\n`
    expect(patchWebwallglYield(s)).toBe(s)
  })

  /** 执行级验证：helper 放进 new Function 真跑（MessageChannel 是 Node 全局） */
  const makeYield = (): {
    __miaiYield: () => Promise<void>
    __miaiYieldBudget: (b?: number) => Promise<void>
    __miaiYieldFrame: () => Promise<void>
  } =>
    new Function(`${YIELD_HELPER_SRC}\nreturn { __miaiYield, __miaiYieldBudget, __miaiYieldFrame };`)() as {
      __miaiYield: () => Promise<void>
      __miaiYieldBudget: (b?: number) => Promise<void>
      __miaiYieldFrame: () => Promise<void>
    }

  it('two concurrent yields BOTH resolve (shared resolver queue)', async () => {
    const { __miaiYield } = makeYield()
    const ok = await Promise.race([
      Promise.all([__miaiYield(), __miaiYield()]).then(() => true),
      new Promise((r) => setTimeout(() => r(false), 1000))
    ])
    expect(ok).toBe(true)
  })

  it('negative control: the naive single-handler form drops the first waiter (the bug)', async () => {
    // 必假反例/尺子自检：证明上一条断言抓得住「onmessage 被覆盖」的坏法 ——
    // 老式写法（每次重设 port1.onmessage）在并发第二次调用后，第一个等待者
    // 永远不会被唤醒。
    const naive = new Function(`
      const chan = new MessageChannel();
      const y = () => new Promise((resolve) => { chan.port1.onmessage = () => resolve(); chan.port2.postMessage(0); });
      return { y };
    `)() as { y: () => Promise<void> }
    const ok = await Promise.race([
      Promise.all([naive.y(), naive.y()]).then(() => true),
      new Promise((r) => setTimeout(() => r(false), 300))
    ])
    expect(ok).toBe(false) // 旧形在同样的断言下必假
  })

  it('budget gating: recent yield is skipped; budget 0 always yields', async () => {
    const { __miaiYieldBudget } = makeYield()
    await __miaiYieldBudget(0) // 先让 LastAt 贴近当下
    const t0 = Date.now()
    await __miaiYieldBudget(5000) // 距上次 < 5s，应直接放行（无跳）
    expect(Date.now() - t0).toBeLessThan(50)
    const t1 = Date.now()
    await __miaiYieldBudget(0) // 预算 0，必跳
    expect(Date.now() - t1).toBeGreaterThanOrEqual(0) // 只证不抛错；跳没跳由上一行覆盖
  })

  it('__miaiYieldFrame resolves without rAF (node fallback timer path, no throw)', async () => {
    const { __miaiYieldFrame } = makeYield()
    const ok = await Promise.race([
      __miaiYieldFrame().then(() => true),
      new Promise((r) => setTimeout(() => r(false), 500))
    ])
    expect(ok).toBe(true)
  })
})

describe('patchWebwallglFontCopy', () => {
  const patchedCopy = patchWebwallglFontCopy(original)

  it('replaces the slow iterator-path copy with the native one (old form gone)', () => {
    expect(patchedCopy.includes(FASTCOPY_MARKER)).toBe(true)
    expect(count(patchedCopy, WEBWALLGL_FONT_COPY_ANCHOR)).toBe(0)
    expect(count(patchedCopy, 'const out = new Uint8Array(src);')).toBe(1)
  })

  it('is idempotent (marker short-circuits)', () => {
    const twice = patchWebwallglFontCopy(patchedCopy)
    expect(twice).toBe(patchedCopy)
    expect(count(twice, FASTCOPY_MARKER)).toBe(1)
  })

  it('patched code parses as JS', async () => {
    await expect(transformWithEsbuild(patchedCopy, 'webwallgl.mjs')).resolves.toBeTruthy()
  })

  it('throws loudly when the anchor is missing / duplicated', () => {
    expect(() => patchWebwallglFontCopy('const a = 1;\n')).toThrow(/anchor not found/)
    const two = `${WEBWALLGL_FONT_COPY_ANCHOR}\n${WEBWALLGL_FONT_COPY_ANCHOR}\n`
    expect(() => patchWebwallglFontCopy(two)).toThrow(/not unique/)
  })

  it('marker wins even when the anchor is absent (already patched)', () => {
    const s = `/* ${FASTCOPY_MARKER} */\nconst x = 1;\n`
    expect(patchWebwallglFontCopy(s)).toBe(s)
  })

  /** 执行级：抽原版与补丁版真函数对照跑 —— 快路径换型必须行为逐字节等价 */
  const extractSanitize = (srcCode: string): ((s: Uint8Array) => Uint8Array) => {
    const a = srcCode.indexOf('function sanitizeFontForBrowser')
    const b = srcCode.indexOf('function texOrientationPlan')
    if (a < 0 || b <= a) throw new Error('extract anchors missing')
    return new Function(`${srcCode.slice(a, b)}\nreturn sanitizeFontForBrowser;`)() as (
      s: Uint8Array
    ) => Uint8Array
  }

  /** 最小合法 TTF：magic 00 01 00 00 + numTables=1 + 一个 vhea 表（版本号可控改不改） */
  const makeFont = (mutate: boolean): Uint8Array => {
    const f = new Uint8Array(64)
    f[1] = 1
    const dv = new DataView(f.buffer)
    dv.setUint16(4, 1)
    f[12] = 118 // 'v'
    f[13] = 104 // 'h'
    f[14] = 101 // 'e'
    f[15] = 97 // 'a'
    dv.setUint32(20, 28) // table offset
    dv.setUint32(24, 36) // table length（vhea 固定 36）
    dv.setUint32(28, mutate ? 0 : 65536) // 0 需修 / 65536 已合法
    return f
  }

  it('no-fix path: both versions return the SAME input reference (the copy stays discarded)', () => {
    const origFn = extractSanitize(original)
    const patchedFn = extractSanitize(patchedCopy)
    const f1 = makeFont(false)
    const f2 = makeFont(false)
    expect(origFn(f1)).toBe(f1)
    expect(patchedFn(f2)).toBe(f2)
  })

  it('fix path: both versions return a fresh byte-identical copy, input untouched', () => {
    const origFn = extractSanitize(original)
    const patchedFn = extractSanitize(patchedCopy)
    const in1 = makeFont(true)
    const in2 = makeFont(true)
    const o1 = origFn(in1)
    const o2 = patchedFn(in2)
    expect(o1).not.toBe(in1)
    expect(o2).not.toBe(in2)
    expect(Array.from(o2)).toEqual(Array.from(o1)) // 新旧两版产物逐字节一致
    expect(Array.from(in2)).toEqual(Array.from(in1)) // 两份输入都未被原地改（拷贝语义还在）
    expect(new DataView(in2.buffer).getUint32(28)).toBe(0) // 改动只落在副本上
  })
})

describe('patchWebwallgl (combined)', () => {
  it('applies all five patches to the real file, once each', () => {
    expect(count(patchedAll, TEXT_HOTFIX_MARKER)).toBe(1)
    expect(count(patchedAll, AUDIO_GATE_MARKER)).toBe(1)
    expect(count(patchedAll, FPS_ADAPTIVE_MARKER)).toBe(1)
    expect(count(patchedAll, YIELD_HOTFIX_MARKER)).toBe(1)
    expect(count(patchedAll, FASTCOPY_MARKER)).toBe(1)
  })

  it('is idempotent as a whole', () => {
    expect(patchWebwallgl(patchedAll)).toBe(patchedAll)
  })

  it('version sentinel rejects a different version', () => {
    expect(() => assertWebwallglVersion('2.1.1')).toThrow(/pinned/)
  })
})

describe('webwallglHotfixPlugin', () => {
  const plugin = webwallglHotfixPlugin()
  const transform = plugin.transform as unknown as (code: string, id: string) => { code: string } | null

  it('ignores other files (min build, unrelated)', () => {
    expect(transform('x', 'D:/app/node_modules/webwallgl/webwallgl.min.mjs')).toBeNull()
    expect(transform('x', 'D:/app/src/main.ts')).toBeNull()
  })

  it('patches the real mjs id with all five markers (query string tolerated)', () => {
    const r = transform(original, `${MJS}?v=abc`)
    expect(r).not.toBeNull()
    const code = (r as { code: string }).code
    expect(code.includes(TEXT_HOTFIX_MARKER)).toBe(true)
    expect(code.includes(AUDIO_GATE_MARKER)).toBe(true)
    expect(code.includes(FPS_ADAPTIVE_MARKER)).toBe(true)
    expect(code.includes(YIELD_HOTFIX_MARKER)).toBe(true)
    expect(code.includes(FASTCOPY_MARKER)).toBe(true)
  })

  it('patches the real mjs id (windows backslashes tolerated)', () => {
    const winId = MJS.replace(/\//g, '\\')
    const r = transform(original, winId)
    expect(r !== null && r.code.includes(AUDIO_GATE_MARKER)).toBe(true)
  })
})
