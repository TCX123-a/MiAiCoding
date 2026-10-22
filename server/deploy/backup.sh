#!/usr/bin/env bash
# backup.sh —— miai 每日数据库备份（骨架源自 D4-deploy.md §9；铁律来自 docs/22 §6.6）。
# 安装位置：/opt/miai/bin/backup.sh（chmod 700）。
# cron：17 0 * * * /opt/miai/bin/backup.sh >> /var/log/miai-backup.log 2>&1
#   （北京时间 00:17 = 与每日任务 00:05 错峰；两件事同刻并发 = 2C2G 机器内存红线）
# 形态：pg_dump -Fc（自定义格式，pg_restore 可用）+ gzip；保留 14 份；umask 077（备份含用户数据，不许 644）。
# 凭据：口令经 docker compose 从 /opt/miai/.env 注入容器；本脚本不接触、不 echo 任何口令。
set -euo pipefail
umask 077

BASE="${MIAI_HOME:-/opt/miai}"
cd "$BASE"

mkdir -p backups
D=$(date +%F)
dump="backups/miai-$D.dump"
tmp="${dump}.partial"
trap 'rm -f "$tmp"' EXIT

# -T = 不分配 TTY（cron 下必须）；先写 .partial、成功后改名 ⇒ 半截文件永远不会被当成「当日备份」
docker compose exec -T db pg_dump -U miai -d miai -Fc > "$tmp"
mv "$tmp" "$dump"
gzip -f "$dump"

# 轮转：只删 miai-*.dump.gz 且 mtime>14 天的（保留 14 份量级）；不会碰其它文件
find backups -maxdepth 1 -name 'miai-*.dump.gz' -mtime +14 -delete

ls -lh "backups/miai-$D.dump.gz"
