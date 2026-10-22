-- 0005_leaderboard.sql —— 排行榜快照表（docs/26 §3.5）：leaderboard_snapshots。
--
-- daily / weekly 由每日任务（cron 03:05，早于 03:17 备份）用 INSERT … SELECT … rank() OVER 重铸；
-- alltime 不进快照——随时从 user_stats.total_score 实算（几十行）。
-- 并列同名次（competition ranking，`rank()`）；展示排序 (score DESC, finished_at ASC) 保确定性。
--
-- 约束命名供错误分流：本表 CHECK 违约（23514）→ 400 VALIDATION_FAILED。
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

CREATE TABLE leaderboard_snapshots (
  period      text NOT NULL CHECK (period IN ('daily','weekly')),
  period_key  text NOT NULL,          -- daily: '2026-10-07'；weekly: ISO 周 '2026-W41'
  account_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       int  NOT NULL CHECK (score >= 0),
  rank        int  NOT NULL CHECK (rank >= 1),   -- 并列同名次（competition ranking）
  days        smallint NOT NULL DEFAULT 0,       -- 期内有结算的天数
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period, period_key, account_id)
);
CREATE INDEX leaderboard_board_idx ON leaderboard_snapshots (period, period_key, rank);

-- 双角色 GRANT（docs/22 §4.6）：只在角色已存在时执行（本地开发 / PGlite 无角色则跳过）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miai_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON leaderboard_snapshots TO miai_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO miai_app;
  END IF;
END $$;
