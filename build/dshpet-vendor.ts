/**
 * dsh-pet 素材与 helper 的「入库」插件（build/dshpet-vendor.ts，2026-10-06）
 *
 * 【为什么是构建期拷贝而不是把 61MB 素材塞进 git】
 * dsh-pet@0.3.5 是 devDependency，素材永远躺在 node_modules 里（可复现、可升级）；
 * 每次构建把它铺进 out/pet-helper/ —— 桌面部署只换 resources/app/out 一棵树，
 * helper 与素材搭同一班车。仓库与分享版 zip 都不长胖。
 *
 * 【铺什么】
 *   node_modules/dsh-pet/runtime/electron-helper/*  → out/pet-helper/（helper 本体）
 *   其中 sprite.js、index.html、main.js、pointer-target.js、preload.js、shared-core.js
 *   经 build/dshpet-patch.mjs 打咪爱补丁后落盘（sprite/index/main：右键菜单换成咪爱
 *   入口 + 注入 miai-extras.js 脚本行 + 「关闭大肥鱼」自退——helper 收到 pet-off 回包后
 *   app.exit(0)，宿主 TerminateProcess 在长寿命实例上会留下杀不动的 1 线程残骸——详见
 *   dshpet-patch.mjs 文件头 ③；pointer-target/main/preload：跟随穿透三件套；
 *   shared-core：右键菜单定位——菜单根落 __dshPetClampRect 可见带读数 + showPanel
 *   行锚定双翼（2026-10-10 图三/图四；2026-10-13 主人批·三级点不到——行锚定取代候选
 *   阶梯，另附 mouseleave 兜底 200→300ms）+ 置灰项分支（2026-10-16 V1-49——
 *   node.disabled 的菜单项在场但不可点，跟随没资格时的「跟着我走（差在哪）」用它）
 *   + 菜单树白名单与根标签（2026-10-16 夜 V1-30——buildMenuTree 收 menuEvents、事件组
 *   只列有数据源的、树根「动作」→「让大肥鱼做点什么」）+ 对话兜底文案（V1-37——
 *   失败/异常红字不再拼裸枚举与英文异常原文，换卖萌文案，技术原因转 console.warn）
 *   node_modules/dsh-pet/assets/*                  → out/pet-helper/assets/（106 个 webm + 贴图 + 字体 + config.jsonc）
 *   build/dshpet-extras/miai-extras.js             → out/pet-helper/miai-extras.js
 *     （小黄鸭音效 + 点击仲裁互动 + 跑腿位移/焦点上报 + 菜单饱腹行「标签 + 条」+
 *     跟随鼠标 / 关闭挽留位移 / 自主漫游节流闸门；
 *     标记 miai-chase / miai-hunger / miai-follow / miai-recall / miai-roam-gate 有铺后自检）
 *   src/renderer/public/pet/duck-click.wav         → out/pet-helper/assets/miai-assets/quack.wav
 *   node_modules/dsh-pet/LICENSE                   → out/pet-helper/LICENSE-dsh-pet.txt
 *   —— 再加一份 NOTICE.txt：素材使用条件要求署名，二创作品必须在介绍/展示/
 *   分发处附原作者地址（https://github.com/PC2005-cloud/dsh-pet）。
 *
 * 【为什么有这个 fingerprint 短路】dev 模式每次重启 electron-vite 都会
 * buildStart 一次；61MB 拷贝每次重来会让「改一行代码」的开发循环变成分钟级。
 * 源指纹（各输入文件 mtime+size + 手改逻辑时**必须手动 bump** 的 VENDOR_VERSION）
 * 不变、且产物关键件在场 → 跳过。产物被手删过 → 指纹校验里带「产物存在性」，
 * 自动重建（别信「上次拷过」）。
 *
 * 【为什么补丁模块缺席要响亮 throw】半成品仓库（A1/A2 文件还没落地）里
 * 悄悄铺一个「原版菜单」的 helper，构建日志一切正常、应用里右键还是别人的
 * 入口 —— 这正是最贵的静默坏法。宁可构建红。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync
} from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** 手改本文件逻辑时必须 +1：材质不看它，但补丁逻辑/文件清单变了它得说话 */
const VENDOR_VERSION = 16 // 16：shared-core.js 菜单树白名单（buildMenuTree 收 menuEvents，事件组只列
//                            有数据源的组）+ 树根标签「动作」→「让大肥鱼做点什么」+ 对话弹窗失败/
//                            异常兜底红字换卖萌文案（裸枚举与英文异常原文转 console.warn）；
//                            sprite.js 菜单「本地碎碎念」→「听大肥鱼碎碎念」、加「查看余额」条件项、
//                            菜单树拼接行传 this.pet.menuEvents（2026-10-16 夜 V1-30/V1-37，
//                            主人裁定余额要能看见 + V1-37 是 bug 要修）
// 15：shared-core.js 加菜单置灰项分支（node.disabled，V1-49：跟随没资格时
//                            「跟着我走（差在哪）」在场但不可点）+ sprite 菜单块该分支的产出行
//                            （2026-10-16 凌晨主人批「是bug要修」——上一版没资格时整项消失，
//                            用户开着跟随开关看不到任何解释）
// 14：shared-core.js 菜单定位改「行锚定双翼」——10-10 的候选阶梯把纵向
//                            放不下误当位置不可用、③④锚父面板而非触发行 ⇒ 底部行的子面板被
//                            甩到父面板上方几百像素、鼠标取道必离树 ⇒ 三级选项点不到
//                            （2026-10-13 主人批）；同时 mouseleave 兜底 200→300ms
// 13：+ shared-core.js 右键菜单边界翻折补丁（菜单根落 __dshPetClampRect +
//                            showPanel 候选阶梯；图三底行出屏/图四子菜单压父面板，2026-10-10 主人批）
// 12：跟随吞点击修复的**插桩位置**修正（放行规则必须在 inSprite 分支之后，
//                            否则跟随中鱼不可点；标记串因此带上了顺序，见 patch.mjs 的 POINTER_PATCH_MARKER）
// 11：+ 跟随吞点击修复（pointer-target.js/main.js/preload.js 三件套 followActive 2026-10-10）
// 10：+ 菜单跟随开关（跟着我走/别跟着啦）与 /miai/follow 路由（跟随/挽留/漫游闸门轮 2026-10-09）
// 9：+ 饱腹行改「标签 + 条」两段式（UI 大修轮 2026-10-09；标记 miai-hunger-v1 不变）
// 8：+ 菜单饱腹进度条铺后自检（miai-hunger 标记；P3 ③ 2026-10-08）
// 7：+ helper main.js 自退补丁（/miai/pet-off 回包后 app.exit，关宠不再靠 TerminateProcess）

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const SRC_HELPER = join(REPO, 'node_modules/dsh-pet/runtime/electron-helper')
const SRC_ASSETS = join(REPO, 'node_modules/dsh-pet/assets')
const SRC_LICENSE = join(REPO, 'node_modules/dsh-pet/LICENSE')
const EXTRAS_JS = join(REPO, 'build/dshpet-extras/miai-extras.js')
const PATCH_MJS = join(REPO, 'build/dshpet-patch.mjs')
const QUACK_SRC = join(REPO, 'src/renderer/public/pet/duck-click.wav')

interface PatchModule {
  isPatched(src: string): boolean
  patchSpriteJs(src: string): { code: string; applied: string[] }
  patchIndexHtml(src: string): { code: string; applied: string[] }
  isMainPatched(src: string): boolean
  patchMainJs(src: string): { code: string; applied: string[] }
  isPointerPatched(src: string): boolean
  patchPointerTargetJs(src: string): { code: string; applied: string[] }
  isPreloadPatched(src: string): boolean
  patchPreloadJs(src: string): { code: string; applied: string[] }
  isSharedCorePatched(src: string): boolean
  patchSharedCoreJs(src: string): { code: string; applied: string[] }
}

const NOTICE_TEXT = [
  'dsh-pet 桌宠引擎 · 二创声明',
  '=====================================',
  '',
  '本应用（咪爱编程）的桌面宠物功能基于开源项目 dsh-pet 二次创作：',
  '  https://github.com/PC2005-cloud/dsh-pet',
  '',
  '· 代码（runtime/electron-helper 及 lib）：MIT 许可',
  '· 美术/素材（assets/ 下的动画、贴图、字体）：原作者保留权利，禁止商用',
  '· 本应用对该项目的修改（补丁与扩展均为本地实现，不含对 dsh-pet 云端的调用；',
  '  聊天与余额查询经宿主桥走**用户自行配置的** DeepSeek API）：',
  '  - 右键菜单适配：跟随开关（跟着我走/别跟着啦；没资格跟随时该项在场但置灰，括号里注明差在哪）、咪爱设置入口（壁纸/AI）、喂一碗大白饭、',
  '    摸摸鱼头、听大肥鱼碎碎念、跟本鱼聊天、查看余额（接了 DeepSeek 钥匙时才有这一项）、关闭大肥鱼；',
  '  - 右键菜单树修补（shared-core.js）：原版把供应商动画整树（含本应用无数据源的组）',
  '    原样摆给用户、树根还是工程词「动作」。修补后事件组只列宿主名单内的、树根改',
  '    「让大肥鱼做点什么」；对话弹窗失败/异常的兜底红字不再拼裸枚举与英文异常原文，',
  '    换卖萌文案（技术原因转控制台）；',
  '  - 右键菜单定位修补（shared-core.js）：原版「右缘展开+翻转夹取」在窄可见带里会把',
  '    子菜单拉回父面板上、贴底打开的菜单底行留在屏幕外。修补后菜单根记录真实可见带',
  '    （__dshPetClampRect），子菜单按「行锚定双翼」定位——横向在触发行的左右两翼选位、',
  '    纵向以行顶锚定并贴底夹取（子面板纵向必罩住触发行，鼠标横移一步即进），',
  '    两翼都放不下才回落原逻辑；菜单指针离开兜底由 200ms 放宽到 300ms；',
  '  - 互动层注入（miai-extras.js）：小黄鸭点击音效、单击摸头/双击喂饭/连点 rua 的',
  '    点击仲裁与拖拽撤销、音效闸门（静音与音量随主程序设置）、跑腿位移（缓动走到',
  '    指定屏幕点）、跟随鼠标（指数趋近贴光标，拖拽/输入时自动让位，跟随期间窗口',
  '    余量区保持点击穿透）、跟随资格上报、关闭挽留位移（停靠到关闭按钮旁）、',
  '    自主漫游节流（饥饿分档减速）与窗口焦点上报；',
  '  - 命中判定修补（pointer-target.js / main.js / preload.js）：原判定在窗口余量区',
  '    「保持上一次状态」，跟随模式下窗口恒在光标之下 ⇒ 余量区永久可交互、吞掉整个',
  '    桌面的鼠标点击。修补后跟随中余量区一律穿透（宠物身体上仍可交互），由渲染端经',
  '    preload 上报跟随状态；未开启跟随时判定与原版逐字节等价；',
  '  - 行为大脑（咪爱主进程 dshpet/brain）：报错语言、答对表扬、饥饿与情绪、',
  '    问候台词等咪爱编程定制的台词与判定，由主进程充当其桥宿主。',
  '',
  '感谢原作者 PC2005-cloud 的开源分享。',
  ''
].join('\r\n')

function log(msg: string): void {
  console.log(`[dshpet-vendor] ${msg}`)
}

/** 递归拷贝目录（不依赖 fs.cpSync 的版本差异；覆盖已有文件） */
function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, ent.name)
    const d = join(dst, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else if (ent.isFile()) copyFileSync(s, d)
  }
}

function statSig(p: string): string {
  if (!existsSync(p)) return `${p}:missing`
  const st = statSync(p)
  return `${p}:${st.size}:${Math.round(st.mtimeMs)}`
}

function fingerprint(outRoot: string): string {
  const parts = [
    'V' + VENDOR_VERSION,
    statSig(join(SRC_HELPER, 'main.js')),
    statSig(join(SRC_HELPER, 'sprite.js')),
    statSig(join(SRC_HELPER, 'index.html')),
    statSig(join(SRC_HELPER, 'pointer-target.js')),
    statSig(join(SRC_HELPER, 'preload.js')),
    statSig(join(SRC_HELPER, 'shared-core.js')),
    statSig(join(SRC_ASSETS, 'config.jsonc')),
    statSig(join(SRC_ASSETS, 'webm')),
    statSig(EXTRAS_JS),
    statSig(PATCH_MJS),
    statSig(QUACK_SRC),
    statSig(SRC_LICENSE)
  ]
  // 产物关键件：被手删过就不许短路
  const outputs = [
    'main.js',
    'sprite.js',
    'index.html',
    'pointer-target.js',
    'preload.js',
    'shared-core.js',
    'miai-extras.js',
    'NOTICE.txt',
    join('assets', 'config.jsonc'),
    join('assets', 'miai-assets', 'quack.wav')
  ]
  for (const rel of outputs) {
    parts.push(existsSync(join(outRoot, rel)) ? `${rel}:ok` : `${rel}:MISSING`)
  }
  return parts.join('|')
}

async function vendor(outRoot: string): Promise<void> {
  // 前置件缺席 = 仓库处于半成品状态：响亮失败（理由见文件头）。
  if (!existsSync(PATCH_MJS)) {
    throw new Error(`[dshpet-vendor] 缺少补丁模块 ${PATCH_MJS}；拒绝铺一个未打补丁的 helper`)
  }
  if (!existsSync(EXTRAS_JS)) {
    throw new Error(`[dshpet-vendor] 缺少 ${EXTRAS_JS}；拒绝铺一个没有点击音效的 helper`)
  }
  if (!existsSync(QUACK_SRC)) {
    throw new Error(`[dshpet-vendor] 缺少 ${QUACK_SRC}（旧引擎退役前留下的鸭子音效）`)
  }
  const stampPath = join(outRoot, '.vendor-stamp')
  const fp = fingerprint(outRoot)
  if (existsSync(stampPath) && readFileSync(stampPath, 'utf8') === fp) {
    log('源与产物指纹一致，跳过拷贝')
    return
  }

  const t0 = Date.now()
  const patch = (await import(`file://${PATCH_MJS.replace(/\\/g, '/')}`)) as PatchModule

  // 1) helper 脚本（先整目录拷，再覆写两个被打补丁的文件）
  log('拷贝 helper 脚本…')
  copyDir(SRC_HELPER, outRoot)

  const spriteSrc = readFileSync(join(SRC_HELPER, 'sprite.js'), 'utf8')
  const spriteOut = patch.isPatched(spriteSrc)
    ? { code: spriteSrc, applied: [] as string[] }
    : patch.patchSpriteJs(spriteSrc)
  if (spriteOut.applied.length === 0 && !patch.isPatched(spriteOut.code)) {
    throw new Error('[dshpet-vendor] patchSpriteJs 没有报告任何替换，且结果未含补丁标记')
  }
  for (const a of spriteOut.applied) log(`  sprite.js: ${a}`)
  writeFileSync(join(outRoot, 'sprite.js'), spriteOut.code)

  const htmlSrc = readFileSync(join(SRC_HELPER, 'index.html'), 'utf8')
  const htmlOut = patch.patchIndexHtml(htmlSrc)
  for (const a of htmlOut.applied) log(`  index.html: ${a}`)
  writeFileSync(join(outRoot, 'index.html'), htmlOut.code)

  const mainSrc = readFileSync(join(SRC_HELPER, 'main.js'), 'utf8')
  const mainOut = patch.isMainPatched(mainSrc)
    ? { code: mainSrc, applied: [] as string[] }
    : patch.patchMainJs(mainSrc)
  if (mainOut.applied.length === 0 && !patch.isMainPatched(mainOut.code)) {
    throw new Error('[dshpet-vendor] patchMainJs 没有报告任何替换，且结果未含补丁标记')
  }
  for (const a of mainOut.applied) log(`  main.js: ${a}`)
  writeFileSync(join(outRoot, 'main.js'), mainOut.code)

  // 「跟随吞点击」修复的另一半（2026-10-10）：判定函数 + preload 桥。
  // 不补这两件 = 跟随期间整窗吃掉全桌面点击（用户实测的原始症状），日志却全绿。
  const pointerSrc = readFileSync(join(SRC_HELPER, 'pointer-target.js'), 'utf8')
  const pointerOut = patch.isPointerPatched(pointerSrc)
    ? { code: pointerSrc, applied: [] as string[] }
    : patch.patchPointerTargetJs(pointerSrc)
  for (const a of pointerOut.applied) log(`  pointer-target.js: ${a}`)
  writeFileSync(join(outRoot, 'pointer-target.js'), pointerOut.code)

  const preloadSrc = readFileSync(join(SRC_HELPER, 'preload.js'), 'utf8')
  const preloadOut = patch.isPreloadPatched(preloadSrc)
    ? { code: preloadSrc, applied: [] as string[] }
    : patch.patchPreloadJs(preloadSrc)
  for (const a of preloadOut.applied) log(`  preload.js: ${a}`)
  writeFileSync(join(outRoot, 'preload.js'), preloadOut.code)

  // 「右键菜单定位」修复（2026-10-10 图三/图四；2026-10-13 主人批·三级点不到）：菜单根落
  // 真实可见带读数 + showPanel 行锚定双翼 + mouseleave 兜底 200→300ms。
  // 零替换即红（与 sprite/main 同款判据）：半打补丁的 helper 不许落盘。
  const sharedSrc = readFileSync(join(SRC_HELPER, 'shared-core.js'), 'utf8')
  const sharedOut = patch.isSharedCorePatched(sharedSrc)
    ? { code: sharedSrc, applied: [] as string[] }
    : patch.patchSharedCoreJs(sharedSrc)
  if (sharedOut.applied.length === 0 && !patch.isSharedCorePatched(sharedOut.code)) {
    throw new Error('[dshpet-vendor] patchSharedCoreJs 没有报告任何替换，且结果未含补丁标记')
  }
  for (const a of sharedOut.applied) log(`  shared-core.js: ${a}`)
  writeFileSync(join(outRoot, 'shared-core.js'), sharedOut.code)

  // 2) 素材（61MB，含 106 个 webm）
  log('拷贝素材（首次或素材更新时约 10 秒级）…')
  copyDir(SRC_ASSETS, join(outRoot, 'assets'))

  // 3) 咪爱附加件
  copyFileSync(EXTRAS_JS, join(outRoot, 'miai-extras.js'))
  const quackDir = join(outRoot, 'assets', 'miai-assets')
  mkdirSync(quackDir, { recursive: true })
  copyFileSync(QUACK_SRC, join(quackDir, 'quack.wav'))

  // 4) 许可与署名（素材使用条件的硬性要求，别当成可选项）
  copyFileSync(SRC_LICENSE, join(outRoot, 'LICENSE-dsh-pet.txt'))
  writeFileSync(join(outRoot, 'NOTICE.txt'), NOTICE_TEXT, 'utf8')

  // 5) 自检：铺完必须真在（日志说 ok、文件却不在场，是这套流程最怕的假绿）
  const must = [
    'main.js',
    'sprite.js',
    'index.html',
    'shared-core.js',
    'miai-extras.js',
    'NOTICE.txt',
    join('assets', 'config.jsonc'),
    join('assets', 'miai-assets', 'quack.wav')
  ]
  for (const rel of must) {
    if (!existsSync(join(outRoot, rel))) throw new Error(`[dshpet-vendor] 铺完却找不到 ${rel}`)
  }
  if (!readFileSync(join(outRoot, 'index.html'), 'utf8').includes('miai-extras.js')) {
    throw new Error('[dshpet-vendor] index.html 里没有 miai-extras.js 的脚本行')
  }
  if (!readFileSync(join(outRoot, 'sprite.js'), 'utf8').includes('miai-wallpaper')) {
    throw new Error('[dshpet-vendor] sprite.js 里没有咪爱菜单标记')
  }
  // main.js 自退补丁的铺后自检：上面「文件在场」只证明被拷了，证明不了拷完还打过补丁
  // （没打补丁 = 关宠又回到 TerminateProcess 慢杀，探针 8s 判据红、日志却全绿）
  if (!patch.isMainPatched(readFileSync(join(outRoot, 'main.js'), 'utf8'))) {
    throw new Error('[dshpet-vendor] main.js 里没有关宠自退补丁（/miai/pet-off → app.exit）')
  }
  // 跟随穿透三件套的铺后自检（2026-10-10）：上面「文件在场」只证明被拷了，证明不了打过补丁。
  // 不补 = 跟随期间整窗吃掉全桌面点击（用户实测症状），而日志全绿。
  const mainOutSrc = readFileSync(join(outRoot, 'main.js'), 'utf8')
  if (!mainOutSrc.includes('pet:follow-active')) {
    throw new Error('[dshpet-vendor] main.js 里没有跟随穿透补丁（pet:follow-active）')
  }
  if (!mainOutSrc.includes("followActive.get(win.id) === true")) {
    throw new Error('[dshpet-vendor] main.js 的兜底轮询没有吃上 followActive 实参（半打补丁）')
  }
  if (!patch.isPointerPatched(readFileSync(join(outRoot, 'pointer-target.js'), 'utf8'))) {
    throw new Error('[dshpet-vendor] pointer-target.js 里没有跟随余量区穿透补丁（跟随会吞掉全桌面点击）')
  }
  if (!patch.isPreloadPatched(readFileSync(join(outRoot, 'preload.js'), 'utf8'))) {
    throw new Error('[dshpet-vendor] preload.js 里没有 setFollowActive（渲染端上报不了跟随状态）')
  }
  // shared-core 菜单定位补丁的铺后自检（2026-10-10 图三/图四；2026-10-13 主人批·三级点不到；
  // 2026-10-16 V1-49 置灰项分支、夜 V1-30 菜单树白名单/根标签、V1-37 对话兜底文案）：文件在场只证明
  // 被拷了，证明不了打过补丁 —— 没打 = 底行出屏/子面板被甩飞三级点不到、跟随没资格时的解释灰行画不出来、
  // 菜单里挂着无数据源的死组、对话失败把裸枚举红字甩给用户（菜单项变回整项消失），日志却全绿。
  if (!patch.isSharedCorePatched(readFileSync(join(outRoot, 'shared-core.js'), 'utf8'))) {
    throw new Error(
      '[dshpet-vendor] shared-core.js 里没有右键菜单补丁（__dshPetClampRect + 行锚定双翼 + 300ms 兜底 + 置灰项分支 + 菜单树白名单/根标签 + 对话兜底文案）'
    )
  }
  // extras 自己的标记自检：上面的"在场 + 脚本行"只证明文件被拷了，证明不了拷的是**打过扩展的那一版**
  //（铺了个旧副本 = 应用里 goto 叶子没人听 / 右键菜单没有饱腹行，日志却全绿）。
  // 标记串与 miai-extras.js 里的 `/* miai-chase-v1 */`、`/* miai-hunger-v1 */`、
  // `/* miai-follow-v1 */`、`/* miai-recall-v1 */`、`/* miai-roam-gate-v1 */` 同源。
  const extrasOut = readFileSync(join(outRoot, 'miai-extras.js'), 'utf8')
  if (!extrasOut.includes('miai-chase')) {
    throw new Error('[dshpet-vendor] miai-extras.js 里没有跑腿扩展标记（miai-chase）')
  }
  if (!extrasOut.includes('miai-hunger')) {
    throw new Error('[dshpet-vendor] miai-extras.js 里没有饱腹行标记（miai-hunger）')
  }
  if (!extrasOut.includes('miai-follow')) {
    throw new Error('[dshpet-vendor] miai-extras.js 里没有跟随扩展标记（miai-follow）')
  }
  if (!extrasOut.includes('miai-recall')) {
    throw new Error('[dshpet-vendor] miai-extras.js 里没有关闭挽留扩展标记（miai-recall）')
  }
  if (!extrasOut.includes('miai-roam-gate')) {
    throw new Error('[dshpet-vendor] miai-extras.js 里没有自主漫游闸门标记（miai-roam-gate）')
  }
  const webms = readdirSync(join(outRoot, 'assets', 'webm')).filter((f) => f.endsWith('.webm'))
  if (webms.length < 50) {
    throw new Error(`[dshpet-vendor] webm 素材只有 ${webms.length} 个（应为 100+），拷贝不完整`)
  }

  writeFileSync(stampPath, fingerprint(outRoot), 'utf8')
  log(`完成：${webms.length} 个动画素材，耗时 ${Date.now() - t0}ms`)
}

export function dshpetVendorPlugin(): Plugin {
  let outRoot = join(REPO, 'out', 'pet-helper')
  return {
    name: 'miai:dshpet-vendor',
    configResolved(config) {
      // electron-vite 的 main 构建 outDir 默认 out/main → 兄弟目录 out/pet-helper。
      // 【坑】解析后的 config.build.outDir 是**绝对路径**（D:\…\out\main），
      // 直接 join(root, abs) 会把 root 再叠一遍成 D:\…\D:\…\out\pet-helper
      // （buildStart 里 mkdir ENOENT 的现场）。resolve(root, outDir) 两种形态
      // 都吃：绝对路径原样返回、相对路径才挂到 root 下。
      const outDir = config.build?.outDir || 'out/main'
      const abs = resolve(resolve(config.root || REPO), outDir)
      outRoot = join(dirname(abs), 'pet-helper')
    },
    async buildStart() {
      await vendor(outRoot)
    }
  }
}
