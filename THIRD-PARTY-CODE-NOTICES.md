# 第三方代码与素材声明（非 npm 依赖）

> 本文件补充 `THIRD-PARTY-NOTICES.md`。后者由脚本从 `node_modules/` 生成，覆盖 **npm 依赖**，
> 并单列两个随 bundle 内嵌、但不在 npm 依赖树里的组件（Mediabunny / we-scene）；
> 本文件覆盖**移植/改写的代码、内嵌库、设计规范参考、桌宠与壁纸项目、AI 模型与素材、字体**。
>
> 维护方式：**手写**。新增移植代码或素材时，必须同时更新本文件与 README 的「致谢 / Open Source Credits」。

---

## 一、移植或改写的代码

### 1.1 `elysia395/dsh-wallpaper-engine`

本项目壁纸引擎的多个文件是**逐字移植或逐段改写**自该项目：

| 本项目文件 | 上游对应 |
|---|---|
| `src/renderer/src/lib/wallpaper/parallax.ts` | `src/parallax-layer.js` + `styles.js` 视差段 |
| `src/renderer/src/lib/wallpaper/transitions.ts` | `client.js:890-997` / `layer-core.js:84-105` |
| `src/shared/wallpaper-props.ts` | `lib/we-props.js` |
| `src/shared/we-cond.ts` | `src/we-cond.js` |
| `src/renderer/src/components/domain/WallpaperPropsPanel.vue` | 面板结构参考 `client.js` / `picker-props-panel.js` |

- 上游地址：<https://github.com/elysia395/dsh-wallpaper-engine>
- 许可证：MIT
- 版权：Copyright (c) 2026 elysia395

```text
MIT License

Copyright (c) 2026 elysia395

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 1.2 `PC2005-cloud/dsh-pet`（桌宠引擎）

- 上游地址：<https://github.com/PC2005-cloud/dsh-pet>
- 代码许可证：MIT，Copyright (c) 2026 PC2005-cloud
- 素材条款：**允许开源使用，禁止商用**（动画 / 提示词 / 源视频与代码 MIT 不是一回事）
- 分发位置：构建脚本 `build/dshpet-vendor.ts` 把运行时代码与素材拷进 `out/pet-helper`，并在该目录写入原作者署名与素材条款。
- 本项目改动：`build/dshpet-patch.mjs` 与 `build/dshpet-extras/miai-extras.js` 对 helper 做咪爱化补丁；这些补丁代码以 MIT 发布，但**不改变上游素材的非商用条款**。

> 如果你要把桌宠素材用于商业产品，必须先取得上游作者的单独授权，不能只依赖代码 MIT。

### 1.3 `mediabunny`（内嵌在 webwallgl 的 bundle 里）

- 组件：**Mediabunny 1.56.0**
- 上游地址：<https://github.com/Vanilagy/mediabunny>
- 许可证：**MPL-2.0**（Mozilla Public License 2.0，文件级 copyleft）
- 版权：Copyright (c) 2026-present, Vanilagy and contributors
- 关系：**不是独立的 npm 依赖**。`webwallgl@2.1.0` 的 npm 发行版把 Mediabunny 直接编进了
  `webwallgl.mjs`（source map 里可见 43 个 `mediabunny@1.56.0` 源文件），但其
  `package.json` 没有声明它，所以普通依赖扫描发现不了。
- 义务与履行：
  - MPL-2.0 是**文件级** copyleft：只覆盖 Mediabunny 自身的源文件，不要求把整个应用开源；
  - 本项目**没有修改** Mediabunny 源码；
  - 完整许可证原文见 [`LICENSES/MPL-2.0.txt`](./LICENSES/MPL-2.0.txt)，并已转载进
    [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) §4.24；
  - **Source Code Form 获取途径**：上游仓库 <https://github.com/Vanilagy/mediabunny>
    的 `v1.56.0` 标签，或 npm 包 `mediabunny@1.56.0`；
  - 构建配置已打开 `esbuild.legalComments: 'inline'`，避免压缩时移除许可证横幅。

### 1.4 `we-scene`（内嵌在 webwallgl 的 bundle 里）

- 组件：**we-scene**（Wallpaper Engine 场景运行时，vendored）
- 上游地址：<https://github.com/oneincase/webwallgl>（随该引擎一起分发）
- 许可证：**MIT**，Copyright (c) 2026 aurora-wallpaper contributors
- 关系：webwallgl 内置的场景渲染运行时；本项目只通过 `webwallgl@2.1.0` 使用，未单独修改。
- 备注：其中包含 Wallpaper Engine 官方 shader 头的重建子集；**壁纸素材本身的版权仍归各作品作者**，
  不在 MIT 范围内，本项目也不分发任何壁纸素材。
- MIT 正文与 §1.1 的模板逐字相同，仅版权行不同。

### 1.5 `1190fasheqi/dafeiyu-pet`（思路参考）

- 项目：<https://github.com/1190fasheqi/dafeiyu-pet>
- 关系：本项目 `src/main/pet/index.ts` 的「透明窗点击穿透不变量」参考了该项目在同款场景下的做法；
  **没有复制其代码**，也未将其打包进应用。
- 许可证：截至整理时，上游仓库未提供明确的许可证文件；这里按「思路参考」致谢，不主张任何代码授权。
- 如果你要复用该项目的代码，请先向上游作者确认许可。

---

## 二、设计规范参考（仅借鉴方法论，未复制代码）

以下项目在 UI/UX 设计阶段被阅读、对照或作为规范参考。**本仓库没有复制它们的源代码**；
仍在此列明出处与许可证，便于追溯，也便于读者按同一套规范继续改进。

| 项目 | 作者 | 许可证 | 地址 | 本项目参考点 |
|---|---|---|---|---|
| Taste Skill | Leonxlnx | MIT | <https://github.com/Leonxlnx/taste-skill> | 视觉品味、反模板化前端 |
| Make Interfaces Feel Better | Jakub Krehel | MIT | <https://github.com/jakubkrehel/make-interfaces-feel-better> | 动效、排版、图标、悬停态、光学对齐、同心圆角、阴影、点击热区 |
| Impeccable | Paul Bakaus | Apache-2.0 | <https://github.com/pbakaus/impeccable> | 设计审查、确定性检测规则、浏览器迭代 |
| Vercel Labs Agent Skills | Vercel Labs | MIT | <https://github.com/vercel-labs/agent-skills> | Agent Skill 的组织方式 |
| Anthropic Skills · frontend-design | Anthropic | Apache-2.0 | <https://github.com/anthropics/skills> | 前端设计方向、排版与视觉决策 |
| Single Person Workflow | Shining319 | MIT | <https://github.com/shining319/claude-code-single-person-workflow> | 单人开发工作流与插件组织 |

> `impeccable` 的 `NOTICE.md` 还声明其 iOS/Android 平台规范参考了
> [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills)（MIT，作者 ehmo）。
> 本项目只读了 impeccable 的公开规范，没有再分发其 `skill/reference/` 文件。

### 2.1 液态玻璃主题

- 项目：`Rainpomelo/dsh-liquid-glass-theme`
- 地址：<https://github.com/Rainpomelo/dsh-liquid-glass-theme>
- 许可证：MIT，Copyright (c) 2026 Rainpomelo
- 关系：**设计思路与配方参考**。本项目 `src/renderer/src/lib/glass/` 的运行时是 2026-10-08
  三轮独立实验的产物（见 `refraction.ts` 文件头），没有直接复制该主题的 WebGL 源码。
- 备注：上游仓库的 `LICENSE` 文件本身是截断版（只写到 “...associated documentation files...”）。
  为完整合规，下面按标准 MIT 正文补全，版权行保留上游作者：

```text
MIT License

Copyright (c) 2026 Rainpomelo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 2.2 壁纸场景渲染与系统媒体

| 项目 | 作者 | 许可证 | 地址 | 关系 |
|---|---|---|---|---|
| WebWallGL | oneincase | MIT | <https://github.com/oneincase/webwallgl> | **npm 依赖**（`webwallgl@2.1.0`），场景壁纸渲染引擎；构建期打三处补丁。许可证原文见 `THIRD-PARTY-NOTICES.md` |
| we-scene | aurora-wallpaper contributors | MIT | 随 <https://github.com/oneincase/webwallgl> 分发 | **内嵌运行时**：webwallgl bundle 里的 Wallpaper Engine 场景解析/渲染；见 §1.4 |
| Mediabunny | Vanilagy and contributors | **MPL-2.0** | <https://github.com/Vanilagy/mediabunny> | **内嵌库**：webwallgl bundle 里的媒体解封装；见 §1.3、`LICENSES/MPL-2.0.txt` |
| media-bridge | oneincase | MIT | <https://github.com/oneincase/media-bridge> | **可选参考**：Windows 系统音频频谱 / Now Playing 的接入思路；本仓库不包含其源码或二进制，也不作为 npm 依赖 |
| dsh-wallpaper-engine | elysia395 | MIT | <https://github.com/elysia395/dsh-wallpaper-engine> | **代码移植**，见 §1.1 |

`media-bridge` 的 MIT 正文（Copyright (c) 2026 oneincase）与 §1.1 的 MIT 模板逐字相同，
仅版权行不同；如果你未来把它的代码或二进制随包分发，请把版权行替换为
`Copyright (c) 2026 oneincase` 并保留全文。

---

## 三、AI 模型、工作流与出图管线

### 3.1 ComfyUI

- 项目：ComfyUI
- 地址：<https://github.com/comfyanonymous/ComfyUI>
- 许可证：GPL-3.0
- 关系：本项目**在本机使用 ComfyUI 生成图片**，不把 ComfyUI 的源码打进应用安装包。
  `docs/comfyui_workflow.json` 是 API 格式的工作流配置（节点类型、连线、参数），不是 ComfyUI
  源码的副本；它引用的节点由 ComfyUI 及其自定义节点提供。
- 本项目还使用了 ComfyUI-Manager 与 ComfyUI-RemoveBackground_SET（均为 GPL-3.0）作为本机
  出图工具；它们同样**不随应用分发**。如果你要复现出图环境，请分别遵守它们的 GPL-3.0 条款。

### 3.2 Anima 底模

- 项目：CircleStone Labs **Anima**
- 地址：<https://huggingface.co/circlestone-labs/Anima>
- 许可证：**CircleStone Labs Non-Commercial License v1.2**（`license: other`；**不是 OSI 开源许可证**）
- 关键边界：
  - **模型权重与衍生模型（包括 LoRA）仅限非商业、非生产使用**；
  - **生成输出（Outputs）可以商用**（许可证 §2(e) 与模型卡 License 段）；
  - 本仓库**不包含** Anima 权重；`docs/comfyui_workflow.json` 只写文件名，不写权重。
- 本项目用法：在本机用 Anima + LoRA 批量生成奖励图/立绘，属于「用模型产出素材」；
  不把 Anima 权重、也不把以 Anima 为底模的 LoRA 权重随应用分发。

### 3.3 `ds_whalemaid` LoRA

- 名称：DeepSeek女仆鲸娘 whalemaid Chibi anima
- 作者：`ogura_shigeru`
- 地址：Civitai 模型页 <https://civitai.com/models/2845839>（版本 3213109 / v1.0）
- 底模：Anima
- 触发词：`ds_whalemaid`（必须写；缺了不会报错，只会静默退化成底模画风）
- 关系：**第三方 LoRA**，不是本项目自训的 `dafeiyu`。本仓库不包含该权重。
- 注意：Civitai 页面标注允许派生与商用输出，但 LoRA 作为 Anima 的衍生模型仍受 Anima
  非商业条款约束；Civitai 的授权不能覆盖上游模型许可证。

### 3.4 本项目自训 LoRA

- `dafeiyu_c_v2.safetensors`：本项目早期自训的大肥鱼角色 LoRA（SD1.5 线）。
- `dswhale.safetensors`：本项目自训的围裙鲸鱼图案 LoRA（SD1.5 线）。
- 两者**不随仓库分发**；配方与训练记录见 `docs/11-图片资产生产规范.md`。

### 3.5 SD1.5 早期底模

- `Counterfeit-V3.0_fix_fp16.safetensors`：第三方 SD1.5 底模（Counterfeit V3.0 的 fp16 修复版），
  本项目仅在本机早期产线使用；**许可以其发布页为准**，权重不随仓库分发。

### 3.6 抠图模型

- `birefnet.safetensors`：BiRefNet 系列背景移除模型，本项目仅在本机 ComfyUI 中使用；
  许可以其发布页为准，权重不随仓库分发。
- 上游参考：<https://github.com/ZhengPeng7/BiRefNet>

---

## 四、内容组织方法参考（仅借鉴思想）

| 项目 | 许可证 | 地址 | 借鉴点 |
|---|---|---|---|
| freeCodeCamp | BSD-3-Clause | <https://github.com/freeCodeCamp/freeCodeCamp> | 题目内容分区组织；本项目仍是结构化 JSON，不照搬纯文本格式 |
| Exercism | MIT | <https://github.com/exercism/exercism> | 题目/测试用例只增不改、用稳定 id 保护学员进度 |
| Oppia | Apache-2.0 | <https://github.com/oppia/oppia> | 数据结构变更必须 bump schema 版本并写迁移 |

本仓库没有复制这些项目的源码或题库；这里是方法论致谢。

---

## 五、奖励图库与界面素材

### 5.1 图库 id 与公开版策略

应用内保留 **496 个奖励图 id**（`g01`–`g496`），id 一旦写入用户档案就不能改。
开源发布版对图片做如下处理：

| 区间 | 数量 | 来源 | 公开版处理 |
|---|---|---|---|
| `g01`–`g200` | 200 | 本项目 Anima 产线：`anima-preview` + `ds_whalemaid@0.9`（第三方 LoRA，作者 `ogura_shigeru`）；2026-10-17 扩池时 `g01`–`g50` 也原位换成了同一批 Anima 图的第 1 张 | 随仓库分发（生成输出，上游允许商用） |
| `g201`–`g224` | 24 | GitHub [`yyh-001/dsh-meme`](https://github.com/yyh-001/dsh-meme)（commit `598da13`）的 `memes/dafeiyu-001/memes`；**仓库代码 MIT，但图片清单自带 `license: personal`** | **不随公开版分发**，替换为自制占位卡 |
| `g225`–`g496` | 272（含 14 GIF） | 社区图包（来源域名 `img.aigengtu.com/meme/`；**未给出可再分发的许可证**） | **不随公开版分发**，替换为自制占位卡 |

- **`g01`–`g200` 的产线是 Anima，不是 SD1.5。** 项目早期确实跑过 SD1.5（Counterfeit + 自训
  `dafeiyu_c_v2` / `dswhale`），但那批图已在 2026-10-17 的扩池中被 Anima 版原位替换，
  不再出现在当前 496 张图鉴里；SD1.5 配方只作为历史记录保留在 `docs/11`。
- `g201`–`g224` 的图片**不按 MIT 引用**：上游仓库的 MIT 只覆盖代码，表情包清单明确写的是
  `personal`（个人/朋友使用）。本项目未改画、未商用；公开版不包含原图。
- 占位卡是本项目用纯色 + 文字生成的 512×512 PNG，**不是原图的衍生物**；它只保证
  `g201`–`g496` 的文件名、张数、id 槽位与测试对账不缺口，避免发奖时出现空卡。
- 原图只保留在作者本地，不进入公开仓库；如果你从别处拿到这些图，请自行确认授权，
  不要据此推断本项目已获得转授权。
- 图库来历的完整台账（含源文件、种子、口味、水印处理记录）属于作者私有资料，
  公开仓库只保留可公开的摘要。

### 5.2 界面音效、光标、开屏视频

除各目录 `README.md` 另有说明外，`src/renderer/src/assets/sounds/`、
`src/renderer/src/assets/cursors/`、`src/renderer/public/splash/` 中的素材由项目作者制作或提供。
如果你替换为自己的素材，请自行确认授权；不要把「仓库里有这个文件」当成「它可以被任意商用」。

**字体**：桌宠 helper 使用的 `上首软糖体.ttf`（SSRuanTangTi）是**第三方商业字体**，
版权归上首品牌（SounSo）所有。该文件**不在本仓库的 Git 跟踪范围内**，
来自 `dsh-pet` npm 包的 `assets/fonts/`，由 `build/dshpet-vendor.ts` 在构建时拷入
`out/pet-helper/assets/fonts/`。它**不适用**本项目的 MIT 许可；把安装包用于商业分发前，
必须自行取得字体授权或替换为可商用字体。`dsh-pet` 的「允许开源使用」条款不能覆盖
字体本身的商业授权。

**桌宠表情包**：`dsh-pet` 的 `assets/memes/` 随 helper 一并分发，适用上游「允许开源使用，
禁止商用」的素材条款，不是 MIT。

### 5.3 角色与商标

- 「大肥鱼」是 DeepSeek 的拟人二创形象，用于学习陪伴场景；**本项目与 DeepSeek 官方无关联**，
  DeepSeek 名称与商标归其权利人所有。
- 本项目不使用 DeepSeek 官方 Logo 作为应用图标；开屏/界面中的相关文字仅作角色设定说明。
- 如果你要商业使用本项目的角色形象，请同时确认：Anima 输出条款、LoRA 条款、以及
  DeepSeek 二创形象可能涉及的商标/形象权问题。

---

## 六、许可证全文索引

| 许可证 | 在哪里看全文 |
|---|---|
| MIT（本项目） | [`LICENSE`](./LICENSE) |
| MIT（npm 依赖） | [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) 第四节 |
| MIT（dsh-wallpaper-engine） | 本文件 §1.1 |
| MIT（dsh-liquid-glass-theme） | 本文件 §2.1 |
| MIT（media-bridge） | 本文件 §2.2（与 §1.1 正文相同，版权行不同） |
| MIT（we-scene） | 本文件 §1.4（与 §1.1 正文相同，版权行不同） |
| **MPL-2.0（Mediabunny）** | [`LICENSES/MPL-2.0.txt`](./LICENSES/MPL-2.0.txt)；亦转载于 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) §4.24 |
| Apache-2.0（impeccable / frontend-design） | 上游仓库 `LICENSE`；本项目未复制其代码 |
| GPL-3.0（ComfyUI 等） | 上游仓库 `LICENSE`；本项目未随应用分发 |
| Anima 非商业许可证 | <https://huggingface.co/circlestone-labs/Anima/blob/main/LICENSE.md> |
| 上首软糖体（字体） | 上游字体授权；本仓库不跟踪该文件，**MIT 不覆盖** |

---

*最后更新：2026-10-22。新增第三方代码或素材时，请同时更新本文件、README 与 `THIRD-PARTY-NOTICES.md`。*
