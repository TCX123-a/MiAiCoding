-- 0004_progress.sql —— 进度派生表（docs/26 §3.3）：user_days / user_stats。
--
-- 权威数据仍是 user_docs 里的四份 JSON（服务端只存不解释）；这两张表是**查询用的派生**：
-- 由每日任务（jobs/daily.ts）从 user_docs（practice/profile）+ challenge_days + rice_ledger
-- 计算，可随时全量重算（docs/22 §4.8 台阶 2「派生表可弃可重算」）。
--
-- day_key 沿用客户端本地日（与挑战 dateKey 同源）；服务端不试图换算时区。
-- 约束命名供错误分流：本表 CHECK 违约（23514）→ 400 VALIDATION_FAILED（答案写在数据里，绝不落 500）。
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

CREATE TABLE user_days (
  account_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key     date NOT NULL,                -- 客户端本地日（结算/流水带来的口径）
  learned     smallint NOT NULL DEFAULT 0,  -- 当日 profile.learned 净增课数
  practiced   smallint NOT NULL DEFAULT 0,  -- 当日 practice 会话数
  correct     smallint NOT NULL DEFAULT 0,  -- 当日答对题数（practice items 汇总）
  total       smallint NOT NULL DEFAULT 0,  -- 当日作答题数
  score       int      NOT NULL DEFAULT 0,  -- 当日挑战分（服务端算的加权分，docs/26 §5）
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, day_key),
  CHECK (correct <= total)
);

CREATE TABLE user_stats (
  account_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  learned_count   int NOT NULL DEFAULT 0,   -- 累计已学课数
  practiced_count int NOT NULL DEFAULT 0,   -- 累计练习会话数
  streak_days     int NOT NULL DEFAULT 0,   -- 连续学习天数（含挑战/练习任一）
  last_active_day date,
  total_score     int NOT NULL DEFAULT 0,   -- 累计挑战分（总榜真源；= SUM(challenge_days.score)，重算时校验）
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 双角色 GRANT（docs/22 §4.6）：只在角色已存在时执行（本地开发 / PGlite 无角色则跳过）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miai_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_days, user_stats TO miai_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO miai_app;
  END IF;
END $$;
