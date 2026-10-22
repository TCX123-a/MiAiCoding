# miai-server（咪爱编程自建后端，P10.2 全量）

咪爱编程自建后端的第一版骨架：账号体系（注册/登录/会话）+ 四份用户文档的云同步
（profile / wrongbook / favorites / practice）。对应协议契约 = `docs/22`（§3.4 端点、§3.5 错误码、
§4.2 表结构、§4.3 CAS、§4.4 体积门、§5 安全）。

**当前状态：已部署**（S7，2026-10-12：生产健康检查 ok；部署与运维细节见服务器侧工作区，不随仓库分发）。本目录只保证本机跑通（typecheck / 测试 / 构建全绿）；部署动作由服务器侧工作流单独进行，本目录不含任何部署脚本。

## 环境要求

- Node ≥ 24（密码哈希用的是 Node 24 内置 `crypto.argon2`，无第三方原生模块）
- 数据库：PostgreSQL（生产）；本机开发/测试默认不需要装 PG——集成测试走
  `@electric-sql/pglite`（WASM 版真 PostgreSQL，内存库），DAO 层用最小
  `Queryable{query(text,params)}` 形状统一了 `pg.Pool` 与 PGlite 两条路（见 `src/db/pool.ts`）。
- **真 PG 双轨（可选但推荐）**：本机可备一个 PG18 沙箱（仓库兄弟目录 `../_pg18local`，127.0.0.1:54329），
  设置 `MIAI_TEST_PG=postgres://postgres@127.0.0.1:54329/postgres` 后整套集成测试在真 PG 上再跑一遍
  （`npm run test:pg`，自动落默认地址）：每个测试文件建独立临时库 `miai_t_<12hex>`、跑全量迁移、
  close 时 DROP（FORCE）。**沙箱是可选前置**：没有它时只跑 PGlite 轨（`npm test`），
  `npm run test:pg`（真 PG 轨）会直接红（拉起后再跑，不顺手清理）。
  **MIAI_TEST_PG 设置后连不上 = 直接红，绝不静默回退 PGlite**
  （防「真 PG 轨道全绿」变成没发生过的证词；显式空串同样是配置错误，当场炸）。
  两种轨道都要绿才算跑通。例外（固定跑 PGlite、不随后端切换）：`grants.test.ts` /
  `migrate.test.ts`（迁移 runner 的边界用例都是 PGlite 专属形态）；GRANT 的真 PG 专项
  由 `grants-real-pg.test.ts` 承担。

## 常用命令

```bash
npm install            # 装依赖（npmmirror 亦可）
npm run typecheck      # tsc 全量类型检查（strict）
npm test               # vitest 全量（单元 + PGlite 集成）
npm run test:pg        # 真 PG 双轨（需 ../_pg18local 的 PG18 在跑；可加 vitest 过滤参数）
npm run build          # 产出 dist/（node dist/server.js 可启动）
npm run migrate        # 显式执行迁移（tsx 源码直跑；需要真实 DATABASE_URL）
npm run migrate:built  # dist 构建产物执行迁移
npm run dev            # 开发热重启
```

## 环境变量（见 `.env.example`）

| 键 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | 应用连接串（生产用 `miai_app` 角色：只有四表 DML，无 DDL） |
| `MIGRATION_DATABASE_URL` | 生产必填 | 迁移专用连接串（`miai_owner` 角色）；与 `DATABASE_URL` 相同会拒绝启动 |
| `HOST` / `PORT` | 否 | 默认 `127.0.0.1:8787`（生产由反代 Caddy 转发） |
| `NODE_ENV` | 否 | `development` / `test` / `production` |
| `LOG_LEVEL` | 否 | 默认 `info` |
| `TRUST_PROXY_CIDR` | 否 | 未设置 = 不信任 `X-Forwarded-For`（直连部署）；Caddy 场景填反代网段 |
| `RATE_LIMIT_*` | 否 | 限流覆写（默认值即 docs/22 §5.4；非法值拒绝启动） |

无任何 JWT / 签名 / pepper 类密钥：令牌是**不透明随机串**（32B CSPRNG → `ms1_` + base64url），
服务端只存 sha256，不存原文。

## 已实现端点（/v1）

24 条路径 / 27 个操作、九个路由模块（`src/app.ts` 注册序：health / auth / me / sync / challenge / rice /
leaderboard / avatar / openapi）；字段级契约以 `openapi.json` 为准。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/health` | 存活 + schemaVer（限流例外；DB 挂了也返回 200） |
| GET | `/v1/meta` | apiVersion / protocol current+floor / capabilities |
| POST | `/v1/auth/register` | 201 自动登录；限流 5/时/IP + 50/日全局 |
| POST | `/v1/auth/login` | 200；未知账号与密码错统一 401（防枚举 + 等价计时） |
| POST | `/v1/auth/logout` | 204 幂等（失效/伪造令牌同样 204；不走鉴权中间件） |
| POST | `/v1/auth/logout-all` | 全设备登出：吊销该账号全部会话（含当前），204 |
| GET | `/v1/auth/sessions` | 设备列表（未吊销且未过期；标记 current） |
| POST | `/v1/auth/change-password` | 验旧密 → 换 hash → 吊销其余会话；5 次/日/账号 |
| POST | `/v1/auth/delete-account` | 注销（幂等）：级联删数据；会话留 24h 墓碑，重试仍 204 |
| POST | `/v1/auth/recover/question` | 找回链①：账号 → 安全问题；账号不存在如实 404，存量无问答账号返回 `NO_SECURITY_QUESTION` |
| POST | `/v1/auth/recover/verify` | 找回链②：当场校验答案（与 reset 共用退避记账），返回 `{verified}` |
| POST | `/v1/auth/recover/reset` | 找回链③：答案再核 + 新密码策略 → 换哈希、吊销全部会话、审计；不自动发令牌 |
| GET | `/v1/auth/session` | 会话有效 + 账号信息（鉴权中间件证据出，不再查库） |
| GET | `/v1/me/summary` | 个人摘要（学习统计 / 总积分 / 名次 / opt-in；`?dateKey=` 可查 ±1 天，北京时间日差补偿） |
| PUT | `/v1/me/username` | 改名：共用 `USERNAME_RE` + 违禁词判定；重名 409；与当前名相同幂等成功；写审计 |
| PUT | `/v1/me/leaderboard-opt-in` | 榜面曝光开关：`{optIn}` 幂等 UPDATE（2026-10-10 A4 裁定，唯一写口） |
| GET | `/v1/docs` | 四文档摘要（不含 payload） |
| GET | `/v1/docs/:docType` | 全文 + `ETag: "revision"`（`If-None-Match` → 304） |
| PUT | `/v1/docs/:docType` | CAS 条件写：`{docVer, baseRevision, payload}`；409 回带当前 revision/docVer |
| POST | `/v1/challenge/days` | 挑战结算：逐题事实进、服务端唯一算分；幂等 submissionId，同日异内容 409；可带 `pickedLangs`（开赛勾选，缺省按题批派生）；结算窗 过去 ≤30 天 / 未来 ≤+1 天 |
| GET | `/v1/challenge/days` | 挑战历史：`?from&to&limit(≤90)` 每日汇总（含 `pickedLangs`；缺省至多含明日一档，吸收客户端日差；只给 `to` 时窗口以 `to` 收尾，供历史翻页） |
| GET | `/v1/leaderboard` | 排行榜：快照/实算双路径 + lang/difficulty 过滤；`langs` = 榜期内开赛勾选语言的并集（2026-10-10 夜口径） |
| POST | `/v1/rice/entries` | 大白饭流水批量幂等上行（逐条处置恒 200；同键异内容 409） |
| GET | `/v1/rice/entries` | 大白饭流水 seq 增量下行 + 余额快照 |
| PUT | `/v1/avatar` | 头像上传：image/png ≤512KB（原始字节解析 + PNG magic 校验） |
| GET | `/v1/avatar/:hash` | 头像读取（内容寻址；任意未封禁账号可读） |
| GET | `/v1/openapi.json` | OpenAPI 文档（与快照闸门对照） |

错误体统一 `{"error":{"code","message","retryAfterMs?","details?","requestId"}}`（19 个错误码见 `src/lib/errors.ts`）。

## 安全口径（对应 docs/22 §5）

- **全参数化 SQL**：任何用户输入不进 SQL 字符串（含迁移 runner）。
- **密码**：argon2id（m=19456KiB, t=2, p=1）；最短 12 最长 128；离线弱密码黑名单 + 用户名子串检查；
  响应文案不区分失败细节。哈希并发闸：2 并发 + 16 排队，溢出快速 503。
- **令牌**：`ms1_` + base64url(randomBytes(32))（43 字符，256 位熵）；服务端只存 sha256 hex，
  验证走唯一索引等值查找（无签名密钥）；`timingSafeEqualHex` 仅供工具/测试，不在验证路径
  （安全审查 F6：更正原「时序安全路径」失实表述——存的是随机数的哈希，时序噪声不缩短猜解空间）。
- **日志脱敏**（`src/logger.ts`，生产与测试共用同一份配置）：Authorization / Cookie / set-cookie /
  password / token 一律 `[REDACTED]`（有单测含负对照）。
- **限流**：进程内令牌桶（注册 IP/全局、登录 IP、全 API 每账号或 IP）；每用户名 5 连败 → 60s×2ⁿ
  指数退避（上限 15min，**永不硬锁死**，成功即清零）；IPv6 按 /64 聚合。

## 迁移纪律（docs/22 §4.7）

- `migrations/NNNN_name.sql` 只增不改；`schema_migrations` 记路径 + sha256，文件被改动 → 拒绝执行。
- 迁移**绝不挂在应用启动路径**上：`npm run migrate` 显式执行（advisory lock 防并发，逐文件事务）。
- 双角色：`miai_owner` 建表/迁移，`miai_app` 仅四表 DML（GRANT 在迁移里按角色存在与否守卫执行）。

## 尚未实现（登记，勿当遗漏）

- 审计日志合并抑制（同一秒重复 login_fail 折叠）未做。

> 2026-10-10 更正：本表曾把 logout-all / 会话列表 / 改密码 / 删账号 / 头像上传 5 个端点
> 登记为「未实现」，并称协议真源「尚未创建」——两条均已过期（全部已实现并注册，见上表；
> 真源 `src/shared/cloud/protocol.ts` 已是唯一真源），删除旧表述。

## 目录结构

```
src/
  app.ts          # fastify 组装（可注入 db/clock/limits，测试全链路走这里）
  server.ts       # 进程入口：env → pool → listen → SIGINT/SIGTERM 收尾
  config.ts       # env 校验（缺必填项启动即失败）
  logger.ts       # 日志脱敏配置（生产/测试共用）
  protocol.ts     # 协议常量（= 客户端 protocol.ts 的逐字节副本；protocol-sync.mjs 同步）
  lib/            # errors / token / password / password-policy / audit / util
  db/             # pool（Queryable 形状）/ migrate（手写 runner）
  plugins/        # error-handler / auth / rate-limit / shared
  routes/         # health / auth / me / sync / challenge / rice / leaderboard / avatar / openapi / schemas
migrations/       # 0001_init.sql（五表 + 索引 + GRANT）
test/             # unit/（纯函数与限流）+ integration/（PGlite / 真 PG 双轨全链路，helpers/db.ts 双后端）
```
