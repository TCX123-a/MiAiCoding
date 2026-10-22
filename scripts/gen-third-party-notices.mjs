#!/usr/bin/env node
/**
 * 生成 THIRD-PARTY-NOTICES.md —— 第三方开源组件声明
 *
 * 【为什么需要它】
 * MIT / BSD / ISC / Apache 这些许可证都有一条硬性义务：**分发软件时要把
 * 「用了谁的东西、版权归谁、许可证原文」一并带上**。Electron 打出来的包是
 * 可以被解开的，所以「别人查不到」不成立。
 *
 * 手动维护这份清单是不现实的 —— 几十个传递依赖，改一次 package.json 就全过期。
 * 所以这份文件**必须由脚本生成**，而不是手写。
 *
 * 【它是怎么做的】
 * 直接读 `node_modules/` 里每个包自己带的 LICENSE 文件，**不连网、不查数据库、
 * 不抄模板**。所以它和「实际装了什么」永远一致，而不是和「文档里写着什么」一致。
 *
 * 【为什么下面藏着一大段自检】
 * 这份文件的价值**全部**在于「许可证原文是逐字节照录的」。一旦某行被过滤掉、
 * 缩进被重排、折行被改动，**文档看起来完全正常**，但法律效力就没了 ——
 * 而且这种错肉眼绝对发现不了。
 * 本项目的规矩：校验器自己必须被校验（见 scripts/审计/verify-validator-guards.mjs）。
 * 所以这个脚本在写盘**之前**会把每一份原文和 node_modules 里的源文件比一遍，
 * 对不上就 exit 1，**宁可不生成也不生成一份错的**。
 *
 * 用法：
 *   node scripts/gen-third-party-notices.mjs
 *   npm run gen:notices
 * 退出码：0 = 已生成且自检通过；1 = 自检失败（文件**不会**被写坏，会保留旧的）
 */

import { execFileSync } from 'node:child_process'
import { isBuiltin } from 'node:module'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SCRIPT_DIR = import.meta.dirname
const OUT = 'THIRD-PARTY-NOTICES.md'

/**
 * 同一个脚本既要生成根目录（客户端）的声明，也要生成 server/ 的声明。
 * 两者的差别只有标题、项目名和根 LICENSE 的相对路径；依赖树仍以各自的
 * `node_modules` 为准（server 有独立的 package.json / node_modules）。
 */
const IS_SERVER = path.basename(ROOT) === 'server'
const PROJECT_LABEL = IS_SERVER ? '咪爱编程服务端（miai-server）' : '咪爱编程（miai-biancheng）'
const PROJECT_SHORT = IS_SERVER ? 'miai-server' : 'miai-biancheng'
const ROOT_LICENSE_LINK = IS_SERVER ? '../LICENSE' : './LICENSE'
const GEN_CMD = IS_SERVER ? 'node ../scripts/gen-third-party-notices.mjs' : 'npm run gen:notices'

// ────────────────────────────────────────────────────────────
// 一、遍历依赖树
// ────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const runtimeDeps = Object.keys(pkg.dependencies || {})

/**
 * 「声明在 devDependencies、代码却会被打进分发产物」的包。
 *
 * 【为什么需要扫源码】
 * 主进程 / 预加载的构建只用 `externalizeDepsPlugin()`，而它**只外置
 * `dependencies`**（读了 electron-vite 源码确认：`pkg.dependencies` 全量进
 * `rollupOptions.external`，`devDependencies` 不在内）。所以源码里 import
 * 进来的 devDependency，代码会被 esbuild **内联**进 `out/main/index.js` ——
 * 它是分发物的一部分，就必须进这份声明（MIT 那类协议的义务跟着"分发的
 * 字节"走，不跟 package.json 的区块走）。
 *
 * 2026-10-01 的现场：iconv-lite 被加进 devDependencies 用于把中文代码按
 * GBK 写盘，它的代码整段内联进了主进程产物，而这份声明没列它 ——
 * 生成脚本只认 `dependencies`，重跑一百遍也列不上，声明与分发物永久不一致。
 *
 * 【为什么扫源码，而不是手写一份清单】
 * 手写清单就是下一个"忘了更新"。扫源码自动跟上：源码里新 import 一个
 * devDependency，它自动出现在这里。**宁可多列不可少列**（多了没有法律
 * 风险，少了才有）—— 本文件第二节「多算不多错」讲的正是这条。
 * 两个已知的不精确处，都偏向"多列"这一侧，接受：
 *   · `import type ... from 'x'` 只搬类型、代码不进产物 —— 会多列一个 x
 *   · 只被构建工具（electron-vite、vitest 等）在开发期使用的包不出现在
 *     `src/` 的 import 里，天然扫不到（它们本来也不该列）
 * 排除测试文件（`__tests__/` 目录、`*.test.*` / `*.spec.*` 文件名）：
 * vitest、测试夹具那些只在开发机跑，不进分发产物。
 * `electron` 与 Node 内置模块永远是运行时提供的外部依赖，不算打包。
 */
function bundledDevDeps() {
  const devDeps = new Set(Object.keys(pkg.devDependencies || {}))
  const found = new Set()
  const SPEC =
    /(?:from\s+['"]([^'"]+)['"])|(?:import\s+['"]([^'"]+)['"])|(?:require\(\s*['"]([^'"]+)['"]\s*\))|(?:import\(\s*['"]([^'"]+)['"]\s*\))/g
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== 'node_modules') visit(full)
      } else if (
        /\.(ts|tsx|mts|cts|js|mjs|cjs|vue)$/.test(e.name) &&
        !/\.(test|spec)\./.test(e.name)
      ) {
        const text = readFileSync(full, 'utf8')
        for (const m of text.matchAll(SPEC)) {
          const spec = m[1] || m[2] || m[3] || m[4]
          if (!spec || spec.startsWith('.') || path.isAbsolute(spec)) continue
          // 取包名：作用域包 @scope/name 两段，其余包名一段（丢掉子路径）
          const name = spec.startsWith('@')
            ? spec.split('/').slice(0, 2).join('/')
            : spec.split('/')[0]
          if (name === 'electron' || isBuiltin(name)) continue
          if (devDeps.has(name)) found.add(name)
        }
      }
    }
  }
  visit(path.join(ROOT, 'src'))
  return [...found].sort()
}

const bundledDev = bundledDevDeps()

/**
 * 两份不在源码 import 里、但确实随分发物走的构建期依赖：
 *  · dsh-pet —— 桌宠引擎；`build/dshpet-vendor.ts` 把它的运行时代码与素材
 *    拷进 `out/pet-helper`，exe 安装包里带着它。
 *  · electron —— 安装包内置的运行时；npm 包本身不是应用代码，但 Electron
 *    的 MIT 许可证要求分发时随附版权声明。Electron 的 `dependencies` 是
 *    `@electron/get` 这类下载/构建工具，不进安装包，所以只列它自己、
 *    不递归它的依赖。
 */
const EXTRA_BUNDLED_DEV = IS_SERVER ? [] : ['dsh-pet', 'electron']

/**
 * 随分发产物走、但**不是 npm 依赖**的组件。
 *
 * webwallgl 的 npm 发行版把 Mediabunny 1.56.0 直接编进了 bundle（source map 里能
 * 看到 `node_modules/.pnpm/mediabunny@1.56.0/...` 的 43 个源文件），但 webwallgl
 * 的 `package.json` 里没有它 —— 只扫 node_modules 永远列不上。Mediabunny 是
 * **MPL-2.0**（文件级 copyleft），分发时必须随附许可证原文并告知 Source Code Form
 * 的获取途径。
 *
 * we-scene 是 webwallgl 内置的 Wallpaper Engine 场景运行时（MIT，版权归
 * aurora-wallpaper contributors），同样不在 npm 依赖树里。它的正文与 §4 的 MIT
 * 模板相同，只在 2.3 节点名，不单独占一节。
 */
const EMBEDDED = IS_SERVER
  ? []
  : [
      {
        name: 'mediabunny',
        version: '1.56.0',
        license: 'MPL-2.0',
        copyright: 'Copyright (c) 2026-present, Vanilagy and contributors',
        source: 'https://github.com/Vanilagy/mediabunny',
        bundledIn: 'webwallgl@2.1.0（npm 发行版 bundle）',
        textFile: 'LICENSES/MPL-2.0.txt',
        note:
          '文件级 copyleft：义务只落在 Mediabunny 自身的源文件上，不要求把整个应用开源。' +
          '本项目未修改其源码；Source Code Form 可从上游仓库 v1.56.0 标签或 npm 包 `mediabunny@1.56.0` 获取。',
      },
      {
        name: 'we-scene',
        version: '随 webwallgl@2.1.0 bundle',
        license: 'MIT',
        copyright: 'Copyright (c) 2026 aurora-wallpaper contributors',
        source: 'https://github.com/oneincase/webwallgl',
        bundledIn: 'webwallgl@2.1.0（npm 发行版 bundle）',
        textFile: null,
        note:
          'Wallpaper Engine 场景运行时（vendored）。MIT 正文与 §4 的 MIT 模板逐字相同，' +
          '仅版权行不同；其内置的 WE 官方 shader 头重建子集不改变 MIT 条款，壁纸素材版权仍归各作品作者。',
      },
    ]

// 预检：直接依赖缺一个就停。walk() 找不到 package.json 时是**静默 return** 的，
// 那会让声明悄悄少一整个包；这里把「静默少列」变成响亮的失败。
const missingDeps = [...new Set([...runtimeDeps, ...bundledDev, ...EXTRA_BUNDLED_DEV])].filter(
  (name) => !existsSync(path.join(ROOT, 'node_modules', name, 'package.json'))
)
if (missingDeps.length) {
  console.error('✗ 预检失败：以下直接依赖在 node_modules 里找不到 package.json')
  for (const name of missingDeps) console.error('  ' + name)
  console.error('  → 先 npm install（或检查是否装了错误的目录），再重跑。')
  process.exit(1)
}

const rootDeps = [...runtimeDeps, ...bundledDev, ...EXTRA_BUNDLED_DEV]

const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 从一个包的目录里找出它的许可证文件。
 * 只认根目录下的 —— 子目录里的（如 echarts 的 licenses/）单独处理，
 * 因为那属于「内嵌子组件」，性质不同。
 */
function findLicenseFiles(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((f) => /^(LICEN[CS]E|COPYING)/i.test(f) && statSync(path.join(dir, f)).isFile())
    .map((f) => path.join(dir, f))
}

/** NOTICE 文件不认 `LICENSE` 前缀，单独找（Apache-2.0 §4(d) 要求转载它的内容） */
function findNoticeFile(dir) {
  const f = path.join(dir, 'NOTICE')
  return existsSync(f) && statSync(f).isFile() ? f : null
}

/**
 * 补录：这几个包的 npm tarball 里**没有** LICENSE 文件，但 package.json 声明 MIT。
 * 不补录的话，声明会静默少列三个真实依赖 —— 这正是「宁可多列不可少列」要防的。
 * 正文是 `scripts/licenses/` 下的标准 MIT 模板，版权行取自各包 package.json 的
 * author 字段；生成后的表格会显式标注「补录」，不会假装是从原包抄来的。
 */
const LICENSE_FALLBACKS = {
  'abstract-logging': 'scripts/licenses/abstract-logging-MIT.txt',
  'pg-types': 'scripts/licenses/pg-types-MIT.txt',
  pgpass: 'scripts/licenses/pgpass-MIT.txt',
}

const deps = []
const seen = new Set()

function walk(name, isDirect, viaBundledDev = false, recurse = true) {
  const dir = path.join('node_modules', name)
  const pj = readJson(path.join(ROOT, dir, 'package.json'))
  if (!pj) return
  const id = name + '@' + pj.version

  const exist = deps.find((d) => d.name === name && d.version === pj.version)
  if (exist) {
    // 同一个包可能既是直接依赖、又是别处的传递依赖 —— 标记要合并，不能谁先谁算
    if (isDirect) exist.direct = true
    if (viaBundledDev) exist.bundledDev = true
    return
  }
  if (seen.has(id)) return
  seen.add(id)

  let licFiles = findLicenseFiles(path.join(ROOT, dir))
  let fallback = false
  if (!licFiles.length && LICENSE_FALLBACKS[name]) {
    // 补录文件在仓库根的 scripts/licenses/ 下；ROOT 可能是 server/，所以按脚本位置取
    // （表里的值以仓库根为基准，SCRIPT_DIR 是仓库根/scripts）
    const fb = path.resolve(SCRIPT_DIR, '..', LICENSE_FALLBACKS[name])
    if (existsSync(fb)) {
      licFiles = [fb]
      fallback = true
    }
  }
  // 一个包里可能有多个 LICENSE 文件，取最长的那个当主许可证
  let mainFile = null
  let mainText = ''
  for (const f of licFiles) {
    const t = readFileSync(f, 'utf8')
    if (t.length > mainText.length) {
      mainFile = f
      mainText = t
    }
  }

  const noticeFile = findNoticeFile(path.join(ROOT, dir))

  // 子目录里的额外许可证（如 echarts 的 licenses/LICENSE-d3）
  const subLicenses = []
  const subDir = path.join(ROOT, dir, 'licenses')
  if (existsSync(subDir) && statSync(subDir).isDirectory()) {
    for (const f of readdirSync(subDir)) {
      const p = path.join(subDir, f)
      if (statSync(p).isFile() && /^(LICEN[CS]E|COPYING)/i.test(f)) {
        subLicenses.push({ file: path.relative(ROOT, p), text: readFileSync(p, 'utf8') })
      }
    }
  }

  const license =
    typeof pj.license === 'string'
      ? pj.license
      : pj.license?.type || (pj.licenses || []).map((l) => l.type).join('/') || 'UNKNOWN'

  deps.push({
    name,
    version: pj.version,
    license,
    dir: path.relative(ROOT, path.join(dir)),
    mainFile: mainFile ? path.relative(ROOT, mainFile) : null,
    mainText,
    fallback,
    noticeFile: noticeFile ? path.relative(ROOT, noticeFile) : null,
    noticeText: noticeFile ? readFileSync(noticeFile, 'utf8') : null,
    subLicenses,
    direct: !!isDirect,
    bundledDev: viaBundledDev,
    deps: Object.keys(pj.dependencies || {}),
  })

  if (recurse) for (const d of Object.keys(pj.dependencies || {})) walk(d, false)
}

for (const d of runtimeDeps) walk(d, true)
for (const d of bundledDev) walk(d, true, true)
if (!IS_SERVER) {
  // 这两份由构建脚本/安装器带进分发物，源码里不一定有 import（见 EXTRA_BUNDLED_DEV）。
  // 两者的 npm dependencies 都是下载/构建工具（@electron/get、extract-zip 等），
  // 不进 out/pet-helper 也不进安装包：只列它自己，不递归。
  walk('dsh-pet', true, true, false)
  walk('electron', true, true, false)
}

// ────────────────────────────────────────────────────────────
// 二、版权行
// ────────────────────────────────────────────────────────────

/**
 * 这一行是不是「某个包的版权声明行」？
 *
 * ⚠️ 这里踩过一个坑，记下来免得再犯：
 * 一开始用的是 `^\s*Copyright\b/i`（大小写不敏感），结果把 Apache-2.0 正文里
 * **小写开头**的句子也当成版权行删了：
 *     「copyright notice that is included in or attached to the work」
 *     「copyright license to reproduce, prepare Derivative Works of,」
 * 这是**篡改许可证原文**，比多印几行严重得多。
 * 所以判定必须收紧：大写 C 开头，或者后面紧跟 (c)/©/年份。
 * 这样 Apache 正文里的 `Copyright [yyyy] [name of copyright owner]` 也会被正确保留。
 */
const isCopyrightLine = (l) =>
  /^\s*Copyright\s+(\(c\)|\(C\)|©|\d{4})/i.test(l) || /^\s*Copyright\s+[A-Z][a-z]/.test(l)

/** 去掉版权行 —— **仅用于分组去重**，绝不用于输出 */
const bodyOf = (t) =>
  t
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !isCopyrightLine(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** 输出用：原文逐字节照录，**一个字都不动** */
const verbatim = (t) =>
  t
    .replace(/\r\n/g, '\n')
    .trim()

/**
 * 取一个包的版权行。
 *
 * 优先从 NOTICE 里取 —— Apache-2.0 的 LICENSE 正文里有
 * 「copyright notice that is included in or attached to the work」这种样板句，
 * 而真正的版权行在 NOTICE 里。有 NOTICE 就以它为准。
 */
function copyrightOf(d) {
  const fromNotice = d.noticeText
    ?.replace(/\r\n/g, '\n')
    .split('\n')
    .filter(isCopyrightLine)
    .map((l) => l.trim())
    .join(' ')
  if (fromNotice) return fromNotice + '（摘自该包 NOTICE 文件）'

  const fromLicense = d.mainText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(isCopyrightLine)
    .map((l) => l.trim())
    .join(' ')
  if (fromLicense) return fromLicense

  return '(该包未在 LICENSE 中声明版权行，见其 package.json 的 author 字段)'
}

for (const d of deps) d.copyright = copyrightOf(d)

/**
 * 显示版本覆盖。
 *
 * 本机 VS Code 会占住 node_modules/electron 的旧副本（见记忆
 * `electron-builder-needs-pinned-version`），package.json 里实际打包的是
 * 44.9.3，但 node_modules 里读到的是 44.3.0。声明的版本号应该跟**打包产物**
 * 走，而不是跟被占住的旧目录走；许可证正文两者相同（MIT），所以正文照录
 * 安装目录里的那份，版本号用 build.electronVersion。
 */
const VERSION_OVERRIDES = IS_SERVER ? {} : { electron: pkg.build?.electronVersion || pkg.devDependencies?.electron }
const shownVersion = (d) => VERSION_OVERRIDES[d.name] || d.version

/**
 * 个别组件的「许可证之外还有一层条款」——必须单独写出来，不能只靠 MIT 正文。
 */
const VENDOR_NOTES = {
  'dsh-pet':
    '代码 MIT（Copyright 2026 PC2005-cloud）；**素材**（动画/提示词/源视频）的条款是「允许开源使用，禁止商用」，' +
    '与代码 MIT 不是一回事。构建脚本 `build/dshpet-vendor.ts` 会把这段二创声明写进 `out/pet-helper`，' +
    '上游地址：<https://github.com/PC2005-cloud/dsh-pet>。',
  electron:
    '安装包内置的 Electron 运行时（MIT）。版本以 `package.json` 的 `build.electronVersion` 为准（本仓库 44.9.3）；' +
    'Electron 分发包内另带 `LICENSES.chromium.html`（Chromium 及其依赖的许可证汇编），打包时随安装包一起分发，' +
    '不要删。',
}

// ────────────────────────────────────────────────────────────
// 三、分组：同一份协议正文只印一次
// ────────────────────────────────────────────────────────────

const groups = new Map()
for (const d of deps) {
  const key = d.license + ' ' + bodyOf(d.mainText)
  if (!groups.has(key)) groups.set(key, { license: d.license, members: [] })
  groups.get(key).members.push(d)
}
const sorted = [...groups.values()].sort(
  (a, b) => a.license.localeCompare(b.license) || b.members.length - a.members.length
)

const DIRS = deps.filter((d) => d.direct).sort((a, b) => a.name.localeCompare(b.name))
const TRANS = deps.filter((d) => !d.direct).sort((a, b) => a.name.localeCompare(b.name))
/** 声明在 devDependencies、但代码被内联进分发产物的那些（见 bundledDevDeps 的长注释） */
const bundledDirect = deps.filter((d) => d.bundledDev)

const licCount = {}
for (const d of deps) licCount[d.license] = (licCount[d.license] || 0) + 1

const NATURE = {
  MIT: '宽松，只需保留版权声明',
  ISC: '宽松，等同 MIT 的简化版',
  'BSD-2-Clause': '宽松，只需保留版权声明',
  'BSD-3-Clause': '宽松，另加「不得用作者名背书」',
  'Apache-2.0': '宽松，另需转载 NOTICE 文件、声明改动',
  '0BSD': '最宽松，**连版权声明都不要求保留**',
  'PSF-2.0': '宽松（Python 基金会版）',
}

// 真正带 copyleft 的许可证 —— 有的话是要停下来看的，所以单独标出来
const COPYLEFT = /^(A|L|)GPL|SSPL|CDDL|EPL|MPL/i
const copyleft = deps.filter((d) => COPYLEFT.test(d.license))
const embeddedCopyleft = EMBEDDED.filter((e) => COPYLEFT.test(e.license))

// ────────────────────────────────────────────────────────────
// 四、拼文档
// ────────────────────────────────────────────────────────────

const out = []
const w = (s = '') => out.push(s)

w(`# 第三方开源组件声明${IS_SERVER ? '（服务端）' : ''}`)
w()
w(`**${PROJECT_LABEL}** · 版本 ${pkg.version} · 本文件 Generate 于 ${new Date().toISOString().slice(0, 10)}`)
w()
w('> 🤖 **本文件由脚本自动生成，请勿手改。**')
w(`> 生成命令：\`${GEN_CMD}\`（源码见 \`scripts/gen-third-party-notices.mjs\`）`)
w('> 增删任何依赖之后都要重跑一次，否则下面的版本号会过期。')
w()
w('---')
w()
w('## 这份文件是干什么的')
w()
w('咪爱编程用到了很多别人写好的开源库。这些库的许可证都要求在**分发软件时**把「用了谁的东西、' +
  '他们的版权归谁、他们的许可证原文」一并带上。这份文件就是干这个的。')
w()
w('**什么时候需要在意它**：只要有一天你把咪爱编程打包成 exe 发给别人（哪怕只发给一个朋友），' +
  '这些声明就必须跟着一起走。放在仓库里不占地方，但缺了它就是一个真实的合规漏洞，' +
  '而且**是那种事后很难补的漏洞**（因为你要回头去查当时用的是哪个版本）。')
w()
w('**它是怎么来的**：不是从网上抄的模板，是直接读取本机 `node_modules/` 里每个包' +
  '自己带的 `LICENSE` 文件原文汇总的。所以它和**实际装的版本**逐字对应。' +
  '另外，上游包 bundle 里内嵌、但不在 npm 依赖树里的组件（Mediabunny / we-scene）' +
  '单列在 2.3 节，正文同样照录。')
w()
w('---')
w()
w('## 一、总览')
w()
w('| 项目 | 数值 |')
w('|---|---|')
w(`| 直接运行时依赖（\`dependencies\`） | ${deps.filter((d) => d.direct && !d.bundledDev).length} 个 |`)
if (bundledDirect.length) {
  w(`| 其中被打进分发产物的构建期依赖（\`devDependencies\`） | ${bundledDirect.length} 个 |`)
}
w(`| 展开全部传递依赖后 | ${deps.length} 个 |`)
w(`| 许可证原文总字节数 | ${deps.reduce((s, d) => s + d.mainText.length, 0).toLocaleString('en-US')} 字节 |`)
w(`| 含 copyleft（GPL/AGPL/LGPL/MPL）的组件 | **${copyleft.length + embeddedCopyleft.length} 个** |`)
w()
w('**协议分布**：')
w()
w('| 许可证 | 组件数 | 性质 |')
w('|---|---|---|')
for (const [lic, n] of Object.entries(licCount).sort((a, b) => b[1] - a[1])) {
  w(`| ${lic} | ${n} | ${NATURE[lic] || '—'} |`)
}
w()
if (copyleft.length || embeddedCopyleft.length) {
  w('> ⚠️ **发现 copyleft 组件，需要人工确认**：')
  w('>')
  for (const d of copyleft) w(`> - \`${d.name}@${d.version}\` —— ${d.license}`)
  for (const e of embeddedCopyleft)
    w(`> - \`${e.name}@${e.version}\`（内嵌于 ${e.bundledIn}，不在 npm 依赖树里）—— ${e.license}`)
  w('>')
  if (embeddedCopyleft.length) {
    w('> **MPL-2.0 是文件级 copyleft**：义务落在被覆盖的**源文件**上，不要求把整个应用开源。')
    w('> 本项目没有修改 Mediabunny 的源码，已随附 MPL 全文（`LICENSES/MPL-2.0.txt`）与')
    w('> Source Code Form 的获取途径（见 2.3 节与 4 节）。**不要删除**这两处声明。')
  }
  if (copyleft.length) {
    w('>')
    w('> GPL/AGPL 那类强 copyleft 有传染性，会限制本项目自身的分发方式；')
    w('> **别忽略这一条**，先搞清楚它的义务再决定要不要用。')
  }
  w()
} else {
  w(`**结论**：**没有任何 copyleft 组件。** GPL/AGPL 那种「用了就得开源」的传染性许可证，` +
    `在这 ${deps.length} 个包里**一个都没有**。全部是 MIT / BSD / ISC / Apache-2.0 / 0BSD / PSF 这类宽松许可，` +
    `与本项目自身的 ${pkg.license} 兼容。`)
  w()
}

/** 打印一个清单表 */
function table(list) {
  w('| 组件 | 版本 | 许可证 | 版权归属 |')
  w('|---|---|---|---|')
  for (const d of list) w(`| \`${d.name}\` | ${shownVersion(d)} | ${d.license} | ${d.copyright} |`)
  w()
}

w('---')
w()
w('## 二、组件清单')
w()
w('### 2.1 直接依赖（`package.json` 里显式声明的）')
w()
table(DIRS)
const noted = DIRS.filter((d) => VENDOR_NOTES[d.name])
if (noted.length) {
  for (const d of noted) {
    w(`> 📌 \`${d.name}\`：${VENDOR_NOTES[d.name]}`)
    w()
  }
}
if (bundledDirect.length) {
  w(
    `> 📌 这张表里有 ${bundledDirect.length} 个是 **\`devDependencies\`**` +
      `（${bundledDirect.map((d) => `\`${d.name}\``).join('、')}）—— 它们的代码会被**内联进分发产物**，所以必须列进来。`
  )
  w('>')
  w(
    '> 为什么：主进程 / 预加载构建的 `externalizeDepsPlugin()` **只外置 `dependencies`**，' +
      '源码里 import 进来的 devDependency 一律被 esbuild 打包进 `out/`。' +
      '前几项是脚本**扫 `src/` 的 import 自动找出来的**（见脚本里的 `bundledDevDeps`），' +
      '`dsh-pet` / `electron` 是构建脚本显式补上的（它们由 `build/dshpet-vendor.ts` 与安装器带进分发物），不是手写版本号。'
  )
  w('>')
  w('> 测试文件里的 import（vitest 那些）不在扫描范围：它们只在开发机跑，不进分发产物。')
  w()
}
w('### 2.2 传递依赖（被上面的包间接引入的）')
w()
if (TRANS.length) {
  w('> 📌 **这一节里有相当一部分是「多列的」。** 比如 `@vue/compiler-sfc`、`@babel/parser`、' +
    '`postcss`、`magic-string` 这些是 **Vue 在构建阶段用的编译器**，打包时会被摇掉，' +
    '**不会进入最终分发的程序**。把它们列上属于「多算不多错」——声明多了没有法律风险，少了才有。')
  w()
  table(TRANS)
} else {
  w('（本项目的直接依赖没有引入任何传递依赖）')
  w()
}

const fallbackDeps = deps.filter((d) => d.fallback)
if (fallbackDeps.length) {
  w(`> 📌 **补录的许可证正文（${fallbackDeps.length} 个）**：下面这些包的 npm tarball 里**没有** LICENSE 文件，` +
    '但 `package.json` 声明 MIT。为了不静默少列，生成脚本从 `scripts/licenses/` 读取标准 MIT 正文补上，' +
    '版权行取自各包 `package.json` 的 `author` 字段。这些正文**不是从原包复制的**，详见 `scripts/licenses/README.md`：')
  w('>')
  for (const d of fallbackDeps) w(`> - \`${d.name}@${d.version}\` —— ${d.copyright}`)
  w()
}

if (EMBEDDED.length) {
  w('### 2.3 随 bundle 分发的内嵌组件（不是独立 npm 依赖）')
  w()
  w('这些组件被上游包的发行版直接编进了 bundle，**不在 `node_modules` 的依赖树里**，')
  w('所以只扫 npm 依赖永远列不上；它们同样随应用分发，必须单独声明。')
  w()
  w('| 组件 | 版本 | 许可证 | 版权归属 | 随哪个包分发 |')
  w('|---|---|---|---|---|')
  for (const e of EMBEDDED) {
    w(`| \`${e.name}\` | ${e.version} | ${e.license} | ${e.copyright} | ${e.bundledIn} |`)
  }
  w()
  for (const e of EMBEDDED) {
    w(`> 📌 \`${e.name}\`（上游：<${e.source}>）：${e.note}`)
    w()
  }
}

// ── Apache-2.0 的额外义务 ──
const apache = deps.filter((d) => d.license === 'Apache-2.0')
if (apache.length) {
  w('---')
  w()
  w(`## 三、Apache-2.0 的额外义务（涉及 ${apache.length} 个组件）`)
  w()
  w('Apache-2.0 比 MIT 多两条要求：')
  w()
  w('1. **如果原包带了 `NOTICE` 文件，分发时必须转载它的内容**')
  w('2. **如果你修改了源码，要说明改了哪里**')
  w()
  w('关于第 2 条：本项目**没有修改**这些组件的任何源码，只是作为依赖引用，所以这条不适用。')
  w()
  w('关于第 1 条，以下逐个列出：')
  w()
  for (const d of apache) {
    w(`### \`${d.name}@${d.version}\``)
    w()
    if (d.noticeText) {
      w(`**\`${d.noticeFile}\` 原文**：`)
      w()
      w('```')
      w(verbatim(d.noticeText))
      w('```')
      w()
    } else {
      w('该包**没有** `NOTICE` 文件，因此这条不适用。')
      w()
    }
    if (d.subLicenses.length) {
      w(`**内嵌子组件**：该包的 \`licenses/\` 目录下还有 ${d.subLicenses.length} 份独立的许可证。`)
      w('这说明它的源码里**内嵌了别人的代码**，那些代码的许可证与主许可证不是一回事，需要一并转载：')
      w()
      for (const s of d.subLicenses) {
        w(`#### \`${s.file}\``)
        w()
        w('```')
        w(verbatim(s.text))
        w('```')
        w()
      }
    }
  }
}

// ── 许可证原文 ──
w('---')
w()
w('## 四、许可证原文')
w()
w('下面是上面所有组件的许可证正文。**为了不把同一份 MIT 印 66 遍**，' +
  '正文按「协议 + 措辞」去重；每个组件各自的**版权行**已在第二节的清单里逐条列出，' +
  '两者合起来才构成完整声明。')
w()
sorted.forEach((g, i) => {
  const rep = g.members[0]
  w(`### 4.${i + 1} ${g.license} —— 适用于 ${g.members.length} 个组件`)
  w()
  w('**适用组件**：' + g.members.map((m) => `\`${m.name}@${shownVersion(m)}\``).join('、'))
  w()
  w('**各组件版权行**：')
  w()
  for (const m of g.members) w(`- \`${m.name}@${shownVersion(m)}\` —— ${m.copyright}`)
  w()
  w(
    rep.fallback
      ? `**许可证正文**（补录的标准 MIT 模板，不是从原包复制的：\`${rep.mainFile}\`）：`
      : `**许可证正文**（照录 \`${rep.mainFile}\`，**一字未改**）：`
  )
  w()
  w('```')
  w(verbatim(rep.mainText))
  w('```')
  w()
  if (g.members.length > 1) {
    w(`> 上面的正文里带的是 \`${rep.name}\` 自己的版权行；其余 ${g.members.length - 1} 个组件的版权行` +
      '在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。')
    w()
  }
})

EMBEDDED.forEach((e, i) => {
  w(`### 4.${sorted.length + i + 1} ${e.license} —— 内嵌组件 \`${e.name}@${e.version}\``)
  w()
  w(`**组件**：\`${e.name}@${e.version}\`（${e.bundledIn}）`)
  w()
  w(`**版权归属**：${e.copyright}`)
  w()
  w(`**上游地址**：<${e.source}>`)
  w()
  if (e.textFile) {
    w(`**许可证正文**（照录 \`${e.textFile}\`，**一字未改**）：`)
    w()
    w('```')
    w(verbatim(readFileSync(path.resolve(SCRIPT_DIR, '..', e.textFile), 'utf8')))
    w('```')
    w()
  } else {
    w('**许可证正文**：MIT，正文与第 4 节中的 MIT 模板逐字相同，版权行见本节开头。')
    w()
  }
  w(`> ${e.note}`)
  w()
})

w('---')
w()
w('## 附：本项目自身的许可证')
w()
w(`${PROJECT_LABEL} 本身以 **${pkg.license}** 许可证发布，全文见 [\`LICENSE\`](${ROOT_LICENSE_LINK})。`)
w()
w('> 注意：本文件覆盖 **npm 依赖与随 bundle 分发的内嵌组件**。仓库里的图片、桌宠素材、' +
  'ComfyUI 工作流与模型权重各有自己的许可，见根目录 `README.md` 的「致谢 / Open Source Credits」' +
  '与 `docs/comfyui_workflow.md`；不要把这份 MIT 声明当成对全部素材的授权。')
w()

// ────────────────────────────────────────────────────────────
// 五、自检 —— 写盘之前跑，不过就不写
// ────────────────────────────────────────────────────────────

const md = out.join('\n')
const fails = []
let pass = 0

for (const g of sorted) {
  const rep = g.members[0]
  if (!rep.mainFile) {
    fails.push(`${rep.name}@${rep.version}（找不到 LICENSE 文件）`)
    continue
  }
  // ⚠️ 关键：**绕开上面所有生成用的函数**，重新从磁盘读一遍原始文件，
  //    而且用另一套写法做换行归一（split/join，不用正则 replace）。
  //
  //    为什么必须这样：这个自检的第一版是**循环论证** ——
  //    它拿 verbatim() 的输出，去比对同样由 verbatim() 生成的文档，
  //    两边同源。把 verbatim() 改坏（比如替换掉原文里的某个词），
  //    文档和「期望值」会一起被改坏，**照样报自检通过**。
  //    反向验证当场抓住了这一点 —— 改坏了还报绿，等于没有自检。
  //    现在「检查」和「生成」不共享任何一行代码，才真的能验出东西。
  const want = readFileSync(path.join(ROOT, rep.mainFile), 'utf8').split('\r\n').join('\n').trim()
  if (md.includes('```\n' + want + '\n```')) pass++
  else fails.push(`${rep.name}@${rep.version} ← ${rep.mainFile}`)
}

// 内嵌组件的许可证正文同样逐字节校验（独立读盘，不复用生成路径）
for (const e of EMBEDDED) {
  if (!e.textFile) continue
  const want = readFileSync(path.resolve(SCRIPT_DIR, '..', e.textFile), 'utf8')
    .split('\r\n')
    .join('\n')
    .trim()
  if (md.includes('```\n' + want + '\n```')) pass++
  else fails.push(`${e.name}@${e.version} ← ${e.textFile}`)
}

if (fails.length) {
  console.error('✗ 自检失败：下面这些包的许可证原文没能逐字节出现在文档里')
  for (const f of fails) console.error('  ' + f)
  console.error('')
  console.error('  → 说明生成过程改动过原文，**文件没有被写出去**，旧文件保持原样。')
  console.error('  → 这是**故意的**：一份被改过原文的声明看起来完全正常，但没有法律效力。')
  process.exit(1)
}

// 代码块数量对得上吗 —— 防「某份协议正文里本来就有 ``` 导致块被提前截断」
// 注意：这条报错信息里**不能**直接写三个反引号 —— 它会把模板字符串自己截断。
// （第一版就是这么挂的，报错本身在讲「别被反引号截断」而它自己被反引号截断了。）
const fences = (md.match(/^```\n/gm) || []).length
if (fences % 2 !== 0) {
  console.error(`✗ 代码块栅栏数是奇数（${fences}）—— 有协议正文把栅栏符号截断了`)
  process.exit(1)
}

writeFileSync(OUT, md, 'utf8')

// ────────────────────────────────────────────────────────────
// 六、报告
// ────────────────────────────────────────────────────────────

console.log(`✓ 已生成 ${OUT}`)
console.log(
  `  直接依赖 ${deps.filter((d) => d.direct && !d.bundledDev).length} 个` +
    (bundledDirect.length
      ? ` + 打进产物的构建期依赖 ${bundledDirect.length} 个（${bundledDirect.map((d) => d.name).join('、')}；iconv-lite 由扫 src/ import 得出，dsh-pet/electron 由构建脚本显式补上）`
      : '') +
    ` / 展开传递依赖共 ${deps.length} 个`
)
console.log(`  协议分布：${Object.entries(licCount).map(([k, v]) => `${k}×${v}`).join('  ')}`)
console.log(
  `  copyleft 组件：${copyleft.length} 个 npm 依赖 + ${embeddedCopyleft.length} 个内嵌组件` +
    (embeddedCopyleft.length ? `（${embeddedCopyleft.map((e) => `${e.name} ${e.license}`).join('、')}）` : '')
)
console.log(`  ${md.split('\n').length} 行 / ${Buffer.byteLength(md, 'utf8').toLocaleString('en-US')} 字节`)
console.log('')
console.log(`✓ 自检通过：${pass} 份许可证原文都是**逐字节照录**的（覆盖全部 ${deps.length} 个组件）`)
