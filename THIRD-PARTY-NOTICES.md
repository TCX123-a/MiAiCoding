# 第三方开源组件声明

**咪爱编程（miai-biancheng）** · 版本 0.1.0 · 本文件 Generate 于 2026-10-22

> 🤖 **本文件由脚本自动生成，请勿手改。**
> 生成命令：`npm run gen:notices`（源码见 `scripts/gen-third-party-notices.mjs`）
> 增删任何依赖之后都要重跑一次，否则下面的版本号会过期。

---

## 这份文件是干什么的

咪爱编程用到了很多别人写好的开源库。这些库的许可证都要求在**分发软件时**把「用了谁的东西、他们的版权归谁、他们的许可证原文」一并带上。这份文件就是干这个的。

**什么时候需要在意它**：只要有一天你把咪爱编程打包成 exe 发给别人（哪怕只发给一个朋友），这些声明就必须跟着一起走。放在仓库里不占地方，但缺了它就是一个真实的合规漏洞，而且**是那种事后很难补的漏洞**（因为你要回头去查当时用的是哪个版本）。

**它是怎么来的**：不是从网上抄的模板，是直接读取本机 `node_modules/` 里每个包自己带的 `LICENSE` 文件原文汇总的。所以它和**实际装的版本**逐字对应。另外，上游包 bundle 里内嵌、但不在 npm 依赖树里的组件（Mediabunny / we-scene）单列在 2.3 节，正文同样照录。

---

## 一、总览

| 项目 | 数值 |
|---|---|
| 直接运行时依赖（`dependencies`） | 20 个 |
| 其中被打进分发产物的构建期依赖（`devDependencies`） | 3 个 |
| 展开全部传递依赖后 | 73 个 |
| 许可证原文总字节数 | 94,292 字节 |
| 含 copyleft（GPL/AGPL/LGPL/MPL）的组件 | **1 个** |

**协议分布**：

| 许可证 | 组件数 | 性质 |
|---|---|---|
| MIT | 64 | 宽松，只需保留版权声明 |
| BSD-3-Clause | 4 | 宽松，另加「不得用作者名背书」 |
| Apache-2.0 | 1 | 宽松，另需转载 NOTICE 文件、声明改动 |
| 0BSD | 1 | 最宽松，**连版权声明都不要求保留** |
| PSF-2.0 | 1 | 宽松（Python 基金会版） |
| BSD-2-Clause | 1 | 宽松，只需保留版权声明 |
| ISC | 1 | 宽松，等同 MIT 的简化版 |

> ⚠️ **发现 copyleft 组件，需要人工确认**：
>
> - `mediabunny@1.56.0`（内嵌于 webwallgl@2.1.0（npm 发行版 bundle），不在 npm 依赖树里）—— MPL-2.0
>
> **MPL-2.0 是文件级 copyleft**：义务落在被覆盖的**源文件**上，不要求把整个应用开源。
> 本项目没有修改 Mediabunny 的源码，已随附 MPL 全文（`LICENSES/MPL-2.0.txt`）与
> Source Code Form 的获取途径（见 2.3 节与 4 节）。**不要删除**这两处声明。

---

## 二、组件清单

### 2.1 直接依赖（`package.json` 里显式声明的）

| 组件 | 版本 | 许可证 | 版权归属 |
|---|---|---|---|
| `@codemirror/autocomplete` | 6.20.3 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@codemirror/commands` | 6.11.0 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@codemirror/lang-cpp` | 6.0.3 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@codemirror/lang-java` | 6.0.2 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@codemirror/lang-python` | 6.2.1 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@codemirror/language` | 6.12.4 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@codemirror/state` | 6.7.4 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@codemirror/view` | 6.43.11 | MIT | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@formkit/auto-animate` | 0.10.0 | MIT | Copyright 2022 FormKit Inc. |
| `@lezer/highlight` | 1.2.3 | MIT | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `animejs` | 4.5.0 | MIT | Copyright (c) 2025 Julian Garnier |
| `dsh-pet` | 0.3.5 | MIT | Copyright (c) 2026 PC2005-cloud |
| `echarts` | 6.1.0 | Apache-2.0 | Copyright 2017-2026 The Apache Software Foundation（摘自该包 NOTICE 文件） |
| `electron` | 44.9.3 | MIT | Copyright (c) Electron contributors Copyright (c) 2013-2020 GitHub Inc. |
| `highlight.js` | 11.12.0 | BSD-3-Clause | Copyright (c) 2006, Ivan Sagalaev. |
| `iconv-lite` | 0.7.3 | MIT | Copyright (c) 2011 Alexander Shtuchkin |
| `markdown-it` | 15.0.1 | MIT | Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin. |
| `markdown-it-container` | 4.0.0 | MIT | Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin. |
| `pinia` | 3.0.4 | MIT | Copyright (c) 2019-present Eduardo San Martin Morote |
| `splitpanes` | 4.1.2 | MIT | Copyright (c) 2018 Antoni Andre |
| `vue` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `vue-router` | 4.6.4 | MIT | Copyright (c) 2019-present Eduardo San Martin Morote |
| `webwallgl` | 2.1.0 | MIT | Copyright (c) 2026 oneincase <462534624@qq.com> |

> 📌 `dsh-pet`：代码 MIT（Copyright 2026 PC2005-cloud）；**素材**（动画/提示词/源视频）的条款是「允许开源使用，禁止商用」，与代码 MIT 不是一回事。构建脚本 `build/dshpet-vendor.ts` 会把这段二创声明写进 `out/pet-helper`，上游地址：<https://github.com/PC2005-cloud/dsh-pet>。

> 📌 `electron`：安装包内置的 Electron 运行时（MIT）。版本以 `package.json` 的 `build.electronVersion` 为准（本仓库 44.9.3）；Electron 分发包内另带 `LICENSES.chromium.html`（Chromium 及其依赖的许可证汇编），打包时随安装包一起分发，不要删。

> 📌 这张表里有 3 个是 **`devDependencies`**（`iconv-lite`、`dsh-pet`、`electron`）—— 它们的代码会被**内联进分发产物**，所以必须列进来。
>
> 为什么：主进程 / 预加载构建的 `externalizeDepsPlugin()` **只外置 `dependencies`**，源码里 import 进来的 devDependency 一律被 esbuild 打包进 `out/`。前几项是脚本**扫 `src/` 的 import 自动找出来的**（见脚本里的 `bundledDevDeps`），`dsh-pet` / `electron` 是构建脚本显式补上的（它们由 `build/dshpet-vendor.ts` 与安装器带进分发物），不是手写版本号。
>
> 测试文件里的 import（vitest 那些）不在扫描范围：它们只在开发机跑，不进分发产物。

### 2.2 传递依赖（被上面的包间接引入的）

> 📌 **这一节里有相当一部分是「多列的」。** 比如 `@vue/compiler-sfc`、`@babel/parser`、`postcss`、`magic-string` 这些是 **Vue 在构建阶段用的编译器**，打包时会被摇掉，**不会进入最终分发的程序**。把它们列上属于「多算不多错」——声明多了没有法律风险，少了才有。

| 组件 | 版本 | 许可证 | 版权归属 |
|---|---|---|---|
| `@babel/helper-string-parser` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| `@babel/parser` | 7.29.8 | MIT | Copyright (C) 2012-2014 by various contributors (see AUTHORS) |
| `@babel/types` | 7.29.8 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| `@lezer/common` | 1.5.2 | MIT | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@lezer/cpp` | 1.1.6 | MIT | Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@lezer/java` | 1.1.4 | MIT | Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@lezer/lr` | 1.4.10 | MIT | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@lezer/python` | 1.1.19 | MIT | Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `@marijn/find-cluster-break` | 1.0.4 | MIT | Copyright (C) 2024 by Marijn Haverbeke <marijn@haverbeke.berlin> |
| `@vue/compiler-core` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/compiler-dom` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/compiler-sfc` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/compiler-ssr` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/devtools-api` | 7.7.10 | MIT | Copyright (c) 2023 webfansplz |
| `@vue/devtools-kit` | 7.7.10 | MIT | Copyright (c) 2023 webfansplz |
| `@vue/devtools-shared` | 7.7.10 | MIT | Copyright (c) 2023 webfansplz |
| `@vue/reactivity` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/runtime-core` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/runtime-dom` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/server-renderer` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `@vue/shared` | 3.5.42 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| `argparse` | 3.0.1 | PSF-2.0 | (该包未在 LICENSE 中声明版权行，见其 package.json 的 author 字段) |
| `birpc` | 2.9.0 | MIT | Copyright (c) 2021 Anthony Fu <https://github.com/antfu> |
| `copy-anything` | 4.1.0 | MIT | Copyright (c) 2018 Luca Ban - Mesqueeb |
| `crelt` | 1.0.7 | MIT | Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> |
| `csstype` | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| `entities` | 8.1.0 | BSD-2-Clause | Copyright (c) Felix Böhm |
| `estree-walker` | 2.0.2 | MIT | Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors) |
| `hookable` | 5.5.3 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> |
| `linkify-it` | 6.1.0 | MIT | Copyright (c) 2015 Vitaly Puzrin. |
| `magic-string` | 0.30.21 | MIT | Copyright 2018 Rich Harris |
| `mdurl` | 2.1.0 | MIT | Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin. Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| `mitt` | 3.0.1 | MIT | Copyright (c) 2021 Jason Miller |
| `nanoid` | 3.3.18 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> |
| `perfect-debounce` | 1.0.0 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> |
| `picocolors` | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |
| `postcss` | 8.5.28 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> |
| `punycode.js` | 2.3.1 | MIT | Copyright Mathias Bynens <https://mathiasbynens.be/> |
| `rfdc` | 1.4.1 | MIT | Copyright 2019 "David Mark Clements <david.mark.clements@gmail.com>" |
| `safer-buffer` | 2.1.2 | MIT | Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com> |
| `source-map-js` | 1.2.1 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| `speakingurl` | 14.0.1 | BSD-3-Clause | Copyright (c) 2013-2017 Sascha Droste <pid@posteo.net> |
| `style-mod` | 4.1.3 | MIT | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `superjson` | 2.2.6 | MIT | Copyright (c) 2020 Simon Knott and superjson contributors |
| `tslib` | 2.3.0 | 0BSD | Copyright (c) Microsoft Corporation. |
| `uc.micro` | 3.0.0 | MIT | Copyright Mathias Bynens <https://mathiasbynens.be/> |
| `w3c-keyname` | 2.2.8 | MIT | Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| `zrender` | 6.1.0 | BSD-3-Clause | Copyright (c) 2017, Baidu Inc. |

### 2.3 随 bundle 分发的内嵌组件（不是独立 npm 依赖）

这些组件被上游包的发行版直接编进了 bundle，**不在 `node_modules` 的依赖树里**，
所以只扫 npm 依赖永远列不上；它们同样随应用分发，必须单独声明。

| 组件 | 版本 | 许可证 | 版权归属 | 随哪个包分发 |
|---|---|---|---|---|
| `mediabunny` | 1.56.0 | MPL-2.0 | Copyright (c) 2026-present, Vanilagy and contributors | webwallgl@2.1.0（npm 发行版 bundle） |
| `we-scene` | 随 webwallgl@2.1.0 bundle | MIT | Copyright (c) 2026 aurora-wallpaper contributors | webwallgl@2.1.0（npm 发行版 bundle） |

> 📌 `mediabunny`（上游：<https://github.com/Vanilagy/mediabunny>）：文件级 copyleft：义务只落在 Mediabunny 自身的源文件上，不要求把整个应用开源。本项目未修改其源码；Source Code Form 可从上游仓库 v1.56.0 标签或 npm 包 `mediabunny@1.56.0` 获取。

> 📌 `we-scene`（上游：<https://github.com/oneincase/webwallgl>）：Wallpaper Engine 场景运行时（vendored）。MIT 正文与 §4 的 MIT 模板逐字相同，仅版权行不同；其内置的 WE 官方 shader 头重建子集不改变 MIT 条款，壁纸素材版权仍归各作品作者。

---

## 三、Apache-2.0 的额外义务（涉及 1 个组件）

Apache-2.0 比 MIT 多两条要求：

1. **如果原包带了 `NOTICE` 文件，分发时必须转载它的内容**
2. **如果你修改了源码，要说明改了哪里**

关于第 2 条：本项目**没有修改**这些组件的任何源码，只是作为依赖引用，所以这条不适用。

关于第 1 条，以下逐个列出：

### `echarts@6.1.0`

**`node_modules\echarts\NOTICE` 原文**：

```
Apache ECharts
Copyright 2017-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

**内嵌子组件**：该包的 `licenses/` 目录下还有 1 份独立的许可证。
这说明它的源码里**内嵌了别人的代码**，那些代码的许可证与主许可证不是一回事，需要一并转载：

#### `node_modules\echarts\licenses\LICENSE-d3`

```
Copyright 2010-2016 Mike Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 四、许可证原文

下面是上面所有组件的许可证正文。**为了不把同一份 MIT 印 66 遍**，正文按「协议 + 措辞」去重；每个组件各自的**版权行**已在第二节的清单里逐条列出，两者合起来才构成完整声明。

### 4.1 0BSD —— 适用于 1 个组件

**适用组件**：`tslib@2.3.0`

**各组件版权行**：

- `tslib@2.3.0` —— Copyright (c) Microsoft Corporation.

**许可证正文**（照录 `node_modules\tslib\LICENSE.txt`，**一字未改**）：

```
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### 4.2 Apache-2.0 —— 适用于 1 个组件

**适用组件**：`echarts@6.1.0`

**各组件版权行**：

- `echarts@6.1.0` —— Copyright 2017-2026 The Apache Software Foundation（摘自该包 NOTICE 文件）

**许可证正文**（照录 `node_modules\echarts\LICENSE`，**一字未改**）：

```
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.





========================================================================
Apache ECharts Subcomponents:

The Apache ECharts project contains subcomponents with separate copyright
notices and license terms. Your use of the source code for these
subcomponents is also subject to the terms and conditions of the following
licenses.

BSD 3-Clause (d3.js):
The following files embed [d3.js](https://github.com/d3/d3) BSD 3-Clause:
    `/src/chart/treemap/treemapLayout.ts`,
    `/src/chart/tree/layoutHelper.ts`,
    `/src/chart/graph/forceHelper.ts`,
    `/src/util/number.ts`
See `/licenses/LICENSE-d3` for details of the license.
```

### 4.3 BSD-2-Clause —— 适用于 1 个组件

**适用组件**：`entities@8.1.0`

**各组件版权行**：

- `entities@8.1.0` —— Copyright (c) Felix Böhm

**许可证正文**（照录 `node_modules\entities\LICENSE`，**一字未改**）：

```
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 4.4 BSD-3-Clause —— 适用于 2 个组件

**适用组件**：`zrender@6.1.0`、`highlight.js@11.12.0`

**各组件版权行**：

- `zrender@6.1.0` —— Copyright (c) 2017, Baidu Inc.
- `highlight.js@11.12.0` —— Copyright (c) 2006, Ivan Sagalaev.

**许可证正文**（照录 `node_modules\zrender\LICENSE`，**一字未改**）：

```
BSD 3-Clause License

Copyright (c) 2017, Baidu Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

> 上面的正文里带的是 `zrender` 自己的版权行；其余 1 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.5 BSD-3-Clause —— 适用于 1 个组件

**适用组件**：`speakingurl@14.0.1`

**各组件版权行**：

- `speakingurl@14.0.1` —— Copyright (c) 2013-2017 Sascha Droste <pid@posteo.net>

**许可证正文**（照录 `node_modules\speakingurl\LICENSE`，**一字未改**）：

```
The BSD 3-Clause License (BSD3)

Copyright (c) 2013-2017 Sascha Droste <pid@posteo.net>
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name of the author nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 4.6 BSD-3-Clause —— 适用于 1 个组件

**适用组件**：`source-map-js@1.2.1`

**各组件版权行**：

- `source-map-js@1.2.1` —— Copyright (c) 2009-2011, Mozilla Foundation and contributors

**许可证正文**（照录 `node_modules\source-map-js\LICENSE`，**一字未改**）：

```
Copyright (c) 2009-2011, Mozilla Foundation and contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the names of the Mozilla Foundation nor the names of project
  contributors may be used to endorse or promote products derived from this
  software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 4.7 ISC —— 适用于 1 个组件

**适用组件**：`picocolors@1.1.1`

**各组件版权行**：

- `picocolors@1.1.1` —— Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov

**许可证正文**（照录 `node_modules\picocolors\LICENSE`，**一字未改**）：

```
ISC License

Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### 4.8 MIT —— 适用于 15 个组件

**适用组件**：`@codemirror/autocomplete@6.20.3`、`@codemirror/language@6.12.4`、`@codemirror/state@6.7.4`、`@marijn/find-cluster-break@1.0.4`、`@codemirror/view@6.43.11`、`@lezer/common@1.5.2`、`@lezer/highlight@1.2.3`、`@lezer/lr@1.4.10`、`@codemirror/commands@6.11.0`、`@codemirror/lang-cpp@6.0.3`、`@lezer/cpp@1.1.6`、`@codemirror/lang-java@6.0.2`、`@lezer/java@1.1.4`、`@codemirror/lang-python@6.2.1`、`@lezer/python@1.1.19`

**各组件版权行**：

- `@codemirror/autocomplete@6.20.3` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@codemirror/language@6.12.4` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@codemirror/state@6.7.4` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@marijn/find-cluster-break@1.0.4` —— Copyright (C) 2024 by Marijn Haverbeke <marijn@haverbeke.berlin>
- `@codemirror/view@6.43.11` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@lezer/common@1.5.2` —— Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@lezer/highlight@1.2.3` —— Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@lezer/lr@1.4.10` —— Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@codemirror/commands@6.11.0` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@codemirror/lang-cpp@6.0.3` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@lezer/cpp@1.1.6` —— Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@codemirror/lang-java@6.0.2` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@lezer/java@1.1.4` —— Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@codemirror/lang-python@6.2.1` —— Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@lezer/python@1.1.19` —— Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

**许可证正文**（照录 `node_modules\@codemirror\autocomplete\LICENSE`，**一字未改**）：

```
MIT License

Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

> 上面的正文里带的是 `@codemirror/autocomplete` 自己的版权行；其余 14 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.9 MIT —— 适用于 12 个组件

**适用组件**：`@vue/devtools-api@7.7.10`、`@vue/devtools-kit@7.7.10`、`birpc@2.9.0`、`mitt@3.0.1`、`perfect-debounce@1.0.0`、`superjson@2.2.6`、`copy-anything@4.1.0`、`@vue/devtools-shared@7.7.10`、`splitpanes@4.1.2`、`webwallgl@2.1.0`、`safer-buffer@2.1.2`、`dsh-pet@0.3.5`

**各组件版权行**：

- `@vue/devtools-api@7.7.10` —— Copyright (c) 2023 webfansplz
- `@vue/devtools-kit@7.7.10` —— Copyright (c) 2023 webfansplz
- `birpc@2.9.0` —— Copyright (c) 2021 Anthony Fu <https://github.com/antfu>
- `mitt@3.0.1` —— Copyright (c) 2021 Jason Miller
- `perfect-debounce@1.0.0` —— Copyright (c) Pooya Parsa <pooya@pi0.io>
- `superjson@2.2.6` —— Copyright (c) 2020 Simon Knott and superjson contributors
- `copy-anything@4.1.0` —— Copyright (c) 2018 Luca Ban - Mesqueeb
- `@vue/devtools-shared@7.7.10` —— Copyright (c) 2023 webfansplz
- `splitpanes@4.1.2` —— Copyright (c) 2018 Antoni Andre
- `webwallgl@2.1.0` —— Copyright (c) 2026 oneincase <462534624@qq.com>
- `safer-buffer@2.1.2` —— Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com>
- `dsh-pet@0.3.5` —— Copyright (c) 2026 PC2005-cloud

**许可证正文**（照录 `node_modules\@vue\devtools-api\LICENSE`，**一字未改**）：

```
MIT License

Copyright (c) 2023 webfansplz

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

> 上面的正文里带的是 `@vue/devtools-api` 自己的版权行；其余 11 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.10 MIT —— 适用于 10 个组件

**适用组件**：`vue@3.5.42`、`@vue/shared@3.5.42`、`@vue/runtime-dom@3.5.42`、`@vue/runtime-core@3.5.42`、`@vue/reactivity@3.5.42`、`@vue/compiler-sfc@3.5.42`、`@vue/compiler-core@3.5.42`、`@vue/compiler-dom@3.5.42`、`@vue/compiler-ssr@3.5.42`、`@vue/server-renderer@3.5.42`

**各组件版权行**：

- `vue@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/shared@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/runtime-dom@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/runtime-core@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/reactivity@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/compiler-sfc@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/compiler-core@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/compiler-dom@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/compiler-ssr@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/server-renderer@3.5.42` —— Copyright (c) 2018-present, Yuxi (Evan) You

**许可证正文**（照录 `node_modules\vue\LICENSE`，**一字未改**）：

```
The MIT License (MIT)

Copyright (c) 2018-present, Yuxi (Evan) You

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

> 上面的正文里带的是 `vue` 自己的版权行；其余 9 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.11 MIT —— 适用于 4 个组件

**适用组件**：`crelt@1.0.7`、`style-mod@4.1.3`、`w3c-keyname@2.2.8`、`@babel/parser@7.29.8`

**各组件版权行**：

- `crelt@1.0.7` —— Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin>
- `style-mod@4.1.3` —— Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `w3c-keyname@2.2.8` —— Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `@babel/parser@7.29.8` —— Copyright (C) 2012-2014 by various contributors (see AUTHORS)

**许可证正文**（照录 `node_modules\crelt\LICENSE`，**一字未改**）：

```
Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

> 上面的正文里带的是 `crelt` 自己的版权行；其余 3 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.12 MIT —— 适用于 4 个组件

**适用组件**：`uc.micro@3.0.0`、`punycode.js@2.3.1`、`iconv-lite@0.7.3`、`electron@44.9.3`

**各组件版权行**：

- `uc.micro@3.0.0` —— Copyright Mathias Bynens <https://mathiasbynens.be/>
- `punycode.js@2.3.1` —— Copyright Mathias Bynens <https://mathiasbynens.be/>
- `iconv-lite@0.7.3` —— Copyright (c) 2011 Alexander Shtuchkin
- `electron@44.9.3` —— Copyright (c) Electron contributors Copyright (c) 2013-2020 GitHub Inc.

**许可证正文**（照录 `node_modules\uc.micro\LICENSE.txt`，**一字未改**）：

```
Copyright Mathias Bynens <https://mathiasbynens.be/>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

> 上面的正文里带的是 `uc.micro` 自己的版权行；其余 3 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.13 MIT —— 适用于 3 个组件

**适用组件**：`@formkit/auto-animate@0.10.0`、`estree-walker@2.0.2`、`magic-string@0.30.21`

**各组件版权行**：

- `@formkit/auto-animate@0.10.0` —— Copyright 2022 FormKit Inc.
- `estree-walker@2.0.2` —— Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors)
- `magic-string@0.30.21` —— Copyright 2018 Rich Harris

**许可证正文**（照录 `node_modules\@formkit\auto-animate\LICENSE`，**一字未改**）：

```
Copyright 2022 FormKit Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

> 上面的正文里带的是 `@formkit/auto-animate` 自己的版权行；其余 2 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.14 MIT —— 适用于 3 个组件

**适用组件**：`markdown-it@15.0.1`、`linkify-it@6.1.0`、`markdown-it-container@4.0.0`

**各组件版权行**：

- `markdown-it@15.0.1` —— Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.
- `linkify-it@6.1.0` —— Copyright (c) 2015 Vitaly Puzrin.
- `markdown-it-container@4.0.0` —— Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin.

**许可证正文**（照录 `node_modules\markdown-it\LICENSE`，**一字未改**）：

```
Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

> 上面的正文里带的是 `markdown-it` 自己的版权行；其余 2 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.15 MIT —— 适用于 3 个组件

**适用组件**：`pinia@3.0.4`、`hookable@5.5.3`、`vue-router@4.6.4`

**各组件版权行**：

- `pinia@3.0.4` —— Copyright (c) 2019-present Eduardo San Martin Morote
- `hookable@5.5.3` —— Copyright (c) Pooya Parsa <pooya@pi0.io>
- `vue-router@4.6.4` —— Copyright (c) 2019-present Eduardo San Martin Morote

**许可证正文**（照录 `node_modules\pinia\LICENSE`，**一字未改**）：

```
The MIT License (MIT)

Copyright (c) 2019-present Eduardo San Martin Morote

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

> 上面的正文里带的是 `pinia` 自己的版权行；其余 2 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.16 MIT —— 适用于 3 个组件

**适用组件**：`@babel/types@7.29.8`、`@babel/helper-string-parser@7.29.7`、`@babel/helper-validator-identifier@7.29.7`

**各组件版权行**：

- `@babel/types@7.29.8` —— Copyright (c) 2014-present Sebastian McKenzie and other contributors
- `@babel/helper-string-parser@7.29.7` —— Copyright (c) 2014-present Sebastian McKenzie and other contributors
- `@babel/helper-validator-identifier@7.29.7` —— Copyright (c) 2014-present Sebastian McKenzie and other contributors

**许可证正文**（照录 `node_modules\@babel\types\LICENSE`，**一字未改**）：

```
MIT License

Copyright (c) 2014-present Sebastian McKenzie and other contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

> 上面的正文里带的是 `@babel/types` 自己的版权行；其余 2 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.17 MIT —— 适用于 2 个组件

**适用组件**：`postcss@8.5.28`、`nanoid@3.3.18`

**各组件版权行**：

- `postcss@8.5.28` —— Copyright 2013 Andrey Sitnik <andrey@sitnik.es>
- `nanoid@3.3.18` —— Copyright 2017 Andrey Sitnik <andrey@sitnik.ru>

**许可证正文**（照录 `node_modules\postcss\LICENSE`，**一字未改**）：

```
The MIT License (MIT)

Copyright 2013 Andrey Sitnik <andrey@sitnik.es>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

> 上面的正文里带的是 `postcss` 自己的版权行；其余 1 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.18 MIT —— 适用于 1 个组件

**适用组件**：`animejs@4.5.0`

**各组件版权行**：

- `animejs@4.5.0` —— Copyright (c) 2025 Julian Garnier

**许可证正文**（照录 `node_modules\animejs\LICENSE.md`，**一字未改**）：

```
The MIT License

Copyright (c) 2025 Julian Garnier

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### 4.19 MIT —— 适用于 1 个组件

**适用组件**：`mdurl@2.1.0`

**各组件版权行**：

- `mdurl@2.1.0` —— Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin. Copyright Joyent, Inc. and other Node contributors. All rights reserved.

**许可证正文**（照录 `node_modules\mdurl\LICENSE`，**一字未改**）：

```
Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

--------------------------------------------------------------------------------

.parse() is based on Joyent's node.js `url` code:

Copyright Joyent, Inc. and other Node contributors. All rights reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

### 4.20 MIT —— 适用于 1 个组件

**适用组件**：`rfdc@1.4.1`

**各组件版权行**：

- `rfdc@1.4.1` —— Copyright 2019 "David Mark Clements <david.mark.clements@gmail.com>"

**许可证正文**（照录 `node_modules\rfdc\LICENSE`，**一字未改**）：

```
Copyright 2019 "David Mark Clements <david.mark.clements@gmail.com>"

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated 
documentation files (the "Software"), to deal in the Software without restriction, including without limitation 
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and 
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions 
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED 
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL 
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF 
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS 
IN THE SOFTWARE.
```

### 4.21 MIT —— 适用于 1 个组件

**适用组件**：`csstype@3.2.3`

**各组件版权行**：

- `csstype@3.2.3` —— Copyright (c) 2017-2018 Fredrik Nicol

**许可证正文**（照录 `node_modules\csstype\LICENSE`，**一字未改**）：

```
Copyright (c) 2017-2018 Fredrik Nicol

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

### 4.22 MIT —— 适用于 1 个组件

**适用组件**：`@jridgewell/sourcemap-codec@1.6.0`

**各组件版权行**：

- `@jridgewell/sourcemap-codec@1.6.0` —— Copyright 2024 Justin Ridgewell <justin@ridgewell.name>

**许可证正文**（照录 `node_modules\@jridgewell\sourcemap-codec\LICENSE`，**一字未改**）：

```
Copyright 2024 Justin Ridgewell <justin@ridgewell.name>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 4.23 PSF-2.0 —— 适用于 1 个组件

**适用组件**：`argparse@3.0.1`

**各组件版权行**：

- `argparse@3.0.1` —— (该包未在 LICENSE 中声明版权行，见其 package.json 的 author 字段)

**许可证正文**（照录 `node_modules\argparse\LICENSE`，**一字未改**）：

```
PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2

1. This LICENSE AGREEMENT is between the Python Software Foundation
("PSF"), and the Individual or Organization ("Licensee") accessing and
otherwise using this software ("Python") in source or binary form and
its associated documentation.

2. Subject to the terms and conditions of this License Agreement, PSF hereby
grants Licensee a nonexclusive, royalty-free, world-wide license to reproduce,
analyze, test, perform and/or display publicly, prepare derivative works,
distribute, and otherwise use Python alone or in any derivative version,
provided, however, that PSF's License Agreement and PSF's notice of copyright,
i.e., "Copyright (c) 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010,
2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019 Python Software Foundation;
All Rights Reserved" are retained in Python alone or in any derivative version
prepared by Licensee.

3. In the event Licensee prepares a derivative work that is based on
or incorporates Python or any part thereof, and wants to make
the derivative work available to others as provided herein, then
Licensee hereby agrees to include in any such work a brief summary of
the changes made to Python.

4. PSF is making Python available to Licensee on an "AS IS"
basis.  PSF MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PSF MAKES NO AND
DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON WILL NOT
INFRINGE ANY THIRD PARTY RIGHTS.

5. PSF SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON
FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS
A RESULT OF MODIFYING, DISTRIBUTING, OR OTHERWISE USING PYTHON,
OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

6. This License Agreement will automatically terminate upon a material
breach of its terms and conditions.

7. Nothing in this License Agreement shall be deemed to create any
relationship of agency, partnership, or joint venture between PSF and
Licensee.  This License Agreement does not grant permission to use PSF
trademarks or trade name in a trademark sense to endorse or promote
products or services of Licensee, or any third party.

8. By copying, installing or otherwise using Python, Licensee
agrees to be bound by the terms and conditions of this License
Agreement.
```

### 4.24 MPL-2.0 —— 内嵌组件 `mediabunny@1.56.0`

**组件**：`mediabunny@1.56.0`（webwallgl@2.1.0（npm 发行版 bundle））

**版权归属**：Copyright (c) 2026-present, Vanilagy and contributors

**上游地址**：<https://github.com/Vanilagy/mediabunny>

**许可证正文**（照录 `LICENSES/MPL-2.0.txt`，**一字未改**）：

```
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in 
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

> 文件级 copyleft：义务只落在 Mediabunny 自身的源文件上，不要求把整个应用开源。本项目未修改其源码；Source Code Form 可从上游仓库 v1.56.0 标签或 npm 包 `mediabunny@1.56.0` 获取。

### 4.25 MIT —— 内嵌组件 `we-scene@随 webwallgl@2.1.0 bundle`

**组件**：`we-scene@随 webwallgl@2.1.0 bundle`（webwallgl@2.1.0（npm 发行版 bundle））

**版权归属**：Copyright (c) 2026 aurora-wallpaper contributors

**上游地址**：<https://github.com/oneincase/webwallgl>

**许可证正文**：MIT，正文与第 4 节中的 MIT 模板逐字相同，版权行见本节开头。

> Wallpaper Engine 场景运行时（vendored）。MIT 正文与 §4 的 MIT 模板逐字相同，仅版权行不同；其内置的 WE 官方 shader 头重建子集不改变 MIT 条款，壁纸素材版权仍归各作品作者。

---

## 附：本项目自身的许可证

咪爱编程（miai-biancheng） 本身以 **MIT** 许可证发布，全文见 [`LICENSE`](./LICENSE)。

> 注意：本文件覆盖 **npm 依赖与随 bundle 分发的内嵌组件**。仓库里的图片、桌宠素材、ComfyUI 工作流与模型权重各有自己的许可，见根目录 `README.md` 的「致谢 / Open Source Credits」与 `docs/comfyui_workflow.md`；不要把这份 MIT 声明当成对全部素材的授权。
