-- 0008_leaderboard_periods.sql —— 排行榜补 monthly / yearly 两档快照（2026-10-10 主人令）：
--   前端五页签（日/周/月/年/总）与服务端对齐 → leaderboard_snapshots.period 的 CHECK 由
--   ('daily','weekly') 放宽为 ('daily','weekly','monthly','yearly')。
--   alltime 仍**不进**快照（随时从 user_stats.total_score 实算，docs/26 §3.5 口径不变）。
--
-- 约束真名核对（迁移前实测 pg_constraint）：0005 行内 CHECK 的 PG 自动命名 =
-- leaderboard_snapshots_period_check，原定义 period = ANY(ARRAY['daily','weekly']）。
-- DROP + ADD 同名约束（错误分流不变：23514 → 400 VALIDATION_FAILED）。
-- 配套：每日任务（jobs/daily.ts）按 weekly 同款模式重铸 monthly/yearly；路由快照分支
-- 从 (daily|weekly) 扩到含 monthly/yearly。
--
-- GRANT：无新表 / 新列 —— 无需补 GRANT。
--
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

ALTER TABLE leaderboard_snapshots DROP CONSTRAINT leaderboard_snapshots_period_check;
ALTER TABLE leaderboard_snapshots ADD CONSTRAINT leaderboard_snapshots_period_check
  CHECK (period IN ('daily', 'weekly', 'monthly', 'yearly'));
