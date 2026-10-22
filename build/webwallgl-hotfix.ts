/**
 * webwallgl 构建期外科补丁集（2026-10-05 起；2026-10-08 扩成五个）。
 *
 * 五个补丁都遵循同一套纪律：**锚点唯一性**（全文件恰一次）+ **版本哨兵**
 * （PINNED 精确锁定）+ **幂等 marker**；锚点失踪/重复/版本漂移一律**响亮失败**
 * （构建红），绝不静默跳过 —— 补丁静默失效的坏法是「打包成功、功能还是坏的」，
 * 只在用户脸上暴露。升级 webwallgl 前后：先跑 build/__tests__/webwallgl-hotfix.test.ts，
 * 再逐条核对锚点与注入代码，最后放宽 PINNED_WEBWALLGL_VERSION。
 *
 * ⚠️ 本文件会被渲染层文案闸门（copy.test.ts）的 walk 扫到：**字符串一律英文**
 * （注入代码的注释也是——它进了产物），中文只在注释里。同理别写小写 `opacity:`。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ① 文字热更（2026-10-05）—— 见 patchWebwallglTextFlatten 的头注释。
 *
 * ② 音频闸门活体化（2026-10-06，[miai-audio-hotfix]）
 * 【病灶】挂载时 audio:null 的实例，audioSim.enabled 在 47285 行被求值一次后
 * **冻结成布尔**（闭包捕获）；之后宿主 setAudio(src) 只更新 rt.audioBridge 与
 * rt.audioDisabled，**没有任何路径重算 enabled** —— 闸门恒闭：每帧消费点
 * （setAudioProvider / 粒子 / hostAudio.pump）全部读这个布尔。实测症状 =
 * 「第一次打开应用加载壁纸，音频监控永久失效，切壁纸/重开窗都没用，只有整个
 * 重启才偶然恢复」（重启后挂载那一刻 rt.audioDisabled 恰好为 false）。
 * 【修法】把它换成**活体 getter**：无覆盖时逐次现读 `supportsAudioProcessing
 * && !rt.audioDisabled`（对既有行为逐字节等价：同一表达式，只是读取时机从
 * 「一次」变「每次」）；setter 保留 __audioMute 调试口语义。setAudio 会把
 * rt.audioDisabled 置 false ⇒ 闸门下一帧自动打开，hostAudio.pump 每帧都在跑，
 * 无需重挂即通。配套的渲染层自愈重试见 src/renderer/src/lib/wallpaper/audio.ts。
 *
 * ③ 自适应降档参照钳在 60（2026-10-06，[miai-fps-hotfix]）
 * 【病灶】渲染循环里 autoQuality 的参考帧率 capNow 直接取配置值
 * （rt.cfg.sceneFps || 60）。帧率档新增 120 / 无上限（哨兵 1000）后：
 * ADAPTIVE_FPS_RATIO=0.85 要求实测 fps ≥ cap×0.85 —— 60Hz 屏选 120 要求 102、
 * 任何屏选无上限要求 850，**永远达不到**，连续 3 秒低于阈值就往下降档
 * （high→medium→low→off），约 8 秒后后处理被误杀成 off。
 * 【修法】只钳**自适应参照与视频预算**（capNow = min(配置, 60)）：15/30/60 三档
 * 逐字节不变（min 恒等于原值），弱机保护线统一在「守不住 51fps 才降档」；
 * 闸门本身（FrameGate / occlusionFpsCap 用的 baseFps）**不动** —— 无上限照样
 * 每 rAF 提交、120 照样按 120 闸。不 clamp 的替代方案（参照用真实刷新率）需要
 * 引入显示器刷新率估计，且会把「限帧 30」的省电档误判（rAF 被节流时估计塌），
 * 得不偿失 —— 这条注释就是留给将来想改的人的。
 *
 * ④ 让帧（2026-10-08，[miai-yield-hotfix]，主机实测体感冻结的根治）
 * 【病灶】切换场景壁纸时旧场景「生生静止 0.x 秒」——冷挂载路径的同步重活全在
 * 同一条任务链上：createRenderer 内 10 个后处理程序背靠背 linkProgram（含驱动
 * 编译等待）、getEffectProgram 里 hlsl2glsl 手工转译、parseScene 的 JSON 解析。
 * rAF 被整段饿死（探针实测 8/8 轮 maxGap 258–716ms，随场景内容量变化）。
 * 【修法】在这些同步段之间插协作让帧点（MessageChannel 宏任务跳，不吃嵌套
 * setTimeout 的 4ms 钳、窗口遮挡也不停摆）；程序编译处用 __miaiYieldFrame
 * （等旧场景真出一帧，96ms 超时兜底）—— 60~80ms 的驱动链接块背靠背连坐
 * 是让帧后残余的主要超线来源；createRenderer 改 async（两个调用点
 * 都在 async IIFE 内，已同步 await）。细节与残渣边界见第 ④ 节头注释。
 *
 * ⑤ 大字体拷贝快路径（2026-10-08 深夜，[miai-fastcopy-hotfix]，642ms 冻结的终解）
 * 【病灶】冷切进带大字体 pkg 的场景，旧场景冻结 0.6~2s：长任务逐函数归因把一次
 * 770ms 长任务里的 642ms 采样钉在 sanitizeFontForBrowser（"消毒"）名下，可 node
 * 里同函数同数据只要 2.6ms —— 矛盾终解：不是消毒算法慢，是**拷贝行的 V8 路径
 * 差异**。Electron 渲染进程（Chrome 152）对 `Uint8Array.from(typedArray)` 走逐元素
 * 迭代器慢路径（页面实测 17MB = 1619ms；node 同调用 4.6ms），642ms 就是这一行。
 * 【修法】换成 `new Uint8Array(src)`（原生 typed-array 拷贝路径，页面实测 4ms；
 * 对一切能到达该行的输入形状逐字节等价 —— typed array 复制、array-like 逐元素
 * 转换；ArrayBuffer 在更上面的 magic 检查就返回了，根本到不了这行）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/** 补丁锚点正是为这个版本写的（package.json 里 webwallgl 也是精确锁 2.1.0） */
export const PINNED_WEBWALLGL_VERSION = '2.1.0'

// ---------------------------------------------------------------- 通用注入器

/**
 * 按锚点做外科替换：marker 在 → 幂等放行；锚点缺失/重复 → 抛错（构建红）。
 * 四个补丁共用这一份唯一性检查，别各写各的。
 */
function patchByAnchor(
  code: string,
  opts: { marker: string; anchor: string; replacement: string; what: string }
): string {
  if (code.includes(opts.marker)) return code
  const first = code.indexOf(opts.anchor)
  if (first === -1) {
    throw new Error(
      `${opts.what}: anchor not found -- webwallgl.mjs structure changed. ` +
        'Re-verify the patch (build/webwallgl-hotfix.ts) before building. Refusing to build unpatched.'
    )
  }
  if (code.indexOf(opts.anchor, first + 1) !== -1) {
    throw new Error(
      `${opts.what}: anchor is not unique -- refusing to patch blindly. ` +
        'Re-verify the patch (build/webwallgl-hotfix.ts).'
    )
  }
  return code.slice(0, first) + opts.replacement + code.slice(first + opts.anchor.length)
}

// ---------------------------------------------------------------- ① 文字热更

/** 幂等标记（出现在注入注释里）。已打过补丁的代码直接放行，重复 transform 无害 */
export const TEXT_HOTFIX_MARKER = '[miai-text-hotfix]'

/**
 * 唯一的注入锚点。webwallgl.mjs 2.1.0 全文件恰好命中一次（per-layer 循环里，
 * 正在 uVis/uCol 分支上方）；重复命中 = 文件结构变了，拒绝盲插。
 */
export const WEBWALLGL_TEXT_ANCHOR = 'resolveUserProps(src, properties, 0);'

/**
 * 注入块（10 空格缩进 = 循环体层级，与相邻代码一致）。
 * `scn` / `changed` / `boundUserName` 都是锚点处的在作用域符号（相邻行即用）。
 */
const TEXT_HOTFIX_INJECTED = `
          /*! ${TEXT_HOTFIX_MARKER} user-bound text/pointsize -> flat layer fields.
             Upstream syncs visible/color/alpha/brightness/radius/volume/... here but
             never text: updateTexts() reads the flat layer.text / layer.textPointsize,
             which otherwise keep the parse-time values forever -- edited "custom text"
             props reach scene.properties and resolve onto srcObject, yet the canvas
             never re-rasters (a remount does not help either). applyLiveProps nulls
             every textWidget lastKey at the end, so this write alone makes the next
             updateTexts tick re-raster. Re-verify this anchor when upgrading
             webwallgl (see build/webwallgl-hotfix.ts). */
          const uTxt = boundUserName(src.text);
          if (uTxt && uTxt in changed) {
            const tv = src.text && typeof src.text === "object" ? src.text.value : src.text;
            layer.text = tv == null ? "" : String(tv);
          }
          const uPts = boundUserName(src.pointsize);
          if (uPts && uPts in changed) {
            layer.textPointsize = scn.parseNum(src.pointsize, layer.textPointsize);
          }`

/**
 * 纯函数补丁：可单测。已打（marker 在）→ 原样放行；锚点缺失/重复 → 抛错。
 */
export function patchWebwallglTextFlatten(code: string): string {
  return patchByAnchor(code, {
    marker: TEXT_HOTFIX_MARKER,
    anchor: WEBWALLGL_TEXT_ANCHOR,
    replacement: WEBWALLGL_TEXT_ANCHOR + TEXT_HOTFIX_INJECTED,
    what: 'webwallgl text-flatten patch'
  })
}

// ---------------------------------------------------------------- ② 音频闸门活体化

export const AUDIO_GATE_MARKER = '[miai-audio-hotfix]'

/**
 * 锚点：audioSim 的一次性布尔（2.1.0 全文件恰一次）。换成活体 getter 后，
 * setAudio 更新的 rt.audioDisabled 每帧现读 —— 挂载后补源能真正开闸。
 */
export const WEBWALLGL_AUDIO_ANCHOR = 'const audioSim = { enabled: supportsAudioProcessing && !rt.audioDisabled };'

/**
 * 替换片段（同样进产物，注释英文）。为何用 IIFE 闭包而不是 `this._override`：
 * getter/setter 被解构/别名调用时 `this` 会丢，闭包变量不依赖调用形状。
 */
export const AUDIO_GATE_REPLACEMENT = `/*! ${AUDIO_GATE_MARKER} live gate. Upstream froze this boolean once at mount-time
   (${WEBWALLGL_AUDIO_ANCHOR.replace('const audioSim = ', '')}), so an instance mounted with audio:null could never
   be revived by a later setAudio() -- setAudio only flips rt.audioDisabled and the
   frozen flag stayed false, leaving every consumer (setAudioProvider / particles /
   hostAudio.pump) silent forever. This getter re-reads the same expression on every
   access (byte-equivalent when no override was set) and keeps __audioMute semantics
   through the setter. Re-verify this anchor when upgrading webwallgl. */
const audioSim = (() => {
  let miaiOverride = null;
  return {
    get enabled() { return miaiOverride === null ? (supportsAudioProcessing && !rt.audioDisabled) : miaiOverride; },
    set enabled(v) { miaiOverride = !!v; }
  };
})();`

export function patchWebwallglAudioGate(code: string): string {
  return patchByAnchor(code, {
    marker: AUDIO_GATE_MARKER,
    anchor: WEBWALLGL_AUDIO_ANCHOR,
    replacement: AUDIO_GATE_REPLACEMENT,
    what: 'webwallgl audio-gate patch'
  })
}

// ---------------------------------------------------------------- ③ 自适应降档参照钳 60

export const FPS_ADAPTIVE_MARKER = '[miai-fps-hotfix]'

/** 锚点：渲染循环里 autoQuality 的参照帧率（2.1.0 全文件恰一次，别用短式子） */
export const WEBWALLGL_CAPNOW_ANCHOR = 'const capNow = rt.cfg.sceneFps || 60;'

export const FPS_ADAPTIVE_REPLACEMENT = `/*! ${FPS_ADAPTIVE_MARKER} adaptive reference capped at 60. sceneFps can now be
   120 or 1000 (unlimited) -- the adaptive downgrades post-processing when measured
   fps < cap*0.85, which no display can satisfy for cap>~70 (60Hz panel + 120 target
   needs 102; unlimited needs 850), so quality would silently decay to off within
   seconds. Clamp ONLY this reference + the video budget: tiers 15/30/60 are
   byte-identical (min equals the old value), the degradation line stays "can't hold
   51fps", while the frame gate itself (FrameGate / occlusionFpsCap baseFps) still
   runs at the configured tier. Re-verify this anchor when upgrading webwallgl. */
const capNow = Math.min(rt.cfg.sceneFps || 60, 60);`

export function patchWebwallglFpsAdaptive(code: string): string {
  return patchByAnchor(code, {
    marker: FPS_ADAPTIVE_MARKER,
    anchor: WEBWALLGL_CAPNOW_ANCHOR,
    replacement: FPS_ADAPTIVE_REPLACEMENT,
    what: 'webwallgl fps-adaptive patch'
  })
}

// ---------------------------------------------------------------- ④ 让帧（2026-10-08 切换冻结根治）

/**
 * 病灶（探针实测，不是理论）：切换场景壁纸时旧场景「生生静止 0.x 秒」——
 * 冷挂载路径的主线程同步重活全在同一条任务链上：createRenderer 内部 10 个
 * 后处理程序背靠背 linkProgram（含驱动侧编译等待）、getEffectProgram 里 JS
 * 手工 HLSL→GLSL 转译（hlsl2glsl）、parseScene 的 JSON 解析 + 场景装配。
 * rAF 被整段饿死（探针 8/8 轮 maxGap 258–716ms，且冻结时长随场景内容量变化）。
 *
 * 【修法】在这些同步段之间插入**协作让帧点**：一个 MessageChannel 宏任务跳
 * （不是嵌套 setTimeout —— 会吃 4ms 钳；不依赖 rAF —— 窗口遮挡也不会停摆），
 * 已运行实例的渲染循环就能在块与块之间照常跑满。10 个程序之间用无条件让帧
 * （每个程序本来就是独立 chunk），材料转译/场景解析用 8ms 预算版（同一条链
 * 上多次到达也只按预算摊）。createRenderer 因此改成 async —— 全文件只有两个
 * 调用点，都在 async IIFE 里（媒体路径 / 场景挂载），已同步改 await。
 *
 * 【纹理阶段（2026-10-08 侦察后补针）】冷挂载的另一半大头在贴图加载：
 * loadTexInner 里 LZ4 解压 / DXT 解码 / decodeMip0(PNG) / texImage2D 上传全是
 * 同步段，且靠微任务糊在同一条任务链上（首轮 896ms 冻结 = 程序链接块 + 贴图块
 * 连坐）。修法四针：每张贴图进函数先无条件让帧（per-texture 任务边界）、
 * 压缩分支与 decodeMipLevel 之间按 8ms 预算让、PNG 分支 decodeMip0 前无条件让、
 * getEffectProgram linkProgram 之后无条件让（把链接后参数枚举拆出驱动等待）、
 * 程序化粒子贴图生成前无条件让（微任务粘住的生成器链拆成逐张任务）。
 *
 * 【未消灭的残渣（记录在案）】单次 linkProgram 内的驱动编译等待、单次
 * hlsl2glsl 的单块耗时、单张巨型贴图内部的单次 LZ4/DXT 解码无法从外部切开 ——
 * 让帧后的残留应 ≤ 单程序编译 / 单贴图解码时长。再往下压要动
 * KHR_parallel_shader_compile / Worker 级别的改造，收益/风险不成比例。
 *
 * 【升级 webwallgl 时】十二个锚点（helper / 10 程序块 / 声明 / 两个调用点 /
 * 材料转译 / 场景解析 / 贴图头 / decodeMip / decodeMip0 / linkProgram 后 /
 * 程序化贴图生成前）全部必须重新核对；任何一条对不上，构建期直接红。
 */
export const YIELD_HOTFIX_MARKER = '[miai-yield-hotfix]'

/** 锚点①：模块最顶部（mat4Identity 是全文件第一个函数定义，恰一次） */
export const WEBWALLGL_YIELD_HELPER_ANCHOR = 'function mat4Identity() {'

export const YIELD_HELPER_SRC = `/*! ${YIELD_HOTFIX_MARKER} cooperative main-thread yielding so mount-time sync bursts
   (10 post-process program links, HLSL->GLSL material translation, scene parse) cannot
   starve the rAF loop of already-running wallpaper instances (measured: 0.26-0.72s
   freezes per cold switch before this patch). Macrotask hop via MessageChannel: not
   clamped like nested setTimeout, and safe when the window is occluded. The shared
   resolver queue keeps concurrent yields (warm-up + active mounts) from overwriting
   each other. __miaiYieldFrame additionally waits for one real animation frame of the
   already-running instance (per-shader-program pacing: a 60-80ms driver link chained
   back-to-back with the next one was the remaining 148ms-plus stall) with a 96ms
   timeout so occluded/headless windows keep mounting. Re-verify this anchor when
   upgrading webwallgl. */
const __miaiYieldQueue = [];
const __miaiYieldChan = typeof MessageChannel === "function" ? new MessageChannel() : null;
if (__miaiYieldChan) __miaiYieldChan.port1.onmessage = () => { const w = __miaiYieldQueue.shift(); if (w) w(); };
const __miaiYield = () => new Promise((resolve) => {
  if (__miaiYieldChan) { __miaiYieldQueue.push(resolve); __miaiYieldChan.port2.postMessage(0); }
  else setTimeout(resolve, 0);
});
let __miaiYieldLastAt = 0;
const __miaiYieldBudget = async (budgetMs = 8) => {
  const now = performance.now();
  if (now - __miaiYieldLastAt < budgetMs) return;
  await __miaiYield();
  __miaiYieldLastAt = performance.now();
};
const __miaiYieldFrame = () => new Promise((resolve) => {
  let done = false;
  const fin = () => { if (!done) { done = true; resolve(); } };
  if (typeof requestAnimationFrame !== "function") { setTimeout(fin, 0); return; }
  const to = setTimeout(fin, 96);
  requestAnimationFrame(() => { clearTimeout(to); fin(); });
});
`

/** 锚点②：createRenderer 内 10 个后处理程序背靠背编译（恰一次） */
const PROG_LINES = [
  'const copyProg = glReg.program(linkProgram(gl, COPY_VERT, COPY_FRAG));',
  'const copyLitProg = glReg.program(linkProgram(gl, COPY_LIT_VERT, COPY_LIT_FRAG));',
  'const compProg = glReg.program(linkProgram(gl, COPY_VERT, COMPOSITE_FRAG));',
  'const backdropProg = glReg.program(linkProgram(gl, COPY_VERT, BACKDROP_FRAG));',
  'const bloomLightProg = glReg.program(linkProgram(gl, BLOOM_LIGHTMAP_VERT, BLOOM_LIGHTMAP_FRAG));',
  'const bloomBlurProg = glReg.program(linkProgram(gl, BLOOM_BLUR_VERT, BLOOM_BLUR_FRAG));',
  'const bloomApplyProg = glReg.program(linkProgram(gl, COPY_VERT, BLOOM_APPLY_FRAG));',
  'const compBlendProg = glReg.program(linkProgram(gl, COPY_VERT, COMPOSITE_BLEND_FRAG));',
  'const fxaaProg = glReg.program(linkProgram(gl, COPY_VERT, FXAA_FRAG));',
  'const tonemapProg = glReg.program(linkProgram(gl, COPY_VERT, TONEMAP_FRAG));'
]
export const WEBWALLGL_PROGRAMS_ANCHOR = PROG_LINES.map((l) => '  ' + l).join('\n')
export const WEBWALLGL_PROGRAMS_REPLACEMENT =
  PROG_LINES.map((l) => '  ' + l).join('\n  await __miaiYieldFrame();\n') + '\n  await __miaiYieldFrame();'

/** 锚点③：createRenderer 声明（恰一次）—— 改 async（两个调用点已 await） */
export const WEBWALLGL_CREATE_RENDERER_ANCHOR = 'function createRenderer(canvas, opts = {}) {'
export const WEBWALLGL_CREATE_RENDERER_REPLACEMENT = 'async function createRenderer(canvas, opts = {}) {'

/** 锚点④：媒体/网页壁纸路径的调用点（恰一次；末行 fboCapFactor 消歧） */
export const WEBWALLGL_CALL_MEDIA_ANCHOR =
  '      const renderer = rnd.createRenderer(c, {\n' +
  '        diag: (msg) => reportDiag(rt, cfg, `renderer: ${msg}`, classifyDiag(msg)),\n' +
  '        fboCapFactor: 0'
export const WEBWALLGL_CALL_MEDIA_REPLACEMENT = WEBWALLGL_CALL_MEDIA_ANCHOR.replace(
  'const renderer = rnd.createRenderer(',
  'const renderer = await rnd.createRenderer('
)

/** 锚点⑤：场景挂载路径的调用点（恰一次；末行 shaderResolver 消歧） */
export const WEBWALLGL_CALL_SCENE_ANCHOR =
  '      const renderer = rnd.createRenderer(c, {\n' + '        shaderResolver,'
export const WEBWALLGL_CALL_SCENE_REPLACEMENT = WEBWALLGL_CALL_SCENE_ANCHOR.replace(
  'const renderer = rnd.createRenderer(',
  'const renderer = await rnd.createRenderer('
)

/** 锚点⑥：getEffectProgram 里的 HLSL→GLSL 手工转译（恰一次） */
export const WEBWALLGL_FRAG_TRANSLATE_ANCHOR =
  '      const fragGlsl = rewriteXrayFragScale(hlsl2glsl(src.frag, "frag", effectiveCombos, resolver, src.vert));'

/** 锚点⑦：场景挂载 IIFE 的 parseScene（恰一次） */
export const WEBWALLGL_PARSE_SCENE_ANCHOR =
  '      const scene = scn.parseScene(JSON.parse(readText(sceneEntry)), project);'

/** 锚点⑧：贴图加载入口（恰一次）—— 每张贴图先让一帧，LZ4/DXT/上传各成独立任务 */
export const WEBWALLGL_TEXLOAD_HEAD_ANCHOR = '      const loadTexInner = async (name) => {'
export const WEBWALLGL_TEXLOAD_HEAD_REPLACEMENT =
  WEBWALLGL_TEXLOAD_HEAD_ANCHOR + '\n        await __miaiYield();'

/** 锚点⑨：压缩分支落空后接 CPU 解码处（恰一次）—— 把 LZ4/cropBlocks 与解码摊开 */
export const WEBWALLGL_DECODE_MIP_ANCHOR =
  '          const m0 = entry ? null : tex.decodeMipLevel(parsedTex, baseLevel);'

/** 锚点⑩：PNG/动图分支的 mip0 同步解码（恰一次）—— 重解码前无条件让帧 */
export const WEBWALLGL_DECODE_MIP0_ANCHOR = '        const m00 = tex.decodeMip0(parsedTex);'

/** 锚点⑪：getEffectProgram 链接完成后（恰一次，try 内）—— 等旧场景真出一帧，
 *  否则 60~80ms 的驱动链接块会与下一个背靠背连坐（实测 148ms+ 空档） */
export const WEBWALLGL_POST_LINK_ANCHOR =
  '          prog = glReg.program(linkProgram(gl, vertGlsl, fragGlsl));'
export const WEBWALLGL_POST_LINK_REPLACEMENT =
  WEBWALLGL_POST_LINK_ANCHOR + '\n          await __miaiYieldFrame();'

/**
 * 锚点⑫：程序化粒子贴图生成前（恰一次）—— 生成器 + 格式转换 + makeTextureMip 上传
 * 是一整段同步块，且被「已 resolve 的 await」（缓存命中的 readAsset/loadTex）用
 * **微任务**粘成一条任务链（微任务跳不还控制权，rAF 摸不到窗口）：一个场景几十个
 * 生成器（ringSheetAtlas/fogAtlas/rainSheet…）背靠背 = 实测 148ms 长任务
 * （wf5-attr 逐长任务归因：无单一大块，全是 5~26ms 的小块摊开）。逐张贴图让帧拆开。
 */
export const WEBWALLGL_PARTICLE_GEN_ANCHOR =
  '        let gen = ptex.buildBuiltinParticleTexture(name);'

/**
 * 与 patchByAnchor 同一套唯一性纪律，但不看 marker —— 只做一次插入/替换。
 * 整组幂等由 patchWebwallglYield 顶部的 marker 短路统一负责。
 */
function spliceOnce(code: string, anchor: string, build: (a: string) => string, what: string): string {
  const first = code.indexOf(anchor)
  if (first === -1) {
    throw new Error(
      `${what}: anchor not found -- webwallgl.mjs structure changed. ` +
        'Re-verify the patch (build/webwallgl-hotfix.ts) before building. Refusing to build unpatched.'
    )
  }
  if (code.indexOf(anchor, first + 1) !== -1) {
    throw new Error(
      `${what}: anchor is not unique -- refusing to patch blindly. ` +
        'Re-verify the patch (build/webwallgl-hotfix.ts).'
    )
  }
  return code.slice(0, first) + build(anchor) + code.slice(first + anchor.length)
}

/** 让帧补丁：十一锚点一体成组（helper 注释里的 marker 一命中即整组放行） */
export function patchWebwallglYield(code: string): string {
  if (code.includes(YIELD_HOTFIX_MARKER)) return code
  let out = code
  out = spliceOnce(out, WEBWALLGL_YIELD_HELPER_ANCHOR, (a) => YIELD_HELPER_SRC + a, 'yield patch: helper')
  out = spliceOnce(out, WEBWALLGL_PROGRAMS_ANCHOR, () => WEBWALLGL_PROGRAMS_REPLACEMENT, 'yield patch: program links')
  out = spliceOnce(out, WEBWALLGL_CREATE_RENDERER_ANCHOR, () => WEBWALLGL_CREATE_RENDERER_REPLACEMENT, 'yield patch: createRenderer async')
  out = spliceOnce(out, WEBWALLGL_CALL_MEDIA_ANCHOR, () => WEBWALLGL_CALL_MEDIA_REPLACEMENT, 'yield patch: media call site')
  out = spliceOnce(out, WEBWALLGL_CALL_SCENE_ANCHOR, () => WEBWALLGL_CALL_SCENE_REPLACEMENT, 'yield patch: scene call site')
  out = spliceOnce(out, WEBWALLGL_FRAG_TRANSLATE_ANCHOR, (a) => '      await __miaiYieldBudget();\n' + a, 'yield patch: material translate')
  out = spliceOnce(out, WEBWALLGL_PARSE_SCENE_ANCHOR, (a) => '      await __miaiYieldBudget();\n' + a, 'yield patch: parseScene')
  out = spliceOnce(out, WEBWALLGL_TEXLOAD_HEAD_ANCHOR, () => WEBWALLGL_TEXLOAD_HEAD_REPLACEMENT, 'yield patch: texture load head')
  out = spliceOnce(out, WEBWALLGL_DECODE_MIP_ANCHOR, (a) => '          await __miaiYieldBudget();\n' + a, 'yield patch: decodeMip split')
  out = spliceOnce(out, WEBWALLGL_DECODE_MIP0_ANCHOR, (a) => '        await __miaiYield();\n' + a, 'yield patch: decodeMip0')
  out = spliceOnce(out, WEBWALLGL_POST_LINK_ANCHOR, () => WEBWALLGL_POST_LINK_REPLACEMENT, 'yield patch: post-link')
  out = spliceOnce(out, WEBWALLGL_PARTICLE_GEN_ANCHOR, (a) => '        await __miaiYield();\n' + a, 'yield patch: particle texture gen')
  return out
}

// ---------------------------------------------------------------- ⑤ 大字体拷贝快路径

export const FASTCOPY_MARKER = '[miai-fastcopy-hotfix]'

/**
 * 锚点：sanitizeFontForBrowser 里唯一的一次全量拷贝（2.1.0 全文件恰一次；
 * `Uint8Array.from(` 在整份 mjs 里也只此一处）。
 */
export const WEBWALLGL_FONT_COPY_ANCHOR = 'const out = Uint8Array.from(src);'

export const FONT_COPY_REPLACEMENT = `/*! ${FASTCOPY_MARKER} native typed-array copy instead of the iterator path. Measured in
   the actual renderer (Chrome 152): Uint8Array.from(typedArray) walks element by element
   and blocks the main thread for 1.6-2.4s on a 17MB workshop font (Node runs the same
   call in ~5ms; the in-page profiler pinned 642ms of a scene-switch freeze on this very
   line). new Uint8Array(src) takes the native copy path (~4ms in-page) and yields
   byte-identical results for every input shape that can reach this line: typed arrays
   copy, plain array-likes convert element-wise, ArrayBuffers already returned at the
   magic check above. Re-verify this anchor when upgrading webwallgl. */
const out = new Uint8Array(src);`

export function patchWebwallglFontCopy(code: string): string {
  return patchByAnchor(code, {
    marker: FASTCOPY_MARKER,
    anchor: WEBWALLGL_FONT_COPY_ANCHOR,
    replacement: FONT_COPY_REPLACEMENT,
    what: 'webwallgl font-copy patch'
  })
}

// ---------------------------------------------------------------- 组合与插件

/** 五个补丁按序应用（各自幂等）。单测与插件共用这一份顺序。 */
export function patchWebwallgl(code: string): string {
  return patchWebwallglFontCopy(
    patchWebwallglYield(
      patchWebwallglFpsAdaptive(patchWebwallglAudioGate(patchWebwallglTextFlatten(code)))
    )
  )
}

/**
 * 版本哨兵：补丁按精确字节写的，换版本必须先人工重新核对（锚点检查是第二道，
 * 但版本对不上时先给出更直白的报错）。
 */
export function assertWebwallglVersion(actual: string): void {
  if (actual !== PINNED_WEBWALLGL_VERSION) {
    throw new Error(
      `webwallgl version is "${actual}", patch is pinned to "${PINNED_WEBWALLGL_VERSION}" -- ` +
        're-verify the patch anchors (build/webwallgl-hotfix.ts) before upgrading.'
    )
  }
}

/**
 * Vite 插件（挂在 renderer 上）。只处理 import 条件真正加载的 webwallgl.mjs
 * （不是 .min.mjs / .global.js）。id 可能带 ?query 或反斜杠，先规范化。
 */
export function webwallglHotfixPlugin(): Plugin {
  return {
    name: 'miai:webwallgl-hotfix',
    enforce: 'pre',
    transform(code, id) {
      const clean = id.split('?')[0].replace(/\\/g, '/')
      if (!/\/node_modules\/webwallgl\/webwallgl\.mjs$/.test(clean)) return null
      const pkg = JSON.parse(readFileSync(join(dirname(clean), 'package.json'), 'utf8')) as {
        version?: string
      }
      assertWebwallglVersion(String(pkg.version))
      // 构建期逐条行日志：补丁是「静默失效就完蛋」的那类东西，让每次构建都自曝证据
      const steps: Array<[string, (c: string) => string]> = [
        ['text-flatten', patchWebwallglTextFlatten],
        ['audio-gate', patchWebwallglAudioGate],
        ['fps-adaptive', patchWebwallglFpsAdaptive],
        ['yield-mount', patchWebwallglYield],
        ['font-fastcopy', patchWebwallglFontCopy]
      ]
      let out = code
      for (const [name, fn] of steps) {
        const next = fn(out)
        console.log(
          next === out
            ? `[miai:webwallgl-hotfix] ${name}: already applied (no-op)`
            : `[miai:webwallgl-hotfix] ${name}: patched (+${next.length - out.length} bytes)`
        )
        out = next
      }
      return { code: out, map: null }
    }
  }
}
