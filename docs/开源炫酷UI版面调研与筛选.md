# 咪爱编程 · 开源炫酷 UI 版面调研与筛选

> **本文档是 [docs/12-开源项目借鉴清单](12-开源项目借鉴清单.md) 的续篇。**
> docs/12 管「技术选型 + 内容层范式」，本文管「**版面与观感**」，两者体例一致（🟢🟡🔴 三档 + 可信度分级）。
>
> 调研日期：**2026-09-14**。四路后台调研（组件库 / 动效库 / 学习类项目版面 / 授权红线）+ 本机实测。
>
> ⚠️ **本次调研没有向项目里下载任何东西，没有改动任何一行代码。** 所有体积数字是「真装包、真打包、真 gzip」量出来的，不是抄 bundlephobia 的估算。

---

## 〇、30 秒看懂这份文件

**一句话结论：**

> **我们缺的不是「组件」，是「版面的组织方式」和「动效」。**
> 所以本次调研**不建议引入任何整套组件库**（Element Plus / Naive UI / Vuetify 等一律不装），
> 建议走 **「自研版面壳 + 零依赖 CSS 动效 + 一个 3.4 KB 的小包」** 这条路。

**三张清单：**

| 标记 | 含义 | 主人要做什么 |
|---|---|---|
| 🟢 **【强烈推荐，完美契合】** | 拿来就用，或抄代码不违法 | 什么都不用做，点头就行 |
| 🟡 **【可以借鉴，需手动改造】** | 抄思路，或条件性引一个包 | 已排进方案，到时候照做 |
| 🔴 **【好看但不合适，不推荐】** | 别碰 | 什么都不用做，**别改主意就行** |

**可信度分级**（沿用 docs/12 的规矩，**别把【调研】当铁律看**）：

- **【实测】** = 真跑出来的数字（本机 `npm install` + esbuild 打包 + `gzip -9`、npm registry 原始字段、读我们自己的源码/配置）
- **【调研】** = 从官方文档 / 仓库源码 / 官方协议页读来的，**没在本机复现**
- **【推断】** = 逻辑推出来的，**缺实机验证**

---

## 一、地基：我们现在长什么样（所有评估的起点）

**这一节全部是【实测】—— 本喵逐条看了自己的代码。**

| 项 | 现状 | 对选型的意义 |
|---|---|---|
| 基础组件 | **19 个 `Mi*.vue` + `toast.ts`**（Button/Card/Modal/Drawer/Toast/Progress/Tabs/Select/Switch/Radio/Checkbox/Collapse/Divider/Empty/Input/Tag/Tooltip/Mascot/ProgressRing） | **我们**不**缺组件**。缺下拉、日期、虚拟列表这种「重型件」才值得谈引库 |
| 渲染层规模 | **40 个 `.vue`、5,947 行**；8 个视图 | 规模不大，改版面成本可控 |
| 设计令牌 | `src/renderer/src/styles/tokens.css`（89 行）**唯一真源** | 已有 CSS 变量体系 → 与「CSS 变量派」的库天然同构 |
| 工具类 CSS | **没有**。无 Tailwind、无 UnoCSS，全是 `<style scoped>` 普通 CSS | ⚠️ 网上「炫酷动效」代码**大多是 Tailwind 写的**，抄过来要手工翻译 |
| 组件挂载测试 | **零**。37 个测试文件全是逻辑测试 | 改版面**不会撞测试**，但也**没有自动安全网** |
| `prefers-reduced-motion` | **全项目 0 处** | 见 §二 第 4 条 |
| 版面壳 | `App.vue` **仅 77 行**，三栏 flex | **换版面本身很便宜** |
| 窗口 | 1200×780，最小 **1000×700**，系统标准边框 | ⚠️ 三栏吃掉 480px（左 220 + 右 260），默认只剩 **720px** 给主内容 —— **这是「炫酷」的天花板** |
| 依赖现状 | **16 个**运行时依赖（CodeMirror 全家 + echarts + highlight.js + markdown-it…），展开传递依赖共 **65 个** | 已经是重依赖项目，但**别再加最重的那个** |

### ⚠️ 1.1 两道硬闸门（这两条一票否决，必须先看）

**闸门一：CSP。**

`src/renderer/index.html:8` 写死了：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:
```

- `font-src 'self' data:` + `img-src 'self' data:` → **任何 CDN 字体/图标被硬拦**，没有商量余地
- `style-src ... 'unsafe-inline'` → CSS-in-JS 运行时插 `<style>` 是放行的（所以组件库不会被打死，但**这是 CSP 里唯一的放松点**，值得留意）

**闸门二：设计规范。**

| 出处 | 原文 | 冲突对象 |
|---|---|---|
| [docs/04:7](04-设计规范.md#L7) | 「**简洁、圆润、亲和力强**。大量使用圆角卡片、柔和阴影、可爱表情点缀；**避免工业感、极客感**」 | 霓虹辉光、赛博风、硬边科技感 |
| [docs/04:38](04-设计规范.md#L38) | 「阴影只用这两档，**禁止更重的投影**」 | 大量「悬浮卡片」效果用的多层重投影 |
| [docs/04:26](04-设计规范.md#L26) | 「红绿**只用于对/错/状态语义，不用于装饰**；v1 只做浅色主题」 | 彩色渐变背景、深色炫酷风 |
| [docs/04:68](04-设计规范.md#L68) | 「主要用 Unicode 表情，**不引外部图标库**」 | 所有自带图标包的组件库 |

> **所以本报告的核心张力在这儿**：主人要的是「炫酷」，但项目自己的宪法写的是「避免工业感」。
> **这两者不是不能调和** —— 能调和的交集叫 **「柔光」**：大范围低饱和渐变、缓慢呼吸、弹性缓动、圆润卡片。
> 调和不出来的那一半叫 **「硬核」**：粒子连线、霓虹描边、玻璃拟态、深色赛博 —— **这些本报告一律不推荐，理由不是它们不好看，是它们跟这只会陪人学编程的猫娘不搭。**

---

## 二、四道筛子（先筛掉活不下来的，再看好不好看）

候选表里的每一行，都按这四条过了一遍。**顺序就是优先级。**

| # | 筛子 | 判据 | 一票否决的例子 |
|---|---|---|---|
| 1 | **离线能活吗** | 不许有运行时网络请求；不许依赖 CDN | Vuetify（CDN 字体撞 CSP）、Vanta（要自备 three.js） |
| 2 | **许可干净吗** | 闭源商用免费 = 底线；**不能用 AGPL 的代码** | 一堆笔记软件（AGPL）、PrimeVue 5.x（商业授权） |
| 3 | **会不会跟 `tokens.css` 打架** | 引入后样式来源从 1 套变 2 套，就得立新规矩 | 整套组件库（它自带一整套设计语言） |
| 4 | **尊不尊重 `prefers-reduced-motion`** | 我们现在 0 处处理，**引的库最好自带** | 绝大多数动效库 |

> 第 4 条值得单独说一句：**我们现在一处都没处理**。这不是「以后再说」的事 —— 引入动效的那一天，就得同时引入「怎么关掉动效」。**唯一一个自动帮我们做了这件事的库，是 `@formkit/auto-animate`。**

---

## 三、候选清单（含安全评估）

### 🟢 强烈推荐，完美契合

#### 🟢 1. freeCodeCamp 的三栏「pane = 一个 flex 数字」模型

- **来源**：[freeCodeCamp/freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp) ★455,418 ｜ 源码 `client/src/templates/Challenges/classic/desktop-layout.tsx`
- **技术栈**：React + Gatsby（**我们不用它的栈，只抄版面模型**）
- **协议**：**BSD-3-Clause** ✅ 可商用、可闭源、**可抄代码**
- **最近提交**：2026-09-14（当天）
- **它做了什么**：【调研】三栏 = `instructions`（题面）｜`editorPane`（编辑器，带文件标签栏 + 独立运行/提交行）｜`previewPane`（预览，可一键全屏）。**关键设计：每个 Pane 只存一个 `flex` 权重数字**（如 25/50/25），resize 只改数字 → 天然可持久化、可预设
- **安全评估**：455k star 的顶级项目，无已知可疑行为
- **为什么最契合**：我们的 `App.vue` 现在就是三栏 flex，**把「固定 220px / 固定 260px」升级成「flex 权重 + 可拖拽」，是同一套骨架的自然进化**，不是推倒重来
- **抄哪几个文件**：`desktop-layout.tsx`（布局模型）、`editor-tabs.tsx`（文件标签栏）、`action-row.tsx`（**运行/提交按钮单独成行、不跟编辑器滚动** —— 这个细节能省掉大量用户抱怨）

#### 🟢 2. VS Code 的「8 个 Part」布局模型

- **来源**：[microsoft/vscode](https://github.com/microsoft/vscode) ★192,496 ｜ 源码 `src/vs/workbench/services/layout/browser/layoutService.ts`
- **协议**：**源码 MIT** ✅（⚠️ 但**官方发布的安装包是微软专有许可**；抄源码没事，**别抄品牌资源、别打包 Marketplace 扩展**）
- **最近提交**：2026-09-14（当天）
- **它做了什么**：【调研】把整个界面拆成 8 个枚举 Part：`titlebar / banner / activitybar / sidebar / panel / auxiliarybar / editor / statusbar`
- **为什么最契合**：它一次性解决我们三个真实痛点 ——
  1. **`activitybar`（窄图标条）与 `sidebar`（宽面板）拆成两个 Part** → **侧栏怎么折叠，导航都不会消失**。我们侧栏现在折叠起来就一片空
  2. **`auxiliarybar` 是独立的右辅助栏 Part** → 它可独立开关、独立记忆宽度，而不是「侧栏的另一侧」
  3. **`banner` 是顶部可关闭的提示条专用位** → **我们是离线软件**，「没联网/有更新/未登录」这类提示一定会出现，**别等需要时临时塞个 div**
- **抄哪几个文件**：那个 `Parts` 枚举本身就是全部精华（**8 个字符串**），落成 CSS Grid 即可

#### 🟢 3. `@formkit/auto-animate` —— 唯一自动尊重无障碍的库

- **来源**：[formkit/auto-animate](https://github.com/formkit/auto-animate) ★13,919 ｜ npm `@formkit/auto-animate@0.10.0`
- **协议**：**MIT** ✅
- **体积**：**【实测】3.4 KB gzip**（本次全部候选里最小）
- **依赖**：**【实测】0 dependencies + 0 peerDependencies**（全仓库最干净）
- **最近发布**：2026-07-10
- **安全**：OSV 查询**无已知公告**
- **为什么强烈推荐**：**它是本次调研里唯一一个「自动」尊重 `prefers-reduced-motion` 的库**，而且是源码级确认 —— `index.mjs` 里就写着：
  ```js
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isDisabledDueToReduceMotion = mediaQuery.matches && !config.disrespectUserMotionPreference;
  ```
  想强行无视得**显式**写 `disrespectUserMotionPreference: true`（类型定义里原话："It is not recommended to use this."）。我们项目现在 0 处处理，**这一个包等于帮我们把这条无障碍债一起还了**
- **⚠️ 但必须说清它的边界**：它**只做列表增/删/重排的 FLIP 补间**，选项只有 `duration`/`easing`。**它不是特效库，做不出炫酷背景。** 它解决的是「界面显得廉价、生硬」，不是「界面要炫」

#### 🟢 4. 纯 CSS 柔光渐变动态背景（自己写，30 行）

- **来源**：**没有可靠的库** —— 这是查证后的结论，不是没找
  - `LunarLogic/auroral`（极光，网上流传最广的）MIT，**最后提交 2018-01-10**
  - `sarcadass/granim.js`（渐变流动）★5,302，MIT，**最后提交 2020-04-11**
  - **两个都停更 6~8 年**。其余命中全是 CodePen 片段或生成器网站
- **做法**：【调研】若干绝对定位色块（或叠层 `radial-gradient`）+ `filter: blur(100px+)` + `@keyframes` 位移；**模糊放在 `::before` 伪元素上**，否则文字发虚
- **为什么强烈推荐**：
  1. **零依赖、零体积**
  2. **跑在 GPU 合成器上，CPU 占用几乎为零** —— 比粒子方案省得多
  3. **一条媒体查询就能整个关掉**（`@media (prefers-reduced-motion: reduce)`）
  4. **跟「淡蓝主调 + 猫娘/鱼娘」的柔和调性天然同边**，不像粒子那样有「工业感」
- **参考生成器**（输出纯 CSS，可拷走改）：[SyntaxSnap 极光生成器](https://syntaxsnap.com/tools/aurora-gradient)（**产出的 CSS 自带 `prefers-reduced-motion` 兜底**）、[iotools Blob 生成器](https://iotools.cloud/tool/css-aurora-blob-generator)

#### 🟢 5. CodePen **公开** Pen —— 最大的免费效果库

- **来源**：[codepen.io](https://codepen.io) ｜ 授权文档：[blog.codepen.io/docs/pens/licensing](https://blog.codepen.io/docs/pens/licensing/)
- **协议**：**【调研】公开 Pen 默认自动适用 MIT**（官方原文：*"public Pens are MIT Licensed, private Pens are owned by you with no implicit license."*）
- **⚠️ 这里要更正一个流传很广的误记**：「CodePen 默认作者保留版权，除非自己标 MIT」—— **这是反的**。公开 Pen 直接可以用，唯一义务是**保留版权声明**
- **免费账户 vs PRO**：**授权上没有区别**，只有「能不能存私有」的区别。反过来说 **免费账户的作品全是公开的、全是可以用的**
- **四个真实的坑**：
  1. **Pen 里的第三方库不在 MIT 覆盖范围内**（GSAP / Three.js / 字体 / 图片要逐个查）
  2. **发 Pen 的人可能不是权利人**（CodePen 官方 FAQ 承认会有人抄别人的东西上来，靠 DMCA 处理）
  3. **MIT 是「免费用」，不是「免责用」**（AS IS，跑不起来作者不负责）
  4. **私有 Pen 碰都别碰**（未授权 = 作者保留全部权利）
- **怎么用**：建 `THIRD-PARTY-NOTICES.md`，逐条记「作者 / Pen URL / 日期 / MIT 全文」

#### 🟢 6. `canvas-confetti` —— 通关撒花

- **来源**：[catdad/canvas-confetti](https://github.com/catdad/canvas-confetti) ★≈13k ｜ npm `canvas-confetti@1.9.4`
- **协议**：**ISC**（宽松，等同 MIT 的宽松度）✅
- **体积**：**【实测】92 KB 解包**（gzip 后远小于此）
- **依赖**：零依赖 ｜ 最近发布 2025-10-25 ｜ 周下载 **630 万**
- **安全**：OSV **无已知公告**
- **为什么推荐**：**完全本地、零依赖、不联网**，一行代码就有「做对了！」的正反馈。对猫娘主题的学习软件是**性价比最高的一个效果**
- **参考**：freeCodeCamp 用的就是它（BSD-3 项目在用的东西，来源正经）

---

### 🟡 可以借鉴，需手动改造

#### 🟡 1. Element Plus —— **如果**哪天决定引组件库，选它

- **来源**：[element-plus/element-plus](https://github.com/element-plus/element-plus) ★27,756 ｜ npm `element-plus@2.14.5`
- **协议**：**MIT** ✅ ｜ 最近提交 2026-09-13（八库里最活跃）
- **体积**：**【实测】解包 43.5 MB；全量 UMD `gzip` 407 KB，CSS 另计 47 KB**
- **它做对了什么**：【调研】`dist/index.css` 里有 **569 个 `--el-*` CSS 自定义属性**；暗色是 `html.dark` 下再挂一套变量（`css-vars.css` 仅 **847 B gzip**）
- **为什么只给 🟡**：**它和我们的 `tokens.css` 是同构的（CSS 变量 ↔ CSS 变量）**，把 `--mi-blue-deep` 映射到 `--el-color-primary` 就是个几十行的覆盖文件，这确实很香。**但问题不在技术，在动机** —— 我们**已经有 19 个 `Mi*` 组件**，引它等于凭空多出**第三套样式来源**（现有 scoped CSS + tokens.css + Element Plus），还得立一条新规矩约束「组件库变量改 tokens.css，不改库源码」
- **安全评估（两条已知公告，均 moderate，无 high/critical）**：
  - CVE-2025-57665 / GHSA-5m5x-9j46-h678 — `el-link` 的 href 未过滤 `javascript:` 协议，**`first_patched_version: null`**（靠文档而非代码修）
  - CVE-2022-27103 — `el-table-column` tooltip XSS，**已在 2.0.6 修复**
- **如果装**：`npm i element-plus` + `npm i -D unplugin-vue-components unplugin-auto-import`（官方首推按需引入）。**图标包 `@element-plus/icons-vue` 不要装** —— 撞 docs/04:68「不引外部图标库」
- **建议**：**先不装。** 只有当「要铺大量表单/表格」这个需求真的出现时，收益才开始成立

#### 🟡 2. `splitpanes` —— 让面板可拖拽

- **来源**：[antoniandre/splitpanes](https://github.com/antoniandre/splitpanes) ｜ npm `splitpanes@4.1.2`
- **协议**：**MIT** ✅ ｜ **【实测】解包 82 KB** ｜ 最近发布 2026-05-26
- **为什么值得**：它能把 🟢1 那套「pane = 一个 flex 数字」**一比一落地到 Vue**，连数据结构和交互都不用重新设计
- **改造量**：小。但要**包一层**，因为我们要的持久化（记住用户拖过的大小）它不管

#### 🟡 3. `motion-v` —— 要「炫」而不是「顺滑」时的答案

- **来源**：[motiondivision/motion-vue](https://github.com/motiondivision/motion-vue) ｜ npm `motion-v@2.4.2`
- **协议**：**MIT** ✅ ｜ 最近提交 2026-09-05
- **体积**：**【实测】40.9 KB gzip**（仅 `Motion`）；含 AnimatePresence/MotionConfig/useSpring/useScroll 全套 **46.6 KB**
- **功能**：54 个导出，功能最全（`AnimatePresence` / `useSpring` / `useScroll` / `Reorder` / `useInView` 都有）
- **⚠️ 三个必须知道的坑**：
  1. **它把 `framer-motion` 当运行时依赖装了进来**（一个 React 库！）。**【实测】源码里 `framer-motion` 贡献 57,067 字节**，包内甚至有一条报错文案写着 "If `dragConstraints` is set as a React ref…"。**没有** React 运行时（`useState`/`useEffect`/`jsx` 均 0 次命中），能正常工作，但这就是个**套在 React 代码库外面的 Vue 薄壳**
  2. **`MotionConfig` 的 `reducedMotion` 默认值是 `"never"`** —— **默认不尊重无障碍设置**，必须自己写 `<MotionConfig reducedMotion="user">`
  3. `@vueuse/core` 是**非 optional 的 peer 依赖**，会被一起拉进来
- **为什么只给 🟡**：能打，但「为了炫，把 framer-motion 拖进一个 Vue 项目」这件事本身值得犹豫

#### 🟡 4. `@tsparticles/vue3` —— 粒子效果的唯一正规军

- **来源**：[tsparticles/tsparticles](https://github.com/tsparticles/tsparticles) ｜ npm `@tsparticles/vue3@4.4.0`
- **协议**：**MIT** ✅ ｜ 最近提交 2026-09-12
- **体积**：**【实测】48.8 KB gzip**（wrapper + engine + loadSlim 全量）
- **离线**：**【实测】产物内 0 个远程 URL**；整个 engine 包里只有**一个** `fetch(`，在 `getDataFromUrl()` 里，**只在显式传 `url` 参数时才走**。**只要传内联配置就永远不会联网**
- **好消息**：【调研】默认就带两个暂停开关且**默认都是 `true`** —— `pauseOnBlur`、`pauseOnOutsideViewport`
  - ⚠️ **但 `pauseOnBlur` 名字有误导性**：它监听的是 **Page Visibility API**（`document.hidden`），不是窗口 focus/blur
  - ⚠️ **Electron 侧的坑**：正因为依赖 `document.hidden`，它会继承 Electron 的已知可见性 bug —— **electron#31016（Windows 专属：`backgroundThrottling: false` 挡不住窗口 `hide()` 时的 rAF 节流）**
- **⚠️ v4 的 API 和网上教程不一样**：`index.d.ts` **只有 default 导出**，是个 Vue 插件（`app.use(VueParticles, {...})`），老教程里的 `import { Particles }` **在 v4 不存在**
- **⚠️ 无障碍要另装包**：`@tsparticles/slim` **不含** `plugin-motion`；要用必须**再装一个包**
- **为什么只给 🟡**：技术上没问题，**是调性问题** —— 粒子连线与我们「柔光淡蓝、避免工业感」的定位是硬碰硬。见 🔴 的说明

#### 🟡 5. Trilium 的两个设计模式（**只能看，不能抄代码**）

- **来源**：[TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) ★37,831
- **协议**：**⚠️ AGPL-3.0-only —— 代码绝对不能用**
- **值得学的两个模式**：
  1. **Tab 栏的「全宽 vs 内容区」二选一**（源码注释原文）：当左侧面板很宽时，把标签栏提到最上层贯穿全宽；否则让它只属于内容区。**这是「多栏 + 标签栏」拥挤问题的具体解法**，不是泛泛而谈
  2. **`isExperimentalFeatureEnabled("new-layout")`**：**新旧布局在同一份代码里共存，用户可以切回去** —— 对要反复试版面的项目，**这条最省命**
- **怎么用**：看设计，自己重写

#### 🟡 6. SiYuan 的 Dock 模型（**只能看，不能抄代码**）

- **来源**：[siyuan-note/siyuan](https://github.com/siyuan-note/siyuan) ★46,338
- **协议**：**⚠️ AGPL-3.0 —— 代码绝对不能用**
- **值得学的**：【调研】右辅助栏做成「**一个 dock + 挂多个面板**」（题解/笔记/提示/大纲），每个面板有**独立的可见性状态机** —— 它的 `panelVisibility.ts` 和 `barVisibility.ts` 是**分开的两个文件**，意思是**面板显隐 ≠ 图标条显隐**，这是两件事
- **怎么用**：看设计，自己重写

#### 🟡 7. Joplin 的「布局即数据」（**只能看，不能抄代码**）

- **来源**：[laurent22/joplin](https://github.com/laurent22/joplin) ★56,353
- **协议**：**⚠️ 桌面端 AGPL-3.0-or-later —— 代码不能用**
  - ⚠️ **这里有个大坑**：Joplin **仓库根 `LICENSE` 是 MIT**，但 `packages/app-desktop/package.json` 里写的是 **AGPL-3.0-or-later**。**只看根目录 LICENSE 会误判** —— 判断方法：**以包级 `package.json` 的 `license` 字段为准**
- **值得学的**：【调研】把「哪几栏、多大、能不能拖」变成**可序列化的 `LayoutItem` 树**，而不是写死三段 flex；组件缺失时**自动从布局里摘除并回写**，而不是崩溃
- **怎么用**：**模式可以自己实现一遍，不侵权**（思想不受版权保护）

#### 🟡 8. AppFlowy 的尺寸表（**数字不受版权保护，可直接用**）

- **来源**：[AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) ★76,635
- **协议**：**⚠️ AGPL-3.0 —— 代码不能用**（但**尺寸数值本身是事实，不受版权保护**）
- **⚠️ 注意**：【调研】其 `main` 分支**最后一次提交是 2026-06-26，近几个月有明显空档**，桌面端开发**已放缓**，参考时要知道它可能不再演进
- **可直接用的数字**（抄进 `tokens.css`）：
  ```
  topBarHeight = 44      tabBarHeight = 40
  tabBarWidth  = 200     侧栏最小宽   = 268
  右面板宽     = 400     分组标题高   = 32
  ```
- **可直接用的两个模式**：
  1. `menuWidth = max(最小宽 + resizeOffset, 最小宽)` —— **一行公式解决「拖太小侧栏废掉」**
  2. **窄屏时侧栏自动变抽屉**（`menuIsDrawer`），主区偏移归零 —— **我们是 1000×700 的最小窗口，这条用得上**

#### 🟡 9. 其他「抄思路」的候选（一句话一条）

| 来源 | 协议 | 值得学的一句话 | 怎么用 |
|---|---|---|---|
| **VS Code 命令面板** | MIT | 【推断】「模糊搜索 + 命令注册表」提供**绕过导航树的第二通道** —— 对付「左侧导航太深」的终极武器 | 自己实现，成本极低 |
| **Anki 的「一个功能 = 一屏路由」** | ⚠️ AGPL | 错题本/统计/设置**各自独立成屏**，别全挤在一个三栏里 | 只看设计 |
| **Obsidian 的 Ribbon + Sidebar 两层** | ⚠️ 闭源 | 侧栏折叠后**图标条还在**，导航不会丢 | 只看设计（**没有源码可抄**） |
| **Logseq 的侧栏宽度持久化** | ⚠️ AGPL | `left-sidebar-resized-at` 写进配置，重启恢复 —— **一句话的事，体验差别巨大** | 自己实现 |
| **Logseq 的长标题截断 + tooltip** | ⚠️ AGPL | **只有被截断时才挂 tooltip**，不截断不挂 —— 避免满屏无意义 tooltip | 自己实现 |
| **CodeMirror 官网 Try 页** | MIT | `Code / Output / Log` **三 tab** —— 日志有独立位置 | 抄版面 |
| **Monaco Playground** | MIT | **设置项用弹窗、不用常驻侧栏**（用得少的东西别永久挤占主区） | 抄版面 |
| **Exercism 的迭代轴** | ⚠️ AGPL | 每次运行是**可回看的版本**，而不是覆盖式「当前答案」 | 只看设计 |
| **Theia 的布局版本号 + 迁移器** | EPL-2.0（弱 copyleft） | 用户存下来的布局 JSON 一定会随版本失效，**用版本号 + 迁移函数解决；现在不做，半年后一定后悔** | 抄思路（**别抄文件**） |

> ⚠️ **关于 AGPL 那条线，说清楚一件事**：AGPL 比 GPL 更狠 —— **连「通过网络提供服务」都触发**。虽然我们是个离线桌面应用、大概率不触发，但**没有理由去赌**。上表这些项目**一律只看设计、不抄代码**。**好消息是：本报告推荐的所有东西，都不需要抄它们的代码。**

---

### 🔴 好看但不合适，不推荐

| # | 候选 | 为什么不推荐 | 证据强度 |
|---|---|---|---|
| 1 | **Vanta.js**（3D 动态背景） | **要你自备 three.js**。它的 npm 包**完全没有 `dependencies`/`peerDependencies` 字段**，读的是全局 `window.THREE`（产物里那句 `window.THREE || {}` 是硬证据），官方文档给的标准用法就是挂 CDN。**对一个绝对不能联网的应用等于再加一个依赖**，且**锁死 2022 年的 three r134**（0.157+ 白屏，issue #177）。另外：**没有 reduced-motion、没有任何窗口隐藏时暂停的逻辑**，`destroy()` 不释放 WebGL context 的 issue 从 **2020-12-09 挂到今天**。最后提交 **2023-01-12**，67 个 open issue | 【实测】+【调研】 |
| 2 | **GSAP** | **它不是开源软件。**【调研】协议是 Webflow 的 Standard "No Charge"：**商用确实免费**（2025-04-30 起连原会员插件都免费了，npm 包里 12 个原会员插件确实都在），**但 OSI 协议列表和 SPDX 里都没有 GSAP 条目**，GitHub 仓库**根本没有 LICENSE 文件**（`LICENSE.md` 返回 404），npm 包**只带 README 和 SECURITY.md、不带任何协议文件**。授权只给了 use/reproduce/display/implement，**没有 modify、没有 distribute**。另外**完全没有 reduced-motion 处理**。**注意：它撞 docs/12:19 定的标记规则 —— 它不属于🟢** | 【调研】 |
| 3 | **PrimeVue 5.x** | 【调研】**从 5.0.0 起不再是开源授权**。npm 包内的 `LICENSE.md` 原文：「This package is part of PrimeUI, a family of **commercial** UI libraries」+「**A valid license key is required**」，并且**运行时依赖 `@primeui/license-manager`（一个离线授权校验器）**。往纯离线闭源包里塞这个毫无收益。**最后一个 MIT 版本是 4.5.5（2026-04-08），5.0.0 发布于 2026-07-15**。⚠️ **陷阱**：GitHub 仓库根 `LICENSE.md` **至今仍显示 MIT** —— **只看仓库会误判** | 【调研】 |
| 4 | **Vuetify** | 【实测】**默认从 CDN 拉 Roboto 字体和 Material Design Icons**，**直接撞我们 CSP 的 `font-src 'self' data:`**（[index.html:8](../src/renderer/index.html#L8)）——「离线/内网下图标不显示」是有实据的老问题（vuetify#20227、#5414）。另外 Material Design 语言与我们自定义的可爱风是硬碰硬，**改造成本最高**。还曾有高危（CVE-2025-8083 原型污染 CVSS 8.6，**影响 3.0.0-alpha.10 之前，最新 4.2.1 不受影响**） | 【实测】+【调研】 |
| 5 | **Ant Design Vue** | 【实测】**全量 826 KB gzip —— 八个组件库里最重**；CSS-in-JS（样式全运行时生成）；图标要另装大包 `@ant-design/icons-vue`（撞 docs/04:68）。`main` 分支 2026-07-24，也慢于前两个 | 【实测】 |
| 6 | **Arco Design Vue** | 【调研】主力组件库里**最久没提交**（2026-06-24，约 2.5 个月），star 数也最小（3.1k），生态位尴尬。技术上没问题，**就是没理由选它** | 【调研】 |
| 7 | **Naive UI** | 技术上完全可用（MIT、18.5k star、CSS-in-JS 运行时、**主题是类型安全的 TS 对象**）—— 但它同样是「**一套完整组件库**」，撞 §二 第 3 条。**跟 Element Plus 一样：不装，除非哪天真的缺组件** | 【调研】 |
| 8 | **`@vueuse/motion`** | 【调研】**最后一次发版 2025-03-10，已 18 个月无更新**，50 个 open issue。它导出了 `useReducedMotion`，但**该函数在包内部从未被调用**（只定义、不使用）→ 不自动生效。**要 spring 效果用 `motion-v`** | 【调研】 |
| 9 | **`moe-cute-ui` / `vue-beni-avatar` 等 npm 上搜到的「二次元组件库」** | 🚫 **供应链风险，直接禁用**。`moe-cute-ui`：**周下载 2 次**、仓库 0 star 且无 LICENSE、npm 发布者的 GitHub 账号 **404**。`vue-beni-avatar`：**它声明的仓库在 GitHub 上 404，仓库根本不存在**。**这正是主人担心的那类东西** | 【调研】 |
| 10 | **`auroral` / `granim.js`（极光/渐变背景库）** | 【调研】分别**最后提交 2018-01-10 和 2020-04-11** —— 停更 6~8 年。**同样的效果自己写 30 行 CSS**（见 🟢4） | 【调研】 |
| 11 | **Awwwards / Dribbble 上的版面** | **只能看思路，代码碰都别碰。** Awwwards 官方明文站内素材 "may not be used for commercial purposes"；获奖网站是**真实商业站，代码归站主**，要抄得直接谈授权。Dribbble 上是**设计稿不是代码**，照着像素还原有「演绎作品」风险 —— **「自己敲的键盘」不构成抗辩** | 【调研】 |
| 12 | **Monaco Editor** | **维持 docs/12 §3.2 的既有结论，不变。**（体积大 5~6 倍、对 Python/Java/C++ 没有智能提示、需要 Web Worker 与零 worker 架构冲突）—— **这里列出来只为证明本次调研没有推翻旧结论** | 见 docs/12 |
| 13 | **`@iconify/vue` 系（间接依赖）** | ⚠️ **离线陷阱**：它默认**运行时从 `api.iconify.design` 拉图标**（官方 README：*"all data is retrieved from public API on demand"*）。在离线 Electron 里**图标会静默不显示**。**采任何库之前，先在 lockfile 里 grep `@iconify`** | 【调研】 |
| 14 | **Obsidian / Anki / Logseq / Joplin / AppFlowy / Trilium / SiYuan / Exercism 的源码** | ⚠️ **AGPL / 闭源，代码绝对不能用**。Obsidian **本体不开源**（README 原文：*"this repo DOES NOT contain the source code of Obsidian"*），**连抄的对象都没有**；Anki、Logseq、Joplin(桌面端)、AppFlowy、Trilium、SiYuan 全是 **AGPL**。**它们只提供「可以这么设计」的证据，不提供代码** | 【调研】 |
| 15 | **粒子连线 / 霓虹辉光 / 玻璃拟态 / 深色赛博** | **不是技术问题，是调性问题。** 见 §1.1 闸门二：[docs/04:7](04-设计规范.md#L7) 写的是「避免工业感、极客感」，[docs/04:26](04-设计规范.md#L26) 写的是「v1 只做浅色主题」。**这四样跟「淡蓝、干净、软乎乎的猫娘老师」是两套语言** | 【实测】我们的规范 |

---

## 四、三套改版方案

> **每一套都写死了：改哪些文件、大概多少行、装什么包、风险在哪。**
> 文件数按「需要真正动笔的 `.vue`/`.css`/`.ts`」算，不含纯新增的文档。

### 方案 A：**零依赖·柔光**（最保守，一步不退）

**做什么**：不装任何包。把现有三栏壳升级成「8-Part 式」结构，动效全部用 Vue 内置 `<Transition>` + 纯 CSS。

| 改什么 | 文件数 | 行数（约） |
|---|---|---|
| `App.vue` 三栏壳 → Parts 网格（加 activitybar / banner 位） | 1 | 77 → ~160 |
| `tokens.css` 新增动效/层级/模糊令牌 + `prefers-reduced-motion` 总闸 | 1 | 89 → ~140 |
| 路由过渡（`router/index.ts` + 视图容器） | 2 | ~40 |
| `Sidebar.vue`：图标条与面板分离、折叠态 | 1 | 354 → ~420 |
| `RightPanel.vue`：改成 dock 容器（可挂多面板） | 1 | ~40 |
| 基础组件统一过渡（MiCard / MiButton / MiModal / MiToast / MiDrawer） | 5 | ~120 |
| 柔光渐变背景（新组件 `MiAurora.vue`） | 1 | ~50 |
| 全局 reduced-motion 收口（`styles/motion.css`） | 1 | ~30 |
| **合计** | **约 13 个文件** | **约 700~850 行** |

- **装什么包**：**零**
- **风险**：**最低**。不动依赖树，不动 `package.json`，随时可回退
- **换来的**：界面不再生硬、有呼吸感、侧栏折叠不再丢导航、无障碍欠债一次性还清
- **换不来的**：**列表增删重排的自动补间**（要手写 `TransitionGroup` + FLIP，约 20 行 CSS 能拿回八成）、**面板拖拽**

### 方案 B：**两个小包·顺滑 + 可拖拽**（★ 本喵推荐）

**做什么**：A 的全部，加上「列表动画」交给 `auto-animate`、「面板可拖拽」交给 `splitpanes`。

| 改什么 | 文件数 | 行数（约） |
|---|---|---|
| **A 方案的全部** | 13 | ~800 |
| 装并接入 `@formkit/auto-animate`（答题列表、侧栏课程树、错题本、搜索面板） | 4~6 | ~60 |
| 装并接入 `splitpanes`（主区 ↔ 右栏可拖拽）+ 宽度持久化 | 3 | ~120 |
| 面板状态持久化（写进 config，沿用现有 store） | 2 | ~60 |
| `docs/04` 补一节「动效规范」+ 新规矩「引入的库不许改源码」 | 1 | ~40 |
| **合计** | **约 20~24 个文件** | **约 1,100~1,350 行** |

- **装什么包**：`npm i @formkit/auto-animate splitpanes` —— **两个都是 MIT、都零依赖（auto-animate 是 0 依赖 0 peer）、合计解包 < 82 KB、gzip 后更小**
- **风险**：**低**。两个包都无已知漏洞（OSV 查询为空），且 `auto-animate` **自动帮我们处理 `prefers-reduced-motion`**
- **换来的**：**「廉价感」消失**。列表增删重排自动补间、面板可以拖着调大小、重启后记得住
- **换不来的**：**弹簧手感 / 时间轴编排 / 粒子**

### 方案 C：**引入整套组件库**（不推荐，但把账算清楚）

**做什么**：装 Element Plus，用 `--el-*` ↔ `--mi-*` 变量映射把主色/圆角/阴影对齐，逐步用它的组件替换现有 `Mi*` 组件。

| 改什么 | 文件数 | 行数（约） |
|---|---|---|
| 装包 + 按需引入配置（`electron.vite.config.ts` + `package.json`） | 2 | ~30 |
| 主题覆盖文件（`--el-*` ← `--mi-*` 映射） | 1 | ~120 |
| **重写 19 个 `Mi*` 组件为 Element Plus 封装** | **19** | **~1,500+** |
| 逐个视图的样式返工（8 个视图） | 8 | ~800 |
| 立新规矩「组件库变量只改 tokens.css」+ 文档 | 1 | ~40 |
| **合计** | **31+ 个文件** | **2,500 行以上** |

- **装什么包**：`element-plus` + `unplugin-vue-components` + `unplugin-auto-import`
- **风险**：**中高**。① 凭空多出**第三套样式来源**；② 现有 19 个组件的手写细节会丢；③ `el-link` 有一条**没有代码修复**的中危公告
- **根本问题**：**它解决的是「缺组件」，而我们的问题不是缺组件** —— 我们有 19 个组件，缺的是**版面的组织方式**和**动效**。**花 2,500 行买一个我们不缺的东西，是这次调研里最该避免的坑**

---

## 五、初步安全审查（排毒说明）

> 主人说的是「引入前你必须帮我排毒」。以下是**引入前**就该做完的事。**本报告不要求主人现在做任何一步。**

### 5.1 哪些用 `npm install`，哪些是「复制文件」

| 方案 | 动作 | 具体 |
|---|---|---|
| **A** | **什么都不用装** | — |
| **B** | **`npm i @formkit/auto-animate splitpanes`** | 两个 MIT 包，装完跑 `npm audit` 确认 0 漏洞 |
| **C** | `npm i element-plus unplugin-vue-components unplugin-auto-import` | **本喵不建议** |
| 任何方案 | **`canvas-confetti`**（可选，撒花） | `npm i canvas-confetti`（ISC） |
| 任何方案 | **CodePen 的效果代码** | **复制代码**（不是装包）。必须逐条登记到 `THIRD-PARTY-NOTICES.md` |

**⚠️ 一条硬规矩：绝不要从 GitHub 直接拷库的源码文件。** 至少两个候选印证了为什么：
- **`animate.css` 分裂**：npm 上发布的 **4.1.1 是 MIT**（【实测】npm registry `license` 字段），但 GitHub `main` 分支的 LICENSE 是 **Hippocratic License 2.1**（非 OSI 认证）。**同一个包两个答案 —— 只走 npm**
- **`PrimeVue` 分裂**：仓库根 `LICENSE.md` 显示 MIT，npm 包内的 `LICENSE.md` 已经变成商业授权。**只以 npm 包内的为准**

### 5.2 本喵查到的**可疑行为**（这是「排毒」最该看的一节）

| 对象 | 可疑点 | 处置 |
|---|---|---|
| `moe-cute-ui`（npm） | 周下载 **2 次**；仓库 **0 star 且无 LICENSE**；npm 发布者的 GitHub 账号 **404** | 🚫 **禁用**。这是典型的供应链投毒画像 |
| `vue-beni-avatar`（npm） | **无 license 字段**；它声明的仓库 `Enlighten-Brasil/en-beni-avatar` 在 GitHub 上 **404，根本不存在** | 🚫 **禁用** |
| `@iconify/vue`（间接依赖） | 不是恶意，但**运行时从 `api.iconify.design` 拉图标** —— 在离线应用里是**静默失效**（图标不显示，且不报错） | ⚠️ **采任何库前先在 lockfile 里 grep `@iconify`** |
| `@vueuse/motion` | 不恶意，但 **18 个月未发版** | 🟡 建议改用 `motion-v` |

### 5.3 已知漏洞排查（`npm audit` 概念）

**【实测】没装的不用查；要装的两个包，OSV 数据库查询均返回「无已知公告」**：
`@formkit/auto-animate` ✅ ｜ `splitpanes` ✅ ｜ `canvas-confetti` ✅

**⚠️ 必须说清楚两句话**：
1. **「无已知公告」不等于「无漏洞」**，只代表截至 **2026-09-14** 没人公开提交过
2. **本节的漏洞数据来自调研员的 OSV 查询，不是本喵在本机跑 `npm audit` 跑出来的** —— 因为**主人交代不许下载任何东西**。**真正引入的那一天，第一步就是 `npm i` 之后立刻 `npm audit`**，把当时的真实结果记进文档

### 5.4 引入任何东西之前，有一笔**本来就欠着**的账

**【实测】本喵查了仓库根目录：既没有 `LICENSE`，也没有 `THIRD-PARTY-NOTICES`。**

但 `package.json` 里声明了 `"license": "MIT"`，且**运行时依赖了 16 个包**（CodeMirror 全家、echarts、highlight.js、markdown-it、pinia、vue-router…），展开传递依赖共 **65 个**。

> **这笔账跟这次引不引 UI 库无关，是本来就欠着的。** MIT/BSD/ISC 的硬性义务只有一条：**在副本中保留版权声明和许可声明**。Electron 应用是**可以被解包的**，所以「别人查不到」不成立。
>
> **建议（等主人拍板后再做）**：建一个 `THIRD-PARTY-NOTICES.md`，逐条记「包名 / 版本 / 协议 / 版权行 / 来源 URL」，打包时放进安装包，About 页可查。**这件事应该独立于本次版面改版来做**，别混在一起。

> ✅ **已于 2026-09-14 完成**：主人拍板后补上了根目录的 [`LICENSE`](../LICENSE)（MIT）和 [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)。
> 后者覆盖当时的 **16 个直接依赖 / 65 个传递依赖**，是**直接读 `node_modules` 里各包自己的 LICENSE 文件**生成的（不是抄的模板），并带一道「许可证原文必须逐字节照录」的自检。
> 顺带查出一个差点漏掉的义务：**echarts 内嵌了 d3.js 的代码**（BSD-3-Clause），其 LICENSE 末尾有专门附录，需一并转载。详见 [依赖包安全审查报告](依赖包安全审查报告-auto-animate与splitpanes.md)。
>
> 📌 以后**每次增删依赖都要重跑一次生成**，否则清单里的版本号会过期。

---

## 六、没查到 / 不确定的（诚实清单）

> **这一节请务必看。** 下面每一条都是本报告**不敢下结论**的地方。

| # | 事项 | 状态 |
|---|---|---|
| 1 | **所有「按需引入后的真实体积」** | ❌ **未实测**。所有体积数字都是**全量库的上限**，不含 tree-shaking 效果（tree-shake 后通常小一个数量级，**但具体多少没测，不编**） |
| 2 | **这些库与我们 Vue 3.5 / Vite 7 / Electron 44 的实测兼容性** | ❌ **未验证**。全是静态调研，**没有实际装包跑过**（因为主人交代不许下载） |
| 3 | **传递依赖的漏洞** | ❌ **未审计**。只审了候选包自身 |
| 4 | **GSAP 协议是否覆盖「桌面应用打包分发」** | ❌ **协议全文没有提到** Electron/desktop/redistribute。**本喵不是律师，这条要主人自己判断**（不过反正已经不建议用它了） |
| 5 | **Arco 主题商店里有没有可爱风主题包** | ❌ 未查证 |
| 6 | **tsParticles 在**我们项目**里的真实帧率/CPU 占用** | ❌ 未实测。只有官方指引和 issue 记录 |
| 7 | **Canvas 手写粒子的具体毫秒开销** | ❌ 是工程判断，非实测 |
| 8 | **bundlephobia 的 Vuetify 数据是错的** | ⚠️ **已发现**：它的 `main` 资产只有 5,428 B（实为 re-export 壳）。**引用 Vuetify 体积时别用 bundlephobia** |
| 9 | **完全 CC0 的 CSS 动效库** | ❌ **没找到**（不是没查）。能确认是 CC0 的通常是**素材**，CSS 代码生态里宽松许可基本是 MIT/BSD 这一系。**想要「零合规负担」，答案不是找 CC0，而是用 MIT + 维护一份 NOTICE 文件** |

---

## 七、本喵的推荐（一句话）

> **先做方案 A，觉得不够再加到方案 B。方案 C 别碰。**
>
> 理由是这次调研里最反直觉、但证据最硬的一条：
> **我们已经有 19 个组件和一套完整的设计令牌，我们不缺「零件」，缺的是把零件**装得好看**的**手法** —— 那是版面结构和动效的活，不是组件库的活。**
>
> 而「炫酷」这件事，在我们这套「淡蓝、干净、软乎乎、避免工业感」的宪法底下，
> **最优解不是粒子，是柔光。**（而且它恰好还是**最省性能、最省体积、最好做无障碍**的那一个。）
