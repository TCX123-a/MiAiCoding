# LICENSES

这个目录存放**不能只靠 `THIRD-PARTY-NOTICES.md` 一段摘要说清**的第三方许可证原文。

| 文件 | 覆盖对象 | 为什么单独放 |
|---|---|---|
| `MPL-2.0.txt` | Mediabunny 1.56.0（内嵌在 `webwallgl@2.1.0` 的 bundle 里） | MPL-2.0 是文件级 copyleft：分发可执行形式时必须随附许可证原文，并告知 Source Code Form 的获取途径。原文较长，单独成文件便于逐字节核对。 |

## Source Code Form（MPL-2.0 §3.2）

Mediabunny 的 Source Code Form 可从以下任一途径获取：

- 上游仓库：<https://github.com/Vanilagy/mediabunny>（`v1.56.0` 标签）
- npm 包：`mediabunny@1.56.0`

本项目**没有修改** Mediabunny 的源码；它由 `webwallgl@2.1.0` 的发行版 bundle 带入。
`webwallgl` 自身的许可证是 MIT（见 `node_modules/webwallgl/LICENSE` 与
`THIRD-PARTY-NOTICES.md`）。

## 其它第三方材料

模型权重、LoRA、字体、桌宠素材、社区图片等**不在本目录**，也不适用本项目的 MIT 许可；
逐项条款见根目录 [`THIRD-PARTY-CODE-NOTICES.md`](../THIRD-PARTY-CODE-NOTICES.md) 与
[`README.md`](../README.md) 的「许可证边界」。
