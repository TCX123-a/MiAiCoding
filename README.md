# 咪爱编程 · miai-biancheng

> 猫咪口吻 + 大肥鱼陪你学编程的离线学习伴侣。
>
> 一款面向编程初学者的 Windows 桌面学习应用：五门语言、266 节课文、6026 道题，代码在本机真编译、真运行。

[![📥 极速下载体验](https://img.shields.io/badge/%F0%9F%93%A5%20%E6%9E%81%E9%80%9F%E4%B8%8B%E8%BD%BD%E4%BD%93%E9%AA%8C-Windows%20x64-ff5c8a?style=for-the-badge)](https://github.com/TCX123-a/MiAiCoding/releases/latest)

**📥 [极速下载体验 →](https://github.com/TCX123-a/MiAiCoding/releases/latest)**　Windows 10/11 x64 · 下载后双击安装 · 无解压密码

[简体中文](#咪爱编程--miai-biancheng) · [English summary](#english-summary)

---

## 目录

- [这是什么](#这是什么)
- [功能一览](#功能一览)
- [内容规模](#内容规模)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [技术实现](#技术实现)
- [大肥鱼从哪里来：LoRA 与 ComfyUI 出图管线](#大肥鱼从哪里来lora-与-comfyui-出图管线)
- [致谢 / Open Source Credits](#致谢--open-source-credits)
- [许可证边界](#许可证边界)
- [已知限制与安全说明](#已知限制与安全说明)
- [参与贡献](#参与贡献)

---

## 这是什么

「咪爱编程」是一套**离线优先**的编程学习桌面应用。它把课程、题库、代码编辑器、编译运行环境、
错题本、每日复习、每日挑战、动态壁纸和一只会饿的桌宠装进同一个窗口。

- **不是网页套壳**：课程内容、题库、判分、代码运行都在本地，断网可用。
- **不是只讲语法**：`code` / `codefix` / `codefill` / `codewrite` 题型会在本机真编译、真运行、
  真比对输出；跑不通就是跑不通。
- **不替你写作业**：AI 只用来出题和讲解；代码题必须在本机沙盒流程里跑通才会展示给用户。

产品气质是「猫咪外衣 + 硬核内核」：讲解可以撒娇，术语必须是编程原术语。

### 适合谁

- 刚接触 C / C++ / Java / Python，需要一条有顺序的入门路线；
- 想要「打开就能写、写完就能跑」，不想先折腾环境；
- 喜欢桌面宠物、动态壁纸、夜间模式这类让学习不那么苦的东西。

---

## 功能一览

| 模块 | 能做什么 |
|---|---|
| **课程** | 五门语言分阶段课文，Markdown 渲染，代码块高亮，`demo` 演示动画 |
| **题库与判分** | 六种题型；代码题本地编译运行、按 stdout / 退出码 / 结构化规则判分 |
| **练习场** | 内置 CodeMirror 编辑器，四语言运行，超时杀进程树、输出截断、单任务队列 |
| **IDE 联动** | 自动探测本机 IDE，一键用 VS Code / IDEA / Dev-C++ 等打开当前题目代码 |
| **学习闭环** | 难度体系、阶段自检、错题本、收藏、每日复习（每天上限 20 道）、每日挑战（答错即停） |
| **每日挑战** | 无上限、答错即停、自选语言；可选云端排行榜 |
| **搜索** | 全文搜索课程与题目，支持按语言/阶段过滤 |
| **动态壁纸** | 视频壁纸、WebGL 场景壁纸、Steam 创意工坊目录扫描、自定义上传、属性面板、音频响应、随机轮播 |
| **桌宠** | dsh-pet 引擎；喂食、饱腹度、好感度、跑腿、大白饭经济；状态异常会实时报错 |
| **大肥鱼 AI 助手（可选）** | 右栏流式对话：问代码、问报错；可勾选把当前代码 / 选中片段 / 运行输出一起发过去；对话记录存本机 |
| **外观** | 液态玻璃 UI、夜间模式、开屏动画、界面音效与自定义光标 |
| **云同步（可选）** | 账号、四类文档同步、挑战成绩与排行榜；不登录也能完整使用本地功能 |

> 云同步是**可选**的。仓库自带 `server/`（Fastify + PostgreSQL）供自行部署；
> 不配置服务器时，应用不会发起任何云端请求。
>
> AI 助手同样是**可选**的：在设置页填入自己的 DeepSeek API Key 才启用；
> 只有你在对话里勾选的内容会发出去，文件路径、Key、错题本一律不发。
> 不填 Key 时除 AI 助手外的一切功能照常，且完全离线。

---

## 内容规模

统计口径：`src/renderer/src/generated/content-bundle.json`（由 `content/` 构建产物生成），
2026-10-22 实测。

| 语言 | 课文 | 题目 |
|---|---:|---:|
| 公共基础（common） | 41 | 307 |
| C | 51 | 1341 |
| C++ | 59 | 1392 |
| Java | 61 | 1555 |
| Python | 54 | 1431 |
| **合计** | **266** | **6026** |

题目构成：

| 题型 | 数量 | 说明 |
|---|---:|---|
| `choice` | 854 | 选择题 |
| `fill` | 121 | 填空题 |
| `code` | 488 | 写完整程序，本地真跑 |
| `codefill` | 291 | 补全代码空位 |
| `codewrite` | 2897 | 按需求写代码，结构化判分 |
| `codefix` | 1375 | 修 bug，比对修复后的行为 |

另有 **243 个 `demo` 演示动画**（课文里的 ```demo 代码块，由前端播放器渲染）。

其中 1754 道是随课题目（`q*`），4272 道是分课挑战题库（`bank-*`，模板批量生成并逐题经本地真跑校验）。
两者 id 命名空间不同，不会互相覆盖。

---

## 快速开始

### 环境要求

- **Windows 10/11 x64**（当前主支持平台）
- **Node.js ≥ 24**（`server/` 明确要求 `>=24`；客户端构建也按 24 验证）
- 跑代码题需要本机工具链（缺了也能用选择题/填空题，只是代码题会提示环境未就绪）：
  - C：`gcc`
  - C++：`g++`
  - Java：JDK 21（`javac` / `java`）
  - Python：`python`

### 安装与开发

```bash
git clone <你的仓库地址>
cd miai-biancheng

npm install
npm run dev
```

### 构建

```bash
# 只构建应用（要求内容包已存在）
npm run build:app

# 先重建内容包，再构建应用
npm run build

# 严格校验内容包（缺文件直接失败）
npm run build:content:strict

# 打 Windows NSIS 安装包
npm run package:win
```

构建产物在 `out/`；安装包输出目录见 `package.json` 的 `build` 配置。

### 测试与闸门

```bash
npm test                 # 单元/集成测试（vitest）
npm run typecheck        # 主进程 + 渲染进程类型检查
npm run validate:content # 课程与题库结构校验
npm run check:samples    # 课文代码块真跑
npm run check:questions  # 题目代码真跑
npm run check:answers    # 代码题答案与判分对账
npm run check:bank       # 挑战题库校验
npm run check:packed     # 产物内容对账
```

这些闸门会调用本机编译器；没有装工具链时，相关用例会跳过或失败，属于预期行为。

### 后端（可选）

```bash
cd server
npm install
npm run dev       # tsx watch
npm test          # PGlite 内存库测试
npm run typecheck
```

部署与环境变量见 [`server/README.md`](./server/README.md) 和 `server/deploy/`。
**不要把 `.env`、数据库文件或任何真实密钥提交到仓库。**

---

## 项目结构

```text
miai-biancheng/
├── src/
│   ├── main/              Electron 主进程：窗口、存储、代码运行、壁纸、桌宠、云同步
│   ├── preload/           预加载脚本与 IPC 白名单
│   ├── renderer/          Vue 3 渲染进程：课程、练习、复习、挑战、设置、外观
│   │   └── src/generated/ 内容包构建产物（不入库）
│   └── shared/            主/渲染共享的纯逻辑：判分、题型、难度、壁纸属性、协议
├── content/               课程 Markdown + 题目 JSON + 挑战题库 + 术语表
├── server/                自建后端：Fastify + Zod + PostgreSQL
├── build/                 electron-builder 资源、桌宠 vendor/补丁、WebGL 补丁
├── scripts/               内容构建、校验、探针、许可证生成
├── docs/                  设计、技术、内容、交接文档
├── prototype/             壁纸引擎 P1 可行性实验（证据链）
├── resources/             应用图标等打包资源
└── THIRD-PARTY-NOTICES.md npm 依赖许可证台账（脚本生成）
```

---

## 技术实现

### 客户端

- **Electron 44 + Vue 3 + TypeScript + Pinia + Vue Router**，`electron-vite` / Vite 构建。
- **CodeMirror 6**：自研 Vue 包装组件，不引第三方包装层；C/C++/Java/Python 语法高亮与补全。
- **markdown-it + highlight.js** 渲染课文；**ECharts** 画学习统计；**animejs** 做界面动效；
  **@formkit/auto-animate** 处理列表过渡；**splitpanes** 做可拖拽分栏。
- **代码运行**：主进程 `spawn` 调本机编译器/解释器；独立编译超时与运行超时；超时杀进程树；
  stdout/stderr 截断；单任务队列，避免多题并发把机器打满。
  > 这不是安全沙箱：运行的是**用户自己写的代码**，权限等同于用户在本地开终端。
  > 不要把来路不明的代码粘进来运行。
- **数据存储**：主进程 JSON 存储，写入采用临时文件 + 原子替换，并保留 `.bak` 回退；
  用户档案、错题本、配置、挑战记录分开存放。
- **动态壁纸**：视频层 + `webwallgl` 场景层双栈；Steam 创意工坊目录扫描；自定义上传；
  Wallpaper Engine 的 `project.json` 属性系统（含 `condition` 表达式求值）移植；
  失焦暂停、音频响应、随机轮播池。
- **桌宠**：`dsh-pet` 引擎 + 独立 helper 进程；喂食/跑腿/大白饭经济；主进程崩溃或退出时
  由 kill-tree 逻辑收尸，避免残留进程。

### 题目判分

- 代码题不是字符串比对：编译 → 运行 → 收集 stdout/stderr/退出码 → 按题型规则判分。
- `codefix` 会同时校验修复后的代码是否仍保留题目要求的结构，防止「把整题删了重写」蒙混。
- 选择题支持选项洗牌；会话卷与原始题使用不同的下标空间，落盘时按**选项文本**反查，
  避免洗牌后错位（详见 `src/shared/` 下相关实现与测试）。
- 判分逻辑与内容校验脚本共用同一套规则，避免「应用里判对、闸门判错」。

### 可选云端

- `server/`：**Fastify 5 + Zod 4 + PostgreSQL 18**，TypeScript，`pg` 连接池。
- 账号、四文档同步、每日挑战、排行榜、大白饭。
- 测试用 **PGlite** 内存库跑集成测试；生产用 PostgreSQL。
- 客户端不硬编码任何密钥；**开源构建默认不预置服务器地址**，需要在设置中自行配置。
  作者自用构建可以在构建期指定地址，但该地址不随公开仓库分发。

---

## 大肥鱼从哪里来：LoRA 与 ComfyUI 出图管线

项目里的大肥鱼立绘、奖励图与部分界面素材，来自本机的 ComfyUI 批量出图管线。

> 项目初期曾尝试自炼两版 LoRA，最终采用 C 站开源的 Anima 底模，结合 LoRA 搭建 ComfyUI 工作流批量生产。

这句话里的「C 站」是项目早期对模型社区的统称；**Anima 的官方发布页在 Hugging Face**
（[`circlestone-labs/Anima`](https://huggingface.co/circlestone-labs/Anima)），
其许可证是 **CircleStone Labs Non-Commercial License v1.2**，**不是 OSI 开源许可证**：

- 模型权重与衍生模型（包括 LoRA）**仅限非商业、非生产使用**；
- **生成输出可以商用**；
- 本仓库**不包含** Anima 权重，也不包含以 Anima 为底模的 LoRA 权重。

### 当前 Anima 工作流（`docs/comfyui_workflow.json`）

工作流的 API 格式文件已整理到 [`docs/comfyui_workflow.json`](./docs/comfyui_workflow.json)，
说明见 [`docs/comfyui_workflow.md`](./docs/comfyui_workflow.md)。核心节点：

| 步骤 | 节点 | 参数 |
|---|---|---|
| 底模 | `UNETLoader` | `anima-preview.safetensors`，`weight_dtype: default` |
| 文本编码器 | `CLIPLoader` | `qwen_3_06b_base.safetensors`，`type: stable_diffusion` |
| VAE | `VAELoader` | `qwen_image_vae.safetensors` |
| LoRA | `LoraLoader` | `ds_whalemaid.safetensors`，强度 **0.9** |
| 采样 | `KSampler` | `euler` / `simple`，CFG **4.0**，20 步，1024×1024 |
| 抠图 | `RemoveBackground` | `birefnet.safetensors` |
| 透明通道 | `InvertMask` → `JoinImageWithAlpha` | `JoinImageWithAlpha` 内部 alpha = 1 − mask，必须先把 mask 取反 |

LoRA `ds_whalemaid` 是**第三方作品**（Civitai 模型 2845839，作者 `ogura_shigeru`），
触发词必须写 `ds_whalemaid`；缺了不会报错，只会静默退化成底模画风。
详见 [`THIRD-PARTY-CODE-NOTICES.md`](./THIRD-PARTY-CODE-NOTICES.md)。

产线有两种输出：

- `--alpha`：透明背景，用于界面立绘/桌宠；
- `--no-bg`：白底，用于奖励图鉴。

### 早期 SD1.5 产线（Legacy，已不在当前图鉴中）

在转向 Anima 之前，项目用 SD1.5 跑过一版，用于早期立绘与出图实验：

| 项目 | 值 |
|---|---|
| 底模 | `Counterfeit-V3.0_fix_fp16.safetensors`（第三方） |
| 自训 LoRA | `dafeiyu_c_v2.safetensors` @ 0.8 |
| 图案 LoRA | `dswhale.safetensors` @ 0.7 |
| 分辨率 / 步数 / CFG | 512×512 / 25 / 7.0 |
| 采样器 | `dpmpp_2m` + `karras` |
| 高清修复 | **关闭**（开了会改变脸型与配色） |

**当前图鉴的 `g01`–`g200` 已全部是 Anima 产线**：2026-10-17 扩池时，`g01`–`g50` 原位
替换为同一批 Anima 图的第 1 张，`g51`–`g200` 是其余候选；SD1.5 图不再出现在 496 张图鉴里。
两版自训 LoRA 的权重都**不随仓库分发**。SD1.5 配方仅作为历史记录保留在
`docs/11-图片资产生产规范.md`。

### 图鉴里有什么、没有什么

应用内保留 **496 个奖励图 id**（`g01`–`g496`），id 写入用户档案后不能改。
开源发布版中：

- `g01`–`g200`：项目用本机 Anima 产线生成（第三方 LoRA `ds_whalemaid`，作者
  `ogura_shigeru`），随仓库分发；生成输出按 Anima 条款可用于商用；
- `g201`–`g224`：来自 GitHub [`yyh-001/dsh-meme`](https://github.com/yyh-001/dsh-meme)
  的表情包；上游**代码是 MIT，但图片清单标注 `personal`**，不能按 MIT 再分发；
- `g225`–`g496`：原图来自社区图包，来源页未给出可再分发的许可证。

因此公开版把 `g201`–`g496` 全部替换为**自制占位卡**（同尺寸 PNG，只含说明文字，
不含原图内容），仅用于保持 id 槽位与测试对账完整。

完整来源、排除原因与占位策略见 [`THIRD-PARTY-CODE-NOTICES.md`](./THIRD-PARTY-CODE-NOTICES.md) §5。

---

## 致谢 / Open Source Credits

这个项目站在很多开源项目的肩膀上。下面按「用到的代码 / 设计参考 / 内容方法 / AI 工具」四类列出；
**所有 npm 依赖（含传递依赖）的完整许可证原文**在
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)（客户端，73 个 npm 包 + 2 个内嵌组件）与
[`server/THIRD-PARTY-NOTICES.md`](./server/THIRD-PARTY-NOTICES.md)（服务端，60 个包）。
移植代码、素材与模型的许可见 [`THIRD-PARTY-CODE-NOTICES.md`](./THIRD-PARTY-CODE-NOTICES.md)。

### 1. 核心框架与运行时（直接依赖）

| 项目 | 用途 | 许可证 | 地址 |
|---|---|---|---|
| [Electron](https://github.com/electron/electron) | 桌面壳 | MIT | <https://github.com/electron/electron> |
| [Vue 3](https://github.com/vuejs/core) | 渲染层框架 | MIT | <https://github.com/vuejs/core> |
| [Vue Router](https://github.com/vuejs/router) | 路由 | MIT | <https://github.com/vuejs/router> |
| [Pinia](https://github.com/vuejs/pinia) | 状态管理 | MIT | <https://github.com/vuejs/pinia> |
| [Vite](https://github.com/vitejs/vite) | 构建工具 | MIT | <https://github.com/vitejs/vite> |
| [electron-vite](https://github.com/alex8088/electron-vite) | Electron 构建集成 | MIT | <https://github.com/alex8088/electron-vite> |
| [electron-builder](https://github.com/electron-userland/electron-builder) | Windows 安装包 | MIT | <https://github.com/electron-userland/electron-builder> |
| [TypeScript](https://github.com/microsoft/TypeScript) | 类型系统 | Apache-2.0 | <https://github.com/microsoft/TypeScript> |

### 2. 编辑器、渲染与界面

| 项目 | 用途 | 许可证 | 地址 |
|---|---|---|---|
| [CodeMirror 6](https://codemirror.net/)（`@codemirror/*`） | 代码编辑器 | MIT | <https://codemirror.net/> |
| [Lezer](https://github.com/lezer-parser/highlight)（`@lezer/highlight`） | 语法高亮 | MIT | <https://github.com/lezer-parser/highlight> |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Markdown 渲染 | MIT | <https://github.com/markdown-it/markdown-it> |
| [markdown-it-container](https://github.com/markdown-it/markdown-it-container) | 自定义容器 | MIT | <https://github.com/markdown-it/markdown-it-container> |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 代码块高亮 | BSD-3-Clause | <https://github.com/highlightjs/highlight.js> |
| [ECharts](https://github.com/apache/echarts) | 学习统计图表 | Apache-2.0 | <https://github.com/apache/echarts> |
| [anime.js](https://github.com/juliangarnier/anime) | 界面动效 | MIT | <https://github.com/juliangarnier/anime> |
| [auto-animate](https://github.com/formkit/auto-animate) | 列表过渡 | MIT | <https://github.com/formkit/auto-animate> |
| [splitpanes](https://github.com/antoniandre/splitpanes) | 可拖拽分栏 | MIT | <https://github.com/antoniandre/splitpanes> |
| [iconv-lite](https://github.com/pillarjs/iconv-lite) | GBK/UTF-8 解码（构建期） | MIT | <https://github.com/pillarjs/iconv-lite> |

### 3. 桌宠

| 项目 | 用途 | 许可证 | 地址 |
|---|---|---|---|
| [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 桌宠引擎（代码） | MIT（代码） | <https://github.com/PC2005-cloud/dsh-pet> |
| 同上（动画/提示词/源视频素材） | 桌宠素材 | **允许开源使用，禁止商用** | 同上 |
| [dafeiyu-pet](https://github.com/1190fasheqi/dafeiyu-pet) | **思路参考**：透明窗点击穿透不变量；未复制代码、未打包 | 上游未声明（仅致谢） | <https://github.com/1190fasheqi/dafeiyu-pet> |

> 代码是 MIT，**素材不是**。商业使用桌宠素材前必须取得上游作者单独授权。
> 本项目通过 `build/dshpet-vendor.ts` 把 helper 与素材放进 `out/pet-helper`，
> 并在该目录保留原作者署名与素材条款。
>
> 其中 `上首软糖体.ttf` 是**第三方商业字体**，不适用 MIT，也不在仓库的 Git 跟踪范围内
> （构建时从 dsh-pet npm 包拷入）。商业分发安装包前请自行取得字体授权或替换字体。

### 4. 动态壁纸与液态玻璃

| 项目 | 关系 | 许可证 | 地址 |
|---|---|---|---|
| [webwallgl](https://github.com/oneincase/webwallgl) | **npm 依赖**，WebGL 场景壁纸渲染 | MIT | <https://github.com/oneincase/webwallgl> |
| `we-scene`（随 webwallgl 内嵌） | **内嵌运行时**：Wallpaper Engine 场景解析/渲染 | MIT（© aurora-wallpaper contributors） | 随 <https://github.com/oneincase/webwallgl> |
| [Mediabunny](https://github.com/Vanilagy/mediabunny)（随 webwallgl 内嵌） | **内嵌库**：媒体解封装 | **MPL-2.0**（文件级 copyleft） | <https://github.com/Vanilagy/mediabunny> |
| [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) | **代码移植**：视差、过场、属性系统、属性面板 | MIT | <https://github.com/elysia395/dsh-wallpaper-engine> |
| [media-bridge](https://github.com/oneincase/media-bridge) | **参考思路**：系统音频频谱 / Now Playing；未随包分发 | MIT | <https://github.com/oneincase/media-bridge> |
| [dsh-liquid-glass-theme](https://github.com/Rainpomelo/dsh-liquid-glass-theme) | **设计配方参考**：液态玻璃；未复制 WebGL 源码 | MIT | <https://github.com/Rainpomelo/dsh-liquid-glass-theme> |

移植文件（文件头均保留 MIT 版权声明与上游地址）：

- `src/renderer/src/lib/wallpaper/parallax.ts`
- `src/renderer/src/lib/wallpaper/transitions.ts`
- `src/shared/wallpaper-props.ts`
- `src/shared/we-cond.ts`
- `src/renderer/src/components/domain/WallpaperPropsPanel.vue`

许可证全文见 [`THIRD-PARTY-CODE-NOTICES.md`](./THIRD-PARTY-CODE-NOTICES.md) §1.1、§2.1。

### 5. UI / UX 设计规范参考

以下项目在设计阶段被阅读、对照或作为规范参考；**本仓库没有复制其源代码**，
但仍按开源精神列明出处与许可证。

| 项目 | 作者 | 许可证 | 地址 | 参考内容 |
|---|---|---|---|---|
| [Taste Skill](https://github.com/Leonxlnx/taste-skill) | Leonxlnx | MIT | <https://github.com/Leonxlnx/taste-skill> | 视觉品味、反模板化 |
| [Make Interfaces Feel Better](https://github.com/jakubkrehel/make-interfaces-feel-better) | Jakub Krehel | MIT | <https://github.com/jakubkrehel/make-interfaces-feel-better> | 动效、排版、图标、悬停态、光学对齐、同心圆角、阴影、热区 |
| [Impeccable](https://github.com/pbakaus/impeccable) | Paul Bakaus | Apache-2.0 | <https://github.com/pbakaus/impeccable> | 设计审查、确定性检测规则 |
| [Agent Skills](https://github.com/vercel-labs/agent-skills) | Vercel Labs | MIT | <https://github.com/vercel-labs/agent-skills> | Agent Skill 组织方式 |
| [Anthropic Skills · frontend-design](https://github.com/anthropics/skills) | Anthropic | Apache-2.0 | <https://github.com/anthropics/skills> | 前端设计方向 |
| [Single Person Workflow](https://github.com/shining319/claude-code-single-person-workflow) | Shining319 | MIT | <https://github.com/shining319/claude-code-single-person-workflow> | 单人开发工作流 |

> `impeccable` 的 `NOTICE.md` 还声明其平台规范参考了
> [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills)（MIT）。

### 6. 内容组织方法参考

| 项目 | 许可证 | 地址 | 借鉴点 |
|---|---|---|---|
| [freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp) | BSD-3-Clause | <https://github.com/freeCodeCamp/freeCodeCamp> | 题目分区组织 |
| [Exercism](https://github.com/exercism/exercism) | MIT | <https://github.com/exercism/exercism> | 题目 id 只增不改，保护学员进度 |
| [Oppia](https://github.com/oppia/oppia) | Apache-2.0 | <https://github.com/oppia/oppia> | schema 版本与数据迁移纪律 |

本仓库没有复制这些项目的源码或题库。

### 7. AI 出图工具与模型

| 项目 | 用途 | 许可证 | 地址 |
|---|---|---|---|
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | 本机出图工作流宿主 | GPL-3.0 | <https://github.com/comfyanonymous/ComfyUI> |
| [ComfyUI-Manager](https://github.com/ltdrdata/ComfyUI-Manager) | 本机节点管理 | GPL-3.0 | <https://github.com/ltdrdata/ComfyUI-Manager> |
| ComfyUI-RemoveBackground_SET | 本机抠图节点 | GPL-3.0 | 随 ComfyUI 自定义节点安装 |
| [Anima](https://huggingface.co/circlestone-labs/Anima) | 底模 | **CircleStone Labs Non-Commercial License v1.2（非 OSI）** | <https://huggingface.co/circlestone-labs/Anima> |
| [ds_whalemaid](https://civitai.com/models/2845839) | 第三方 LoRA（作者 `ogura_shigeru`） | 见 Civitai 模型页；受 Anima 上游条款约束 | <https://civitai.com/models/2845839> |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | 背景移除模型 | 见模型发布页 | <https://github.com/ZhengPeng7/BiRefNet> |
| Counterfeit V3.0 | 早期 SD1.5 底模 | 见发布页 | 第三方模型 |

> ComfyUI 及其节点包是 **GPL-3.0**，本项目只在作者本机使用它们生成图片，
> **不把 ComfyUI 源码或二进制打进应用安装包**。Anima 权重与所有 LoRA 权重也不随仓库分发。
> 如果你要复现出图环境，请分别遵守这些项目的许可证。

### 8. 完整 npm 依赖台账

- 客户端：20 个直接依赖 + 3 个打进产物的构建期依赖，展开 **73 个 npm 包**，
  许可证分布 MIT ×64、Apache-2.0 ×1、0BSD ×1、BSD-3-Clause ×4、PSF-2.0 ×1、
  BSD-2-Clause ×1、ISC ×1；另有 **2 个不在 npm 依赖树里的内嵌组件**：
  Mediabunny 1.56.0（**MPL-2.0**，文件级 copyleft）与 we-scene（MIT）。
  MPL 的义务是随附许可证原文并提供 Source Code Form，**不要求应用整体开源**；
  全文见 [`LICENSES/MPL-2.0.txt`](./LICENSES/MPL-2.0.txt)。
- 服务端：4 个直接依赖，展开 **60 个包**，MIT ×53、BSD-3-Clause ×3、ISC ×4；
  **copyleft 组件 0 个**。
- 生成方式：`npm run gen:notices` 直接读取 `node_modules` 里的 LICENSE 原文，
  **逐字节照录**；自检会用独立代码路径重新读取并比对。
- 完整清单：[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)、
  [`server/THIRD-PARTY-NOTICES.md`](./server/THIRD-PARTY-NOTICES.md)。

### 9. 其他

- 课程文本、题目与界面文案由项目作者编写；角色「大肥鱼」是 DeepSeek 的拟人二创形象，
  **本项目与 DeepSeek 官方无关联**，相关名称与商标归其权利人所有。
- 界面音效、光标、开屏素材由项目作者制作或提供；目录内 `README.md` 有单独说明。
- 如果你认为某处遗漏了你的署名或许可证，请开 issue 指出，我们会尽快补上。

---

## 许可证边界

| 对象 | 许可 |
|---|---|
| **本项目源代码** | **MIT**，全文见 [`LICENSE`](./LICENSE) |
| npm 依赖 | 各自许可证，全文见两份 `THIRD-PARTY-NOTICES.md` |
| 移植的壁纸代码 | MIT（上游 dsh-wallpaper-engine），文件头保留版权声明 |
| webwallgl / we-scene | MIT（上游 oneincase / aurora-wallpaper contributors） |
| Mediabunny（内嵌库） | **MPL-2.0**，全文见 [`LICENSES/MPL-2.0.txt`](./LICENSES/MPL-2.0.txt) |
| 桌宠代码 | MIT（上游 dsh-pet） |
| 桌宠素材 | **允许开源使用，禁止商用**（上游条款） |
| 桌宠字体 `上首软糖体.ttf` | **第三方商业字体，MIT 不覆盖**；文件不在 Git 跟踪范围，商业分发需自行取得授权 |
| Anima 权重与衍生 LoRA | **非商业**（CircleStone Labs Non-Commercial License v1.2） |
| Anima 生成输出 | 上游允许商用（但第三方 LoRA 另有条款） |
| `g01`–`g200` 图片 | 项目用 Anima + 第三方 LoRA 生成，随仓库提供（生成输出可商用） |
| `g201`–`g224` 原图 | 上游图片清单为 `personal`，**不随公开版分发**；公开版为自制占位卡 |
| `g225`–`g496` 原图 | **授权不足以再分发**，不随公开版分发；公开版为自制占位卡 |
| 课程文本与题目 | 由项目作者编写，随仓库提供；第三方内容已标注来源 |
| API Key、`.env`、数据库、用户数据 | **不在仓库中**，也不应提交 |

**代码的 MIT 许可不自动覆盖图片、模型权重、桌宠素材与第三方内容。**
如果你要商业使用，请逐项确认上表与 `THIRD-PARTY-CODE-NOTICES.md`。

---

## 已知限制与安全说明

1. **Windows 优先**：代码运行、进程树回收、IDE 探测按 Windows 实现；
   macOS / Linux 未验证。
2. **不是沙箱**：应用运行的是用户自己写的代码，拥有当前用户权限。
   超时、截断、单任务队列解决的是「别卡死、别残留、别乱码」，不是安全隔离。
   **不要用它运行来路不明的代码。**
3. **需要本机工具链**：没装 `gcc` / `g++` / `javac` / `python` 时，代码题无法真跑；
   应用会提示环境未就绪，但不会替你安装。
4. **Electron 内置 Node 版本**：当前锁定 Electron 44.9.3，其内置 Node 为 24.22.0。
   截至 2026-10-22，Node 官方针对 CVE-2026-111497（Brotli 解码器越界写）的修复线是
   24.22.1；该残留已在交付报告中记录，后续会随 Electron 升级跟进。应用不解析不可信
   Brotli 输入，实际暴露面有限，但这里如实说明。
5. **云同步可选**：不配置服务器时应用完全离线；配置后会把账号与同步数据发往你指定的服务器。
   服务器地址、密钥与数据库由部署者自行保管。
6. **公开版图库占位**：`g201`–`g496` 在公开仓库中是占位卡，不是原图；
   这不影响应用逻辑，但图片内容与作者本地完整版不同。

---

## 参与贡献

- 提交前请跑：`npm test`、`npm run typecheck`、`npm run validate:content`。
- 代码风格与命名尽量跟随周围文件；新增第三方代码/素材时，**同时更新**
  `README.md` 的致谢、`THIRD-PARTY-CODE-NOTICES.md` 与 `THIRD-PARTY-NOTICES.md`。
- 不要在 issue / PR 里贴真实 API Key、服务器密码、SSH 私钥或用户数据。
- 发现安全问题请先私下联系作者，不要在公开 issue 里贴利用细节。

---

## English summary

**miai-biancheng** is an offline-first Windows desktop companion for learning programming,
built with Electron, Vue 3 and TypeScript. It ships 266 lessons and 6,026 exercises across
C, C++, Java, Python and common fundamentals; code exercises are compiled and executed locally.
It also includes a study loop (wrong-book, daily review, daily challenge), a WebGL/video wallpaper
engine, a desktop pet, and an optional self-hosted Fastify + PostgreSQL backend.

The source code is MIT-licensed. Third-party dependencies, ported wallpaper code, the dsh-pet
engine and its assets, AI model weights and gallery images have their own terms — see
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md),
[`THIRD-PARTY-CODE-NOTICES.md`](./THIRD-PARTY-CODE-NOTICES.md) and
[`docs/comfyui_workflow.md`](./docs/comfyui_workflow.md).

The mascot artwork was produced with a local ComfyUI pipeline. Early attempts trained two
SD1.5 LoRAs; the final pipeline uses the Anima base model with a third-party LoRA
(`ds_whalemaid` by `ogura_shigeru`). Anima is **not OSI open source**: its weights and
derivatives are non-commercial, while generated outputs may be used commercially.
No model weights are distributed in this repository.
