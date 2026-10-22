#!/usr/bin/env bash
# healthcheck.sh —— miai 5 分钟健康检查（骨架源自 D4-deploy.md §10；判据清单 docs/22 §6.7）。
# 安装位置：/opt/miai/bin/healthcheck.sh（chmod 700）。
# cron：*/5 * * * * /opt/miai/bin/healthcheck.sh >> /var/log/miai-health.log 2>&1
# 行为：只追加日志；四条里任一条 FAIL ⇒ 脚本退出码 1（日志与退出码同源，退出码不撒谎）。
# 四条：① /v1/health（本机走 --resolve 指向 127.0.0.1；见下方实证注——故意配 -k：
#        这是存活自检，证书信任校验在冒烟/客户端做，不在 cron 里）
#       ② 证书剩余有效期（<48h 报 FAIL——6 天短证书的续期探针）
#       ③ 磁盘（/ 用量 >80% 报 FAIL）
#       ④ 备份新鲜度（最新 dump <26h；北京时间 00:17 备份，超过 26h 说明昨夜没备成）
# 凭据：不读任何凭据；仅读 .env 的 SERVER_IP（部署侧非机密键）；不 echo 任何值。
set -euo pipefail

BASE="${MIAI_HOME:-/opt/miai}"
cd "$BASE"
ts=$(date '+%F %T')
FAILED=0
fail() { echo "$ts FAIL $1"; FAILED=1; }
# 与 monitor-mail.sh 同款 DB 层判据（2026-10-17 D3）：/v1/health 的 schemaVer
# 在 DB 查询失败时固定为 0（routes/health.ts 的 catch），只判 ok 会把「DB 挂了
# 但进程活着」记成健康。当前库 schemaVer=13（2026-10-22 用户名审计批）；低于它 = DB 不可达或迁移没跑。
MIN_SCHEMA_VER="${MIAI_MIN_SCHEMA_VER:-13}"

# ① 服务可达：HTTP 200 且响应体含 "ok":true（占位 respond 也回 200 文本，必须看体）
#    2026-10-12 实测教训（正式 Caddyfile 并入当天发现并双实验证实）：
#    **绝不能裸用 https://127.0.0.1** —— Caddy 站点块按 Host 匹配（本站点地址 = IP 字面量），
#    Host=127.0.0.1 不匹配 ⇒ 请求不进 reverse_proxy，被 Caddy fallback 以「200 空体」接走
#    （default_sni 只补 SNI、不管 Host）。A/B 实测：裸写法 200 空体 vs --resolve 写法 502（=已进反代）。
#    --resolve 形态：连接端指向 127.0.0.1（不走公网 hairpin）、Host/SNI 保持 = 公网 IP（精确等价外部客户端路径）。
SERVER_IP_VALUE=$(sed -n 's/^SERVER_IP=//p' .env 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
if [ -z "${SERVER_IP_VALUE:-}" ]; then
  fail "server_ip (check .env SERVER_IP)"
  body=''
else
  body=$(curl -fsS --max-time 5 -k --resolve "${SERVER_IP_VALUE}:443:127.0.0.1" "https://${SERVER_IP_VALUE}/v1/health" 2>/dev/null || true)
fi
if printf '%s' "$body" | grep -q '"ok":true'; then
  schemaVer=$(printf '%s' "$body" | sed -n 's/.*"schemaVer":[[:space:]]*\([0-9]\{1,\}\).*/\1/p')
  if [ -z "${schemaVer:-}" ] || [ "$schemaVer" -lt "$MIN_SCHEMA_VER" ]; then
    fail "health schemaVer=${schemaVer:-?} (need >=${MIN_SCHEMA_VER}; db down or migration not run)"
  else
    echo "$ts ok health schemaVer=$schemaVer"
  fi
else
  fail health
fi

# ② 证书剩余有效期（<48h 报 FAIL；6 天短证书的续期探针）
end=$(echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
if [ -n "${end:-}" ]; then
  left=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 3600 ))
  if [ "$left" -lt 48 ]; then fail "cert ${left}h left"; else echo "$ts ok cert ${left}h left"; fi
else
  fail "cert unreadable"
fi

# ③ 磁盘（根分区用量 >80% 报 FAIL）
use=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9' || true)
if [ -z "${use:-}" ]; then fail "disk unreadable"
elif [ "$use" -gt 80 ]; then fail "disk ${use}%"
else echo "$ts ok disk ${use}%"
fi

# ④ 备份新鲜度（最新 miai-*.dump.gz 必须 <26h）
latest=$(ls -1t backups/miai-*.dump.gz 2>/dev/null | head -n 1 || true)
if [ -z "$latest" ]; then
  fail "backup missing"
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
  if [ "$age_h" -ge 26 ]; then fail "backup stale ${age_h}h ($latest)"; else echo "$ts ok backup ${age_h}h"; fi
fi

exit "$FAILED"
