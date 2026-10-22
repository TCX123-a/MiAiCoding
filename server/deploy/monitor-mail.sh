#!/usr/bin/env bash
# monitor-mail.sh —— miai 失联自检邮件（方案B；2026-10-12 主人令落装）。
# 安装位置：/opt/miai/bin/monitor-mail.sh（chmod 700）。
# 凭据文件：/opt/miai/bin/monitor-mail.env（chmod 600；模板 = server/deploy/monitor-mail.env.example）。
# cron：3-58/5 * * * * /opt/miai/bin/monitor-mail.sh >> /var/log/miai-monitor.log 2>&1
# 行为：每 5 分钟查一次 /v1/health（与 healthcheck.sh ① 同款 --resolve 写法：连接端指向 127.0.0.1、
#        Host/SNI = 公网 IP；**绝不裸用 https://127.0.0.1**——Caddy 站点块按 Host 匹配，裸写法会被
#        fallback 以「200 空体」接走造成假活，2026-10-12 已双实验实证）。
#        失败 → 发告警邮件（仅状态翻转或距上次**成功**告警 ≥REPEAT_SEC 才发，防刷屏）；恢复 → 发「已恢复」。
#        发信（SMTP 真尝试）失败后 ≥ATTEMPT_SEC 内不再进行下一次尝试——防 163 侧「认证失败次数过多
#        禁 IP」（官方退信码表 554 smtp auth error limit exceed；2026-10-12 加）。凭据未配的 skip 不算尝试。
#        邮件走 smtps://smtp.163.com:465 由 curl 直发（服务器零依赖）；凭据经临时 netrc 传入，
#        不进命令行（ps 不可见）。
# 测试缝：MIAI_HOME 换基准目录（默认 /opt/miai）；MIAI_MONITOR_STATE_DIR 换状态目录
#        （默认 /var/lib/miai-monitor；隔离测试用）；--test-mail 强制发一封测试邮件后退出。
# 局限（如实）：整机断电/断网/端口全封时本脚本根本不会被运行——「整机失联」由腾讯云侧
#        云监控/云拨测（方案A）从外部探活兜底；本脚本兜的是「主机活着、应用层坏了」。
# 退出码：健康=0；失败=1（退出码不撒谎，与 healthcheck.sh 同哲学）。
set -u

BASE="${MIAI_HOME:-/opt/miai}"
ENVF="$BASE/bin/monitor-mail.env"
STATE_DIR="${MIAI_MONITOR_STATE_DIR:-/var/lib/miai-monitor}"
STATE="$STATE_DIR/state"
REPEAT_SEC=$((6 * 3600))    # 持续故障时最多每 6 小时重发一封告警（距上次成功告警）
ATTEMPT_SEC=$((30 * 60))    # 发信失败退避：30 分钟内不再尝试发信（防 163 认证连败封 IP）
# DB 层判据（2026-10-17 D3）：/v1/health 是**存活**语义——DB 挂了它照样 200 + "ok":true，
# 只是 schemaVer 在 catch 里归 0。所以只看 ok 的判据探不到「数据库不可达」。当前库
# schemaVer=13（2026-10-22 用户名审计批）；低于它 = DB 不可达或迁移没跑，按故障发信。
MIN_SCHEMA_VER="${MIAI_MIN_SCHEMA_VER:-13}"

ts() { date '+%F %T'; }

# ---------- 发信（curl SMTP；凭据走临时 netrc，不进命令行） ----------
send_mail() { # $1=主题  $2=正文
  if [ ! -f "$ENVF" ]; then
    echo "$(ts) mail-skip 凭据文件不存在：$ENVF（照 monitor-mail.env.example 建一份）"
    return 1
  fi
  # shellcheck disable=SC1090
  set -a; . "$ENVF"; set +a
  : "${SMTP_HOST:=smtp.163.com}"; : "${SMTP_PORT:=465}"
  if [ -z "${SMTP_USER:-}" ] || [ -z "${MAIL_TO:-}" ] || [ -z "${SMTP_AUTH:-}" ] || [ "$SMTP_AUTH" = "PUT_AUTH_CODE_HERE" ]; then
    echo "$(ts) mail-skip 尚未配置 SMTP 凭据（编辑 $ENVF：把 SMTP_AUTH 填成 163 授权码）"
    return 1
  fi
  local msg netrc b64 out rc
  msg=$(mktemp); netrc=$(mktemp)
  chmod 600 "$netrc"
  printf 'machine %s login %s password %s\n' "$SMTP_HOST" "$SMTP_USER" "$SMTP_AUTH" > "$netrc"
  b64=$(printf '%s' "$1" | base64 -w0)
  {
    printf 'From: %s\r\n' "$SMTP_USER"
    printf 'To: %s\r\n' "$MAIL_TO"
    printf 'Subject: =?UTF-8?B?%s?=\r\n' "$b64"
    printf 'Date: %s\r\n' "$(date -R)"
    printf 'MIME-Version: 1.0\r\n'
    printf 'Content-Type: text/plain; charset=UTF-8\r\n'
    printf 'Content-Transfer-Encoding: 8bit\r\n'
    printf '\r\n%s\r\n' "$2"
  } > "$msg"
  out=$(curl -sS --max-time 30 --url "smtps://${SMTP_HOST}:${SMTP_PORT}" \
        --netrc-file "$netrc" \
        --mail-from "$SMTP_USER" --mail-rcpt "$MAIL_TO" \
        --upload-file "$msg" 2>&1)
  rc=$?
  rm -f "$msg" "$netrc"
  if [ "$rc" -eq 0 ]; then
    echo "$(ts) mail-sent → $MAIL_TO ｜ $1"
    return 0
  fi
  echo "$(ts) mail-FAIL rc=$rc ｜ $out"
  return 2  # 2 = 真尝试过 SMTP 且失败（调用侧据此记退避）；1 = 未尝试（skip，零成本）
}

# ---------- --test-mail：强制测试发信（不碰状态、不建目录、不跑检查） ----------
if [ "${1:-}" = "--test-mail" ]; then
  if send_mail "【咪爱编程】邮件通道测试（monitor-mail）" "这是一封测试邮件：$(ts) 从 $(hostname) 发出。收到即代表方案B 邮件通道已配好。"; then
    echo "$(ts) test-mail ok（请查看收件箱；若未见请查垃圾箱）"
    exit 0
  fi
  echo "$(ts) test-mail FAILED（见上方 mail-skip / mail-FAIL 行）"
  exit 1
fi

# ---------- 单实例锁与状态目录 ----------
if ! mkdir -p "$STATE_DIR" 2>/dev/null; then
  echo "$(ts) FATAL 状态目录不可用：$STATE_DIR"
  exit 1
fi
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

write_state() { printf 'status=%s\nlast_alert=%s\nlast_attempt=%s\n' "$1" "$2" "$3" > "$STATE"; }

# ---------- 健康检查（与 healthcheck.sh ① 同款判据） ----------
SERVER_IP_VALUE=$(sed -n 's/^SERVER_IP=//p' "$BASE/.env" 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
check=fail
fail_detail=""
if [ -z "${SERVER_IP_VALUE:-}" ]; then
  fail_detail="SERVER_IP 读取失败（检查 $BASE/.env）"
else
  body=$(curl -fsS --max-time 8 -k --resolve "${SERVER_IP_VALUE}:443:127.0.0.1" "https://${SERVER_IP_VALUE}/v1/health" 2>&1)
  rc=$?
  schema_ver=$(printf '%s' "$body" | sed -n 's/.*"schemaVer":[[:space:]]*\([0-9]\{1,\}\).*/\1/p')
  if [ "$rc" -ne 0 ]; then
    fail_detail="health 未通过（curl rc=$rc）｜输出前 300 字节：$(printf '%s' "$body" | head -c 300)"
  elif ! printf '%s' "$body" | grep -q '"ok":true'; then
    fail_detail="health 未通过（响应体缺 \"ok\":true）｜输出前 300 字节：$(printf '%s' "$body" | head -c 300)"
  elif [ -z "${schema_ver:-}" ] || [ "$schema_ver" -lt "$MIN_SCHEMA_VER" ]; then
    # DB 层判据：schemaVer=0 是 /v1/health 在 DB 查询失败时的固定值（routes/health.ts）
    fail_detail="数据库层未通过：schemaVer=${schema_ver:-缺失}（要求 ≥${MIN_SCHEMA_VER}；DB 不可达或迁移没跑）｜输出前 300 字节：$(printf '%s' "$body" | head -c 300)"
  else
    check=ok
  fi
fi

# ---------- 读旧状态（错误值一律回安全默认） ----------
prev_status=ok
prev_alert=0
prev_attempt=0
if [ -f "$STATE" ]; then
  s=$(sed -n 's/^status=//p' "$STATE" | tail -1); prev_status="${s:-ok}"
  a=$(sed -n 's/^last_alert=//p' "$STATE" | tail -1); prev_alert="${a:-0}"
  t=$(sed -n 's/^last_attempt=//p' "$STATE" | tail -1); prev_attempt="${t:-0}"
fi
case "$prev_status" in ok|fail) ;; *) prev_status=ok ;; esac
case "$prev_alert" in ''|*[!0-9]*) prev_alert=0 ;; esac
case "$prev_attempt" in ''|*[!0-9]*) prev_attempt=0 ;; esac
now=$(date +%s)
host=$(hostname)

# ---------- 判定与发信策略 ----------
if [ "$check" = "ok" ]; then
  if [ "$prev_status" = "fail" ]; then
    send_mail "【咪爱编程】已恢复：服务器健康检查通过" "好消息：$(ts) 起 /v1/health 恢复正常（$host / $SERVER_IP_VALUE）。此前故障期间已发过告警邮件。"
    write_state ok 0 "$prev_attempt"
  else
    echo "$(ts) ok health schemaVer=$schema_ver（不发邮件）"
    write_state ok "$prev_alert" "$prev_attempt"
  fi
  exit 0
fi

# 发信闸门：状态翻转立即发；持续故障需「距上次成功告警 ≥REPEAT_SEC」且「距上次发信尝试 ≥ATTEMPT_SEC」
can_send=0
if [ "$prev_status" != "fail" ]; then
  can_send=1
elif [ $(( now - prev_alert )) -ge "$REPEAT_SEC" ] && [ $(( now - prev_attempt )) -ge "$ATTEMPT_SEC" ]; then
  can_send=1
fi

if [ "$can_send" = "1" ]; then
  send_mail "【咪爱编程】告警：服务器健康检查失败（$host）" "故障时间：$(ts)
主机：$host（$SERVER_IP_VALUE）
$fail_detail

脚本每 5 分钟自动重试；恢复后会再发一封「已恢复」。
若一直收不到「已恢复」：请登录腾讯云控制台查看轻量应用服务器实例是否在线
（整机失联由控制台侧监控/拨测兜底；本邮件只证明「主机活着但健康接口坏了」）。"
  rc_send=$?
  if [ "$rc_send" -eq 0 ]; then
    write_state fail "$now" "$now"
  elif [ "$rc_send" -eq 2 ]; then
    write_state fail "$prev_alert" "$now"           # 真尝试失败：不记 last_alert（下轮继续重试）、记退避
  else
    write_state fail "$prev_alert" "$prev_attempt"  # 凭据未配的 skip：零成本，下轮照常重试
  fi
else
  echo "$(ts) fail health（节流：距上次成功告警 $(( now - prev_alert ))s、距上次发信尝试 $(( now - prev_attempt ))s；静默重试）"
  write_state fail "$prev_alert" "$prev_attempt"
fi
exit 1
