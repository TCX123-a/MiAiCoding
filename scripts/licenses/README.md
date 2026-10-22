# 补录的许可证正文

`scripts/gen-third-party-notices.mjs` 只从 `node_modules/<包>/` 根目录读取 `LICENSE` / `COPYING` 文件。下面三个服务端依赖的 npm tarball **没有附许可证文件**，但 `package.json` 明确声明 MIT，并给出了作者：

| 包 | 版本 | 作者 | 来源 |
| --- | --- | --- | --- |
| `abstract-logging` | 2.0.1 | James Sumners | <https://github.com/jsumners/abstract-logging> |
| `pg-types` | 2.2.0 | Brian M. Carlson | <https://github.com/brianc/node-pg-types> |
| `pgpass` | 1.0.5 | Hannes Hörl | <https://github.com/hoegaarden/pgpass> |

为了不让 `THIRD-PARTY-NOTICES.md` 静默少列这三个包，`gen-third-party-notices.mjs` 在找不到 LICENSE 文件时读取本目录下的标准 MIT 正文（版权行取自各包 `package.json` 的 `author` 字段），并在声明里标注「补录」。这不是从原包复制的文件，而是标准 MIT 模板；如果上游之后补上了 LICENSE，生成脚本会优先使用上游文件。

> 维护：新增补录时，文件名用 `<包名>-MIT.txt`，并同步 `scripts/gen-third-party-notices.mjs` 里的 `LICENSE_FALLBACKS`。
