#!/usr/bin/env bash
# deploy.sh —— miai 发布/更新（骨架源自 D4-deploy.md §8，已按服务器线实测修正；docs/22 §6.5 口径）。
# 安装位置：/opt/miai/bin/deploy.sh（chmod 700）。不进 cron，手动执行。
# 用法：deploy.sh <tgz> <sha>
#
# 发布包在仓库根目录打，必须带 server/ 前缀（实测：git archive HEAD server 的 102 项全部带前缀）：
#   git archive --format=tar.gz -o miai-server-<sha>.tgz <sha> -- server
#   禁止 HEAD:server 变体——它产出的条目没有 server/ 前缀，会断掉 releases/<sha>/server 布局。
#   scp miai-server-<sha>.tgz ubuntu@<IP>:/opt/miai/
#   服务器上：./bin/deploy.sh /opt/miai/miai-server-<sha>.tgz <sha>
#
# 流程：前置闸门 → 预更新备份 → 解包 + 换 current 软链 → 构建镜像 → 写新 API_TAG →
#       迁移（失败即中止，线上容器不动）→ up -d api → /v1/health 连测 10 次（≥5 次成功）→
#       失败写回旧 API_TAG 回滚 → 清理 168 小时前的旧镜像（回滚窗口要靠它）。
# 凭据：一律经 /opt/miai/.env 与 docker compose 读取；本脚本只读键名与非机密值，不写、不 echo 任何口令。
set -euo pipefail

BASE="${MIAI_HOME:-/opt/miai}"
cd "$BASE"

TGZ="${1:?用法: deploy.sh <tgz> <sha>}"
SHA="${2:?用法: deploy.sh <tgz> <sha>}"
[ -f "$TGZ" ] || { echo "拒绝执行：找不到发布包 $TGZ" >&2; exit 1; }
case "$SHA" in
  *[!A-Za-z0-9._-]*) echo "拒绝执行：sha 含非法字符：$SHA" >&2; exit 1 ;;
esac

# ── 0) 前置闸门（只读检查；任何一条不满足都不碰线上） ──────────────────────────
[ -f compose.yml ] || { echo "拒绝执行：$BASE/compose.yml 不存在" >&2; exit 1; }
[ -f .env ] || { echo "拒绝执行：$BASE/.env 不存在" >&2; exit 1; }

# 0a) caddy 必须已并入正式配置（占位 respond 已删、reverse_proxy 已启用）。
#     否则公网探针打不到 api：实测期占位 respond 恒回 200 文本，是经典假绿源（步骤 6 的判据还查响应体，双保险）。
[ -f conf/Caddyfile ] || { echo "拒绝执行：$BASE/conf/Caddyfile 不存在（现场布局与模板假设不一致）" >&2; exit 1; }
if grep -q 'respond "miai tls test ok"' conf/Caddyfile; then
  echo "拒绝执行：Caddyfile 仍是实测期占位 respond（B2 观察期未达标或尚未并入，见 deploy/README.md 步骤 4）" >&2
  exit 1
fi
grep -qE '^[[:space:]]*reverse_proxy api:8787' conf/Caddyfile \
  || { echo "拒绝执行：Caddyfile 里没有启用状态的 reverse_proxy api:8787" >&2; exit 1; }

# 0b) .env 必填键（只查键在不在与是否为空；不对口令做任何输出）
for key in POSTGRES_PASSWORD DATABASE_URL MIGRATION_DATABASE_URL SERVER_IP TRUST_PROXY_CIDR; do
  grep -q "^${key}=" .env || { echo "拒绝执行：.env 缺键 ${key}" >&2; exit 1; }
done
grep -q '^API_TAG=' .env || { echo "提示：首次部署，.env 无 API_TAG，已补空键（构建后写入）"; echo 'API_TAG=' >> .env; }
SERVER_IP_VALUE=$(sed -n 's/^SERVER_IP=//p' .env | tail -1 | tr -d '[:space:]')
[ -n "$SERVER_IP_VALUE" ] || { echo "拒绝执行：.env 的 SERVER_IP 为空" >&2; exit 1; }

# 0c) 两条连接串必须互异（config.ts 的生产启动校验同款；只比较、不 echo 值）
DB_URL_VALUE=$(sed -n 's/^DATABASE_URL=//p' .env | tail -1)
MIG_URL_VALUE=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' .env | tail -1)
[ "$DB_URL_VALUE" != "$MIG_URL_VALUE" ] \
  || { echo "拒绝执行：DATABASE_URL 与 MIGRATION_DATABASE_URL 相同（生产必须分离，否则应用拒绝启动）" >&2; exit 1; }

# 0d) TRUST_PROXY_CIDR 必须逐字等于**现役网络实况**子网。2026-10-12 E3b 改版：
#     旧版从 compose.yml 抠 subnet——但 compose 声明 ipam 会让计划「先停 db 再重建网络」（dry-run 实测），
#     修法 = compose 故意不写 ipam ⇒ 对账源改成 docker network inspect 的现场真值（比文本对账更硬）。
SUBNET=$(docker network inspect miai_default --format '{{(index .IPAM.Config 0).Subnet}}' 2>/dev/null || true)
TPC=$(sed -n 's/^TRUST_PROXY_CIDR=//p' .env | tail -1 | tr -d '[:space:]')
if [ -z "$SUBNET" ] || [ -z "$TPC" ] || [ "$TPC" != "$SUBNET" ]; then
  echo "拒绝执行：.env 的 TRUST_PROXY_CIDR='${TPC}' 必须等于现役网络 miai_default 的实占子网='${SUBNET}'（trustProxy 只信这个段）" >&2
  exit 1
fi

# ── 1) 预更新备份（数据安全网） ────────────────────────────────────────────────
bash "$(cd "$(dirname "$0")" && pwd)/backup.sh"

# ── 2) 解包 + 换 current 软链 ──────────────────────────────────────────────────
rm -rf "releases/$SHA"
mkdir -p "releases/$SHA"
tar -xzf "$TGZ" -C "releases/$SHA"
# 前缀自证（发布包必须来自 `git archive ... <sha> -- server` 的形态）
[ -f "releases/$SHA/server/package.json" ] \
  || { echo "拒绝执行：解包后缺 releases/$SHA/server/package.json —— 打包方式错了（必须带 server/ 前缀）" >&2; exit 1; }
# 软链目标写相对名 $SHA（在 releases/ 目录内解析）；写成 releases/$SHA 会指到 releases/releases/...（D4 旧文之误）
ln -sfn "$SHA" releases/current

# ── 3) 构建镜像（tag=sha；镜像清理保留 168h ⇒ 回滚窗口内旧镜像还在） ─────────────
docker build -t "miai-api:$SHA" "releases/$SHA/server"

# ── 4) 记旧 tag、写新 API_TAG（compose 的 image 用 ${API_TAG} 插值） ──────────────
OLD_TAG=$(sed -n 's/^API_TAG=//p' .env | tail -1)
sed -i "s/^API_TAG=.*/API_TAG=$SHA/" .env

# ── 4b) 计划见证（2026-10-12 E3b 教训）：up 前 dry-run 不许含网络动作或 db/caddy 被停/重建 ──
#     红灯形态实测过：compose 若认为网络定义变了（如有人在 networks 段加了 ipam），
#     计划 = Container miai-db-1 Stopping → Network miai_default Removing（＝踩「PG 绝不重启」红线）。
#     此时镜像已 build、tag 已写、但**容器未动** ⇒ 拒绝时把 tag 写回旧值即可安全退出。
PLAN=$(docker compose up -d --dry-run api 2>&1 || true)
if printf '%s' "$PLAN" | grep -qE 'Network .*(Removing|Removed)|Container miai-(db|caddy)-1 (Stopping|Stopped|Recreate)'; then
  echo "拒绝执行：up -d api 的计划含网络重建或 db/caddy 被停——绝不能跑（查 compose.yml 的 networks 段是否被加了 ipam）" >&2
  printf '%s\n' "$PLAN" >&2
  sed -i "s/^API_TAG=.*/API_TAG=$OLD_TAG/" .env
  echo "已把 API_TAG 写回 '${OLD_TAG}'（镜像已 build 但未部署，线上容器未动）" >&2
  exit 1
fi

# ── 5) 迁移：显式执行（绝不挂在应用启动路径）；失败即中止，现场容器未动 ───────────
# runner 产物路径 = dist/db/migrate.js（tsconfig.build.json rootDir=src ⇒ 产物带 db 子目录；
# 与 server/package.json 的 migrate:built 同款路径）
docker compose run --rm api node dist/db/migrate.js

# ── 6) 切换 api + 健康连测（10 次、每次间隔 2s，需 ≥5 次成功） ────────────────────
# 判据 = HTTP 200 且响应体含 "ok":true（占位 respond 回的文本不含此串 ⇒ 不会假绿）
# 注意：从服务器访问自己的公网 IP 依赖 Lighthouse 公网 IP 直绑网卡；若网络做了 NAT 导致全红 = 误判，
# 先手工 `curl https://<IP>/v1/health` 验证一次，再按 deploy/README.md 的备用探针地址处理。
docker compose up -d api
ok=0
last_response=''
for _ in $(seq 1 10); do
  body=$(curl -fsS --max-time 3 "https://${SERVER_IP_VALUE}/v1/health" 2>/dev/null || true)
  if printf '%s' "$body" | grep -q '"ok":true'; then
    ok=$((ok + 1))
    last_response="$body"
  fi
  sleep 2
done
if [ "$ok" -lt 5 ]; then
  echo "验证失败（$ok/10），回滚到 ${OLD_TAG:-（无旧 tag）}" >&2
  if [ -n "${OLD_TAG:-}" ]; then
    sed -i "s/^API_TAG=.*/API_TAG=$OLD_TAG/" .env
    docker compose up -d api
    echo "已回滚：API_TAG=$OLD_TAG（数据库未动——迁移只增不改）" >&2
  else
    echo "首次部署无旧 tag：不自动回滚，api 保持现状，人工处置（db 数据未动）" >&2
  fi
  exit 1
fi
echo "部署完成：$SHA（health $ok/10）"
echo "最后一次 /v1/health 回读：$last_response"
# schemaVer 期望值从**本次解包的迁移集**现算。写死数字是腐烂源：曾写死「0001~0006 ⇒ 6」，
# 迁移加到 0010 都没人回写，操作员会拿 6 把健康部署判成「可能部署了旧版本」（2026-10-10 夜核验发现）。
# 能走到这里说明第 5 步迁移已成功 ⇒ migrations/ 必然存在；真读不到就显示 ?，不误导。
MAX_MIG=$(ls "releases/$SHA/server/migrations" 2>/dev/null | sed -n 's/^\([0-9][0-9]*\)_.*\.sql$/\1/p' | sort -n | tail -1 || true)
echo "请核对 schemaVer 是否为当前迁移集最大版本（本次迁移集最大编号 ${MAX_MIG:-?} ⇒ schemaVer $((10#${MAX_MIG:-0}))；不一致 = 可能部署了旧版本）"

# ── 7) 清理 168 小时前的旧镜像（保留近一周，回滚要靠它） ─────────────────────────
docker image prune -f --filter "until=168h"
