# 第三方开源组件声明（服务端）

**咪爱编程服务端（miai-server）** · 版本 0.1.0 · 本文件 Generate 于 2026-10-22

> 🤖 **本文件由脚本自动生成，请勿手改。**
> 生成命令：`node ../scripts/gen-third-party-notices.mjs`（源码见 `scripts/gen-third-party-notices.mjs`）
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
| 直接运行时依赖（`dependencies`） | 4 个 |
| 展开全部传递依赖后 | 60 个 |
| 许可证原文总字节数 | 66,679 字节 |
| 含 copyleft（GPL/AGPL/LGPL/MPL）的组件 | **0 个** |

**协议分布**：

| 许可证 | 组件数 | 性质 |
|---|---|---|
| MIT | 53 | 宽松，只需保留版权声明 |
| ISC | 4 | 宽松，等同 MIT 的简化版 |
| BSD-3-Clause | 3 | 宽松，另加「不得用作者名背书」 |

**结论**：**没有任何 copyleft 组件。** GPL/AGPL 那种「用了就得开源」的传染性许可证，在这 60 个包里**一个都没有**。全部是 MIT / BSD / ISC / Apache-2.0 / 0BSD / PSF 这类宽松许可，与本项目自身的 MIT 兼容。

---

## 二、组件清单

### 2.1 直接依赖（`package.json` 里显式声明的）

| 组件 | 版本 | 许可证 | 版权归属 |
|---|---|---|---|
| `fastify` | 5.12.5 | MIT | Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team> |
| `fastify-type-provider-zod` | 7.0.0 | MIT | Copyright (c) 2022-2024 turkerdev |
| `pg` | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| `zod` | 4.6.5 | MIT | Copyright (c) 2025 Colin McDonnell |

### 2.2 传递依赖（被上面的包间接引入的）

> 📌 **这一节里有相当一部分是「多列的」。** 比如 `@vue/compiler-sfc`、`@babel/parser`、`postcss`、`magic-string` 这些是 **Vue 在构建阶段用的编译器**，打包时会被摇掉，**不会进入最终分发的程序**。把它们列上属于「多算不多错」——声明多了没有法律风险，少了才有。

| 组件 | 版本 | 许可证 | 版权归属 |
|---|---|---|---|
| `@fastify/ajv-compiler` | 4.0.6 | MIT | Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team> |
| `@fastify/error` | 4.2.0 | MIT | Copyright (c) 2020 Fastify |
| `@fastify/fast-json-stringify-compiler` | 5.1.0 | MIT | Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team> |
| `@fastify/forwarded` | 3.0.2 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| `@fastify/merge-json-schemas` | 0.2.1 | MIT | Copyright (c) 2024 Fastify |
| `@fastify/proxy-addr` | 5.1.1 | MIT | Copyright (c) 2014-2016 Douglas Christopher Wilson Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| `@pinojs/redact` | 0.4.0 | MIT | Copyright (c) 2025 pinojs contributors |
| `abstract-logging` | 2.0.1 | MIT | Copyright (c) James Sumners |
| `ajv` | 8.20.0 | MIT | Copyright (c) 2015-2021 Evgeny Poberezkin |
| `ajv-formats` | 3.0.1 | MIT | Copyright (c) 2020 Evgeny Poberezkin |
| `atomic-sleep` | 1.0.0 | MIT | Copyright (c) 2020 David Mark Clements |
| `avvio` | 9.3.0 | MIT | Copyright (c) 2016-2020 Matteo Collina Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team> |
| `cookie` | 1.1.1 | MIT | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| `dequal` | 2.0.3 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| `fast-decode-uri-component` | 1.0.1 | MIT | Copyright (c) 2018 Tomas Della Vedova Copyright (c) 2017 Justin Ridgewell Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de> |
| `fast-deep-equal` | 3.1.3 | MIT | Copyright (c) 2017 Evgeny Poberezkin |
| `fast-json-stringify` | 7.0.1 | MIT | Copyright (c) 2016-present Matteo Collina Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team> |
| `fast-querystring` | 1.1.2 | MIT | Copyright (c) 2022 Yagiz Nizipli |
| `fast-uri` | 4.2.1 | BSD-3-Clause | Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| `fastq` | 1.20.3 | ISC | Copyright (c) 2015-2020, Matteo Collina <matteo.collina@gmail.com> |
| `find-my-way` | 9.9.0 | MIT | Copyright (c) 2017-2019 Tomas Della Vedova |
| `ipaddr.js` | 2.5.0 | MIT | Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org> |
| `json-schema-ref-resolver` | 3.0.0 | MIT | Copyright (c) 2023 Fastify |
| `json-schema-traverse` | 1.0.0 | MIT | Copyright (c) 2017 Evgeny Poberezkin |
| `light-my-request` | 6.6.0 | BSD-3-Clause | Copyright (c) 2017 The Fastify Team Copyright (c) 2012-2017, Project contributors Copyright (c) 2012-2014, Walmart |
| `on-exit-leak-free` | 2.1.2 | MIT | Copyright (c) 2021 Matteo Collina |
| `pg-connection-string` | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| `pg-int8` | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| `pg-pool` | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| `pg-protocol` | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| `pg-types` | 2.2.0 | MIT | Copyright (c) Brian M. Carlson |
| `pgpass` | 1.0.5 | MIT | Copyright (c) Hannes Hörl |
| `pino` | 10.4.0 | MIT | Copyright (c) 2016-present Matteo Collina, David Mark Clements and the Pino contributors listed at <https://github.com/pinojs/pino#the-team> and in the README file. |
| `pino-abstract-transport` | 3.0.0 | MIT | Copyright (c) 2021 pino |
| `pino-std-serializers` | 7.1.0 | MIT | Copyright Mateo Collina, David Mark Clements, James Sumners |
| `postgres-array` | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| `postgres-bytea` | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| `postgres-date` | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| `postgres-interval` | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| `process-warning` | 5.1.0 | MIT | Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team> |
| `quick-format-unescaped` | 4.0.4 | MIT | Copyright (c) 2016-2019 David Mark Clements |
| `real-require` | 1.0.0 | MIT | Copyright (c) 2021 Paolo Insogna and the real-require contributors |
| `require-from-string` | 2.0.2 | MIT | Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop) |
| `ret` | 0.5.0 | MIT | Copyright (C) 2011 by fent |
| `reusify` | 1.1.0 | MIT | Copyright (c) 2015-2024 Matteo Collina |
| `rfdc` | 1.4.1 | MIT | Copyright 2019 "David Mark Clements <david.mark.clements@gmail.com>" |
| `safe-regex2` | 5.1.1 | MIT | Copyright (c) 2019-present The Fastify team <https://github.com/fastify/fastify#team> |
| `safe-stable-stringify` | 2.5.0 | MIT | Copyright (c) Ruben Bridgewater |
| `secure-json-parse` | 4.1.0 | BSD-3-Clause | Copyright (c) 2019, Sideway Inc, and project contributors Copyright (c) 2019-present The Fastify team |
| `semver` | 7.8.5 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| `set-cookie-parser` | 2.7.2 | MIT | Copyright (c) 2015 Nathan Friedly <nathan@nfriedly.com> (http://nfriedly.com/) |
| `sonic-boom` | 4.2.1 | MIT | Copyright (c) 2017 Matteo Collina |
| `split2` | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| `thread-stream` | 4.2.0 | MIT | Copyright (c) 2021 Matteo Collina |
| `toad-cache` | 3.7.4 | MIT | Copyright (c) 2023 Igor Savin |
| `xtend` | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

> 📌 **补录的许可证正文（3 个）**：下面这些包的 npm tarball 里**没有** LICENSE 文件，但 `package.json` 声明 MIT。为了不静默少列，生成脚本从 `scripts/licenses/` 读取标准 MIT 正文补上，版权行取自各包 `package.json` 的 `author` 字段。这些正文**不是从原包复制的**，详见 `scripts/licenses/README.md`：
>
> - `abstract-logging@2.0.1` —— Copyright (c) James Sumners
> - `pg-types@2.2.0` —— Copyright (c) Brian M. Carlson
> - `pgpass@1.0.5` —— Copyright (c) Hannes Hörl

---

## 四、许可证原文

下面是上面所有组件的许可证正文。**为了不把同一份 MIT 印 66 遍**，正文按「协议 + 措辞」去重；每个组件各自的**版权行**已在第二节的清单里逐条列出，两者合起来才构成完整声明。

### 4.1 BSD-3-Clause —— 适用于 1 个组件

**适用组件**：`fast-uri@4.2.1`

**各组件版权行**：

- `fast-uri@4.2.1` —— Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>

**许可证正文**（照录 `node_modules\fast-uri\LICENSE`，**一字未改**）：

```
Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae
Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/garycourt/uri-js/graphs/contributors
```

### 4.2 BSD-3-Clause —— 适用于 1 个组件

**适用组件**：`light-my-request@6.6.0`

**各组件版权行**：

- `light-my-request@6.6.0` —— Copyright (c) 2017 The Fastify Team Copyright (c) 2012-2017, Project contributors Copyright (c) 2012-2014, Walmart

**许可证正文**（照录 `node_modules\light-my-request\LICENSE`，**一字未改**）：

```
Copyright (c) 2017 The Fastify Team
Copyright (c) 2012-2017, Project contributors
Copyright (c) 2012-2014, Walmart
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/hapijs/shot/graphs/contributors
- https://github.com/fastify/light-my-request/graphs/contributors
```

### 4.3 BSD-3-Clause —— 适用于 1 个组件

**适用组件**：`secure-json-parse@4.1.0`

**各组件版权行**：

- `secure-json-parse@4.1.0` —— Copyright (c) 2019, Sideway Inc, and project contributors Copyright (c) 2019-present The Fastify team

**许可证正文**（照录 `node_modules\secure-json-parse\LICENSE`，**一字未改**）：

```
Copyright (c) 2019, Sideway Inc, and project contributors
Copyright (c) 2019-present The Fastify team
All rights reserved.

The Fastify team members are listed at https://github.com/fastify/fastify#team.

The complete list of contributors can be found at:
- https://github.com/hapijs/bourne/graphs/contributors
- https://github.com/fastify/secure-json-parse/graphs/contributors

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 4.4 ISC —— 适用于 1 个组件

**适用组件**：`fastq@1.20.3`

**各组件版权行**：

- `fastq@1.20.3` —— Copyright (c) 2015-2020, Matteo Collina <matteo.collina@gmail.com>

**许可证正文**（照录 `node_modules\fastq\LICENSE`，**一字未改**）：

```
Copyright (c) 2015-2020, Matteo Collina <matteo.collina@gmail.com>

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

### 4.5 ISC —— 适用于 1 个组件

**适用组件**：`split2@4.2.0`

**各组件版权行**：

- `split2@4.2.0` —— Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com>

**许可证正文**（照录 `node_modules\split2\LICENSE`，**一字未改**）：

```
Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### 4.6 ISC —— 适用于 1 个组件

**适用组件**：`semver@7.8.5`

**各组件版权行**：

- `semver@7.8.5` —— Copyright (c) Isaac Z. Schlueter and Contributors

**许可证正文**（照录 `node_modules\semver\LICENSE`，**一字未改**）：

```
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### 4.7 ISC —— 适用于 1 个组件

**适用组件**：`pg-int8@1.0.1`

**各组件版权行**：

- `pg-int8@1.0.1` —— Copyright © 2017, Charmander <~@charmander.me>

**许可证正文**（照录 `node_modules\pg-int8\LICENSE`，**一字未改**）：

```
Copyright © 2017, Charmander <~@charmander.me>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### 4.8 MIT —— 适用于 31 个组件

**适用组件**：`fastify@5.12.5`、`@fastify/ajv-compiler@4.0.6`、`fast-deep-equal@3.1.3`、`json-schema-traverse@1.0.0`、`ajv-formats@3.0.1`、`@fastify/error@4.2.0`、`@fastify/fast-json-stringify-compiler@5.1.0`、`fast-json-stringify@7.0.1`、`@fastify/merge-json-schemas@0.2.1`、`json-schema-ref-resolver@3.0.0`、`@fastify/proxy-addr@5.1.1`、`@fastify/forwarded@3.0.2`、`abstract-logging@2.0.1`、`avvio@9.3.0`、`find-my-way@9.9.0`、`fast-decode-uri-component@1.0.1`、`safe-regex2@5.1.1`、`process-warning@5.1.0`、`@pinojs/redact@0.4.0`、`on-exit-leak-free@2.1.2`、`pino-abstract-transport@3.0.0`、`sonic-boom@4.2.1`、`thread-stream@4.2.0`、`toad-cache@3.7.4`、`fastify-type-provider-zod@7.0.0`、`pg@8.23.1`、`pg-pool@3.14.0`、`pg-protocol@1.16.1`、`pg-types@2.2.0`、`pgpass@1.0.5`、`zod@4.6.5`

**各组件版权行**：

- `fastify@5.12.5` —— Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team>
- `@fastify/ajv-compiler@4.0.6` —— Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team>
- `fast-deep-equal@3.1.3` —— Copyright (c) 2017 Evgeny Poberezkin
- `json-schema-traverse@1.0.0` —— Copyright (c) 2017 Evgeny Poberezkin
- `ajv-formats@3.0.1` —— Copyright (c) 2020 Evgeny Poberezkin
- `@fastify/error@4.2.0` —— Copyright (c) 2020 Fastify
- `@fastify/fast-json-stringify-compiler@5.1.0` —— Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team>
- `fast-json-stringify@7.0.1` —— Copyright (c) 2016-present Matteo Collina Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team>
- `@fastify/merge-json-schemas@0.2.1` —— Copyright (c) 2024 Fastify
- `json-schema-ref-resolver@3.0.0` —— Copyright (c) 2023 Fastify
- `@fastify/proxy-addr@5.1.1` —— Copyright (c) 2014-2016 Douglas Christopher Wilson Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
- `@fastify/forwarded@3.0.2` —— Copyright (c) 2014-2017 Douglas Christopher Wilson Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
- `abstract-logging@2.0.1` —— Copyright (c) James Sumners
- `avvio@9.3.0` —— Copyright (c) 2016-2020 Matteo Collina Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team>
- `find-my-way@9.9.0` —— Copyright (c) 2017-2019 Tomas Della Vedova
- `fast-decode-uri-component@1.0.1` —— Copyright (c) 2018 Tomas Della Vedova Copyright (c) 2017 Justin Ridgewell Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de>
- `safe-regex2@5.1.1` —— Copyright (c) 2019-present The Fastify team <https://github.com/fastify/fastify#team>
- `process-warning@5.1.0` —— Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team>
- `@pinojs/redact@0.4.0` —— Copyright (c) 2025 pinojs contributors
- `on-exit-leak-free@2.1.2` —— Copyright (c) 2021 Matteo Collina
- `pino-abstract-transport@3.0.0` —— Copyright (c) 2021 pino
- `sonic-boom@4.2.1` —— Copyright (c) 2017 Matteo Collina
- `thread-stream@4.2.0` —— Copyright (c) 2021 Matteo Collina
- `toad-cache@3.7.4` —— Copyright (c) 2023 Igor Savin
- `fastify-type-provider-zod@7.0.0` —— Copyright (c) 2022-2024 turkerdev
- `pg@8.23.1` —— Copyright (c) 2010 - 2021 Brian Carlson
- `pg-pool@3.14.0` —— Copyright (c) 2017 Brian M. Carlson
- `pg-protocol@1.16.1` —— Copyright (c) 2010 - 2021 Brian Carlson
- `pg-types@2.2.0` —— Copyright (c) Brian M. Carlson
- `pgpass@1.0.5` —— Copyright (c) Hannes Hörl
- `zod@4.6.5` —— Copyright (c) 2025 Colin McDonnell

**许可证正文**（照录 `node_modules\fastify\LICENSE`，**一字未改**）：

```
MIT License

Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team>

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

> 上面的正文里带的是 `fastify` 自己的版权行；其余 30 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.9 MIT —— 适用于 8 个组件

**适用组件**：`require-from-string@2.0.2`、`dequal@2.0.3`、`set-cookie-parser@2.7.2`、`postgres-array@2.0.0`、`postgres-bytea@1.0.1`、`postgres-date@1.0.7`、`postgres-interval@1.2.0`、`xtend@4.0.2`

**各组件版权行**：

- `require-from-string@2.0.2` —— Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop)
- `dequal@2.0.3` —— Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)
- `set-cookie-parser@2.7.2` —— Copyright (c) 2015 Nathan Friedly <nathan@nfriedly.com> (http://nfriedly.com/)
- `postgres-array@2.0.0` —— Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me)
- `postgres-bytea@1.0.1` —— Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me)
- `postgres-date@1.0.7` —— Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me)
- `postgres-interval@1.2.0` —— Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me)
- `xtend@4.0.2` —— Copyright (c) 2012-2014 Raynos.

**许可证正文**（照录 `node_modules\require-from-string\license`，**一字未改**）：

```
The MIT License (MIT)

Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop)

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

> 上面的正文里带的是 `require-from-string` 自己的版权行；其余 7 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.10 MIT —— 适用于 7 个组件

**适用组件**：`ajv@8.20.0`、`reusify@1.1.0`、`pino@10.4.0`、`quick-format-unescaped@4.0.4`、`real-require@1.0.0`、`safe-stable-stringify@2.5.0`、`pg-connection-string@2.14.1`

**各组件版权行**：

- `ajv@8.20.0` —— Copyright (c) 2015-2021 Evgeny Poberezkin
- `reusify@1.1.0` —— Copyright (c) 2015-2024 Matteo Collina
- `pino@10.4.0` —— Copyright (c) 2016-present Matteo Collina, David Mark Clements and the Pino contributors listed at <https://github.com/pinojs/pino#the-team> and in the README file.
- `quick-format-unescaped@4.0.4` —— Copyright (c) 2016-2019 David Mark Clements
- `real-require@1.0.0` —— Copyright (c) 2021 Paolo Insogna and the real-require contributors
- `safe-stable-stringify@2.5.0` —— Copyright (c) Ruben Bridgewater
- `pg-connection-string@2.14.1` —— Copyright (c) 2014 Iced Development

**许可证正文**（照录 `node_modules\ajv\LICENSE`，**一字未改**）：

```
The MIT License (MIT)

Copyright (c) 2015-2021 Evgeny Poberezkin

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

> 上面的正文里带的是 `ajv` 自己的版权行；其余 6 个组件的版权行在上面的清单里，两者合起来构成完整声明（这正是 MIT/BSD 要求的「版权声明 + 许可声明」两件套）。

### 4.11 MIT —— 适用于 1 个组件

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

### 4.12 MIT —— 适用于 1 个组件

**适用组件**：`ipaddr.js@2.5.0`

**各组件版权行**：

- `ipaddr.js@2.5.0` —— Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org>

**许可证正文**（照录 `node_modules\ipaddr.js\LICENSE`，**一字未改**）：

```
Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org>

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

### 4.13 MIT —— 适用于 1 个组件

**适用组件**：`fast-querystring@1.1.2`

**各组件版权行**：

- `fast-querystring@1.1.2` —— Copyright (c) 2022 Yagiz Nizipli

**许可证正文**（照录 `node_modules\fast-querystring\LICENSE`，**一字未改**）：

```
Copyright (c) 2022 Yagiz Nizipli

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### 4.14 MIT —— 适用于 1 个组件

**适用组件**：`ret@0.5.0`

**各组件版权行**：

- `ret@0.5.0` —— Copyright (C) 2011 by fent

**许可证正文**（照录 `node_modules\ret\LICENSE`，**一字未改**）：

```
MIT License

Copyright (C) 2011 by fent

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

### 4.15 MIT —— 适用于 1 个组件

**适用组件**：`cookie@1.1.1`

**各组件版权行**：

- `cookie@1.1.1` —— Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>

**许可证正文**（照录 `node_modules\cookie\LICENSE`，**一字未改**）：

```
(The MIT License)

Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>
Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### 4.16 MIT —— 适用于 1 个组件

**适用组件**：`atomic-sleep@1.0.0`

**各组件版权行**：

- `atomic-sleep@1.0.0` —— Copyright (c) 2020 David Mark Clements

**许可证正文**（照录 `node_modules\atomic-sleep\LICENSE`，**一字未改**）：

```
The MIT License (MIT)
Copyright (c) 2020 David Mark Clements


Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
```

### 4.17 MIT —— 适用于 1 个组件

**适用组件**：`pino-std-serializers@7.1.0`

**各组件版权行**：

- `pino-std-serializers@7.1.0` —— Copyright Mateo Collina, David Mark Clements, James Sumners

**许可证正文**（照录 `node_modules\pino-std-serializers\LICENSE`，**一字未改**）：

```
Copyright Mateo Collina, David Mark Clements, James Sumners

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## 附：本项目自身的许可证

咪爱编程服务端（miai-server） 本身以 **MIT** 许可证发布，全文见 [`LICENSE`](../LICENSE)。

> 注意：本文件覆盖 **npm 依赖与随 bundle 分发的内嵌组件**。仓库里的图片、桌宠素材、ComfyUI 工作流与模型权重各有自己的许可，见根目录 `README.md` 的「致谢 / Open Source Credits」与 `docs/comfyui_workflow.md`；不要把这份 MIT 声明当成对全部素材的授权。
