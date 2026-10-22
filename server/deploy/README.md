# miai 部署窗口手册（S7 部署件；本文件不含任何密钥）

本目录是部署件的**仓库副本**；现场执行以 `/opt/miai/` 下的文件为准（每个文件头都写了同一句话）。
前提 = 服务器线已实测完成的状态（S0~S6）：docker 已装、ufw 只放行 22/80/443、db 与 caddy 两个实测容器在跑、
证书已签发、**处于 B2 续期观察期**（观察达标前 caddy 冻结，见步骤 1）。

## 文件对照表

| 仓库内 | 现场落点 | 说明 |
|---|---|---|
| `server/Dockerfile` / `server/.dockerignore` | 随发布包 `releases/<sha>/server/` | 不单独安装；构建上下文就是它 |
| `server/deploy/compose.yml` | `/opt/miai/compose.yml` | 三件套定义；改名即正式文件 |
| `server/deploy/deploy.sh` | `/opt/miai/bin/deploy.sh`（`chmod 700`） | 手动执行；按自身位置找 backup.sh |
| `server/deploy/backup.sh` | `/opt/miai/bin/backup.sh`（`chmod 700`） | cron 00:17（北京时间） |
| `server/deploy/healthcheck.sh` | `/opt/miai/bin/healthcheck.sh`（`chmod 700`） | cron 每 5 分钟 |
| `server/deploy/monitor-mail.sh` | `/opt/miai/bin/monitor-mail.sh`（`chmod 700`） | cron 每 5 分钟（3 分起错峰）；健康失败发邮件（方案B） |
| `server/deploy/monitor-mail.env.example` | `/opt/miai/bin/monitor-mail.env`（`chmod 600`；模板拷贝，授权码主人自填） | 方案B SMTP 凭据（本仓不含真凭据） |
| `server/deploy/roles.sql` | `/opt/miai/deploy/roles.sql` | 建双角色模板（口令占位符现场替换） |
| `server/deploy/Caddyfile` | `/opt/miai/conf/Caddyfile`（先备份旧文件） | 正式版：占位 respond 已删、reverse_proxy 启用 |
| `server/deploy/selfcheck.mjs` | 不需要上服务器 | 仓库侧自检：`node server/deploy/selfcheck.mjs` |

**发布包怎么打**（在仓库根目录执行，必须带 `server/` 前缀）：
`git archive --format=tar.gz -o miai-server-<sha>.tgz <sha> -- server`
—— `HEAD:server` 变体产出无前缀条目、会断 `releases/<sha>/server` 布局，禁用。

## 六步顺序（每步：动作 → 判据 → 失败回滚）

### 步骤 1 前置核查（只读，不动作）
- **B2 证书续期观察已达标**（服务器线口径，见交接文档）。未达标 ⇒ 一切 caddy 相关动作停（冻结）。
- 网段比对：`docker network inspect miai_default` 看现役实占段（2026-10-12 实测 = `172.18.0.0/16`）。
  `.env` 的 `TRUST_PROXY_CIDR` 必须与它逐字一致（deploy.sh 0d 闸门会自动对账）。
  **注意**：`compose.yml` 故意**不写** networks 的 ipam——E3b 实测：声明 ipam 会让计划先停 db 再重建网络
  （现役网络是 S4 按空定义创建的，定义不匹配就重建）；「不重建网络」才是网段稳定的真正保证。
- 发布包带前缀自证：`tar -tzf miai-server-<sha>.tgz | head` 必须看到 `server/package.json`。
- **判据**：三条都过。**回滚**：无（本步不动任何东西）。

### 步骤 2 装文件与 .env
- 上服务器：`compose.yml` → `/opt/miai/`；三个脚本 → `/opt/miai/bin/`（`chmod 700`）；`roles.sql` → `/opt/miai/deploy/`。
- `.env` 补齐：`SERVER_IP=<公网IP>`、`TRUST_PROXY_CIDR=172.18.0.0/16`（与 compose 逐字一致，deploy.sh 会校验）；
  确认 `POSTGRES_PASSWORD` / `DATABASE_URL`（miai_app 版）/ `MIGRATION_DATABASE_URL`（miai_owner 版）都在。
  `SERVER_IP` / `TRUST_PROXY_CIDR` 是部署侧键（`.env.example` 已补示例）；`NODE_ENV` 与 `HOST` 由 compose 注入，`.env` 里写不写都不影响 api 行为。
- Caddyfile 先备份：`cp conf/Caddyfile conf/Caddyfile.bak-$(date +%F)`（`conf/` 相对 `/opt/miai`）。
- **判据**：`ls -la /opt/miai/.env` 权限 `-rw-------`；上述键都在。
- **回滚**：无（不动服务）。

### 步骤 3 起 db 并建角色（**先建角色 → 后跑迁移**）
- `docker compose up -d db`（已在跑则 no-op；等 `docker compose ps` 显示 healthy）。
- 把 `roles.sql` 里两处 `<现场生成>` 换成随机强口令（`openssl rand -hex 24`——hex 零 URL 转义坑；
  base64 的 `+` `/` `=` 进连接串必须百分号编码），与 `.env` 两条连接串逐字一致；然后：
  `docker compose exec -T db psql -U miai -d miai -v ON_ERROR_STOP=1 < deploy/roles.sql`
- **判据**：脚本末自带自证查询输出 `roles_ready = 2`；输出别的数 = 有角色没建成。
- **红线**：角色没建成**禁止跑迁移**——0001~0006 里的真 GRANT 都是守卫式（角色不存在就静默跳过）；
  0007 起新增迁移无真 GRANT（注释声明「无需补」），角色先建一次即覆盖全链；
  顺序规格 = `server/test/integration/grants-real-pg.test.ts:40-56`（已在真 PG 上跑绿）。
- **回滚**：修 SQL 重跑（幂等，撞重名被 EXCEPTION 吞掉）。

### 步骤 4 Caddyfile 并入并切换 caddy（前提：步骤 1 的 B2 已达标）
- 用本目录的正式版 `Caddyfile` **覆盖** `conf/Caddyfile`（版本里已删占位 respond 行、启用 `reverse_proxy api:8787` 块；
  `default_sni`、`profile shortlived`、全局 `servers { protocols h1 h2 }` 逐字保留）。
- 主路径：`docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile`
  —— **原子 reload、不重建容器**：容器不重建就不动 ACME 账号与证书（LE 配额零风险）。
  `docker compose up -d caddy` 仅作兜底（compose 定义没变时是 no-op；注意 up -d 本身不会把新 Caddyfile
  读进已运行的容器，reload 才是生效那一步）。
- **判据**：`curl -s https://<IP>/` 的响应体不再是 `miai tls test ok`；此时 api 未起，
  `curl -s -o /dev/null -w '%{http_code}' https://<IP>/v1/health` 得到 502 也算「已反代」。
- **回滚**：`cp conf/Caddyfile.bak-<日期> conf/Caddyfile && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile`；
  证书在 `caddy_data` 卷里，配置回退不影响已签发证书。

### 步骤 5 跑 deploy.sh（构建 → 迁移 → 起 api → 10 次探针）
- `./bin/deploy.sh /opt/miai/miai-server-<sha>.tgz <sha>`
- **判据**：脚本输出 `部署完成：<sha>（health N/10）`（N≥5）；`https://<IP>/v1/health` 返回 JSON 的 `"ok":true`；
  `schemaVer` = 当前迁移集最大版本（deploy.sh 会从本次解包的 `migrations/` 现算期望值并打印，
  与发布记录比对——不一致 = 可能部署了旧版本）。
- **回滚**：探针 <5 时脚本自动写回旧 `API_TAG` 并 `up -d api`；**首次部署无旧 tag ⇒ 不自动回滚，保持现状人工处置**
  （db 数据未动——迁移只增不改）。构建或迁移中途失败 ⇒ 脚本中止，线上容器未动。
- 若从服务器访问自己公网 IP 全红（NAT 型网络误判）：先手工 `curl https://<IP>/v1/health` 验证；
  备用探针用 `--resolve` 形态：`curl -k --resolve <IP>:443:127.0.0.1 https://<IP>/v1/health`
  （连接端走本机、Host/SNI 保持公网 IP；healthcheck.sh 就是这种写法）。
  **绝不要用 `-k https://127.0.0.1` 裸写法**——2026-10-12 双实验实测：Caddy 站点块按 Host 匹配（站点=IP 字面量），
  Host=127.0.0.1 不匹配 ⇒ 不进反向代理，被 Caddy fallback 以「200 空体」接走（`default_sni` 只补 SNI、不管 Host）。
  实测对照：裸写法 200 空体 vs `--resolve` 写法 502（=已正确进入反代路由）。

### 步骤 6 收尾（cron + 演练 + 24h 判据）
- 装 cron（ubuntu 用户；`docker` 组已在）。**现场版（2026-10-12 实装）= 仓库文件 `server/deploy/miai.crontab`，
  与服务器 `crontab -l` 逐字相等（`diff` 空 + sha256 `b455a437…`；21:14 加装方案B 第 5 条后重对账）；
  装法：把它 scp 上去，`crontab <该文件>`**：
  ```
  5 0 * * * cd /opt/miai && docker compose run --rm --no-deps -T api node dist/jobs/daily.js >> /var/log/miai-daily.log 2>&1
  17 0 * * * /opt/miai/bin/backup.sh >> /var/log/miai-backup.log 2>&1
  */5 * * * * /opt/miai/bin/healthcheck.sh >> /var/log/miai-health.log 2>&1
  3-58/5 * * * * /opt/miai/bin/monitor-mail.sh >> /var/log/miai-monitor.log 2>&1
  7 * * * * /usr/bin/docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' | sort >> /opt/miai/stats.log 2>&1
  ```
  （宿主机时区为 Asia/Shanghai，cron 时:分即北京时间；daily 00:05 与 backup 00:17 是刻意的错峰——
  日榜在北京 0 点后立刻铸「刚结束的一天」；daily 用 `--no-deps` 不碰 db 容器；monitor-mail 3 分起
  与 healthcheck 的 0/5 分错开；最后一条是 24h 观察窗的资源水位记录，写 `/opt/miai/stats.log`——`/var/log` 要 sudo，cron 里别用。）
- **`-T` 的实测口径（2026-10-12）**：cron 无 tty。用 `env -i HOME=/home/ubuntu PATH=/usr/bin:/bin /bin/sh -c ...`
  模拟 cron 环境实测，**带 `-T` 与不带 `-T` 都退出 0**（本机 compose 在无 tty 时会自动降级）。
  `-T` 仍显式保留：不依赖 compose 的自动探测（旧版本在非 tty 下会报 `the input device is not a TTY`），
  且 `backup.sh` 里的 `exec -T` 同理。**四条 cron 的日志文件必须先备好**（`touch` + `chown ubuntu`），
  否则 ubuntu 的 cron 重定向会在 `/var/log` 撞 Permission denied。
- 备份真恢复演练（种坏值）：**不覆盖真库**——建一张 dump 里不可能有的标记表 → 立刻做新 dump →
  还原进临时库 → 断言：临时库无标记表（真库有）/ `schema_migrations` 行数两边相等 /
  **全表逐表行数一致** → 删标记表、删临时库。2026-10-12 首跑：12 张表全等、`pg_restore` 退出码 0。
  （不覆盖真库的理由：对备份可信度的证明力相同，但不给线上库引入任何风险；
  真·灾备的「drop 后重建」路径另在上线后窗口按需演练。）
- 负例三连：`docker compose stop api` 后 healthcheck 必须变红 → `up -d api` 恢复绿；邻居 IP 连不上；5432 从外网连不上。
  2026-10-12 实测：停 api 后 healthcheck `FAIL health` 退出码 1、经 caddy 的探针 502；`up -d api` 后 8s 内 healthy、退出码 0；
  全程 db/caddy 的 `StartedAt` 逐字未变（=没碰 PG、没重建 caddy）。
  外网面判据看**服务器侧**：`sudo ss -tlnp` 的非 loopback 监听只应有 22/80/443，外加 D1 的 tcpdump 差分见证
  （同窗口同工具，curl 打 80/443 的 SYN 能被见证到 ⇒ 打 5432/8787/9999 的零包可归因于端口本身，不是探针被本地吞掉）。
- **上线判据**（docs/22 §6.4）：主人电脑连续 24h 通过 `https://<IP>/v1/health` 得 200，且期间首次自动续期成功。

### 方案B：失联自检邮件（monitor-mail；2026-10-12 21:14 加装，独立于部署窗口）
- 判据与 healthcheck.sh ① 同款（`--resolve` + 响应体含 `"ok":true`）。失败 → 发邮件到主人 163 邮箱；
  **状态翻转或距上次成功告警 ≥6h 才发**（恢复发「已恢复」）；**发信失败不记账**（last_alert 保持）⇒ 凭据未填期
  每轮重试但只是日志行（mail-skip），不会刷屏。**反封 IP 退避（2026-10-12 晚改进版）**：发信真尝试失败后
  ≥30min 内不再尝试（防 163「认证失败次数过多禁 IP」；退信码 554 smtp auth error limit exceed）；凭据未配的
  skip 不算尝试、零成本照常重试。state 三行 `status=/last_alert=/last_attempt=`（旧两行格式兼容）。
- 落装动作：`monitor-mail.sh`（700）+ `monitor-mail.env`（600，模板=env.example 拷贝）→ `/opt/miai/bin/`；
  `sudo mkdir /var/lib/miai-monitor`（chown ubuntu，状态目录）；`sudo touch /var/log/miai-monitor.log`
  （chown ubuntu——日志预建纪律）；`crontab miai.crontab`（装后 `crontab -l | diff` 逐字相等）。
- **凭据（主人一步）**：登录 163 网页版开「SMTP 服务」取授权码 → `nano /opt/miai/bin/monitor-mail.env`
  填 `SMTP_AUTH` → `/opt/miai/bin/monitor-mail.sh --test-mail` 见 `mail-sent` 且邮箱有信 = 通道通。
  授权码只存在于服务器那个 600 文件；仓库/聊天/日志里没有。
- 落装实测（2026-10-12，全过）：真环境健康跑 `ok health` rc=0 / state=ok；种坏夹具
  （`SERVER_IP=127.0.0.1` → Caddy fallback 实测 `http=200, body-bytes=0`）→ 判 `fail` rc=1 且 mail-skip；
  占位符 `--test-mail` → FAILED rc=1；假授权码打 `smtps://smtp.163.com:465` → `curl: (67) Login denied`
  （= DNS/TLS/SMTP 全通，只差真授权码）。本机隔离测试台 **35/35**（新增 T8~T10 退避三态；
  `_miai-server-ops/test-monitor/`，curl/flock 垫片；种坏两连先见红：T8×3、T10×1）。
- **改进版替换（2026-10-12 晚，B2 观察窗内零重启）**：新 sha `e057abf6…`（sh）/ `b6e5d777…`（env 模板），
  crontab 未动（仍 `b455a437…`）；备份 `~/monitor-mail.sh.bak-pre-attempt-20261012` +
  `~/monitor-mail.env.bak-pre-attempt-20261012`；staged 上传 → `mv` 原子替换 → sha 三方对账全等；
  冒烟三连全过（真环境 + 隔离夹具三态，原始读数在 `_miai-server-ops/results/方案B落装-20261012.md` §五）。
- **局限（如实）**：整机断电/断网时本脚本不会被运行——「整机失联」由腾讯云控制台侧监控/拨测（方案A）兜底；
  本脚本兜「主机活着、应用层坏了」。

## 红线（每一条都来自已实测的坑）
- api/db **永不发布宿主端口**（compose 里写死：api 只有 `expose`）；`ports:` 只允许出现在 caddy。
- **HOST 必须 0.0.0.0**（compose 注入）——`config.ts` 默认 127.0.0.1 = 容器内回环 = Caddy 必 502。
- **绝不裸跑 `docker compose up -d`**（会连带重建 caddy）；**`docker compose down` / `down -v` 全线禁止**
  （卷里有用户数据与证书）。一律点名服务 `up -d db|api|caddy`。
- **up 前必看计划**（E3b 教训）：`docker compose up -d --dry-run api` 的计划里不许出现 `Network ... Removing`
  或 `Container miai-db-1 Stopping` 这类行（＝compose 要重建网络并先停 db）；deploy.sh 已内置该闸门（4b 步）。
- 凭据一律在 `/opt/miai/.env`（chmod 600）；脚本、compose、文档、镜像里都不含口令。
- 迁移一律 `dist/db/migrate.js`（显式执行），**绝不**放进应用启动路径；生产缺 `MIGRATION_DATABASE_URL` 直接拒启。

## 与现场的关系 / 待办
- 现场改动必须带回仓库副本（本目录）：下个窗口先 diff；冲突时以现场为准执行，再把差异带回仓库，绝不用仓库版本直接覆盖现场。
- 待办：
  - ✅ 已办（2026-10-12）：`server/.env.example` 已补 8 个 `RATE_LIMIT_*` 覆盖键（`CHALLENGE_PER_DAY` / `RICE_PUSH_PER_HOUR` /
    `RICE_ENTRIES_PER_PUSH` / `RICE_ENTRIES_PER_DAY` / `AVATAR_PER_HOUR` / `PASSWORD_CHANGE_PER_DAY` / `DELETE_ACCOUNT_PER_DAY` /
    `DOCS_WRITE_PER_HOUR`）与 `SERVER_IP` / `TRUST_PROXY_CIDR` 示例。
  - ✅ 已办（2026-10-12）：镜像基已定稿 bookworm-slim（见 `server/Dockerfile` 头注【已定稿】）。
  - 保留：`server/README.md` 的手册全文（docs/22 §6.4 承诺「全文随 server/README.md 落地」）——归文档回填批（D 批）。
