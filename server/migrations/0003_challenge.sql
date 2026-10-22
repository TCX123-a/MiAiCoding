-- 0003_challenge.sql —— 挑战结算（docs/26 §3.2 / §3.4）：
--   ① users 增 leaderboard_opt_in 列（排行榜参与开关，默认 false）
--   ② user_docs 的 doc_type CHECK 加 'challenge'（为 v1.5 挑战文档同步铺路；API 面 v1 仍是四类）
--   ③ challenge_days / challenge_questions 两表 + 两条索引
--
-- 编号顺延说明：docs/26 §3.1 计划 0002~0005；0002 已被安全修复 F3
-- （schema_migrations 的 GRANT 补齐）占用 → 本批顺延为 0003~0006，只增不改、不重排。
--
-- CHECK 替换（②）是 docs/21 §3.4 明示允许的既有流程，按 docs/22 §4.7「改列」纪律
-- 执行（可逆评审：回滚 = 恢复 0001 的旧 CHECK 定义；上线前先手动备份）。
--
-- 约束命名供错误分流（docs/22 自由度 #4 + docs/26 §3.1 修订标注）：
--   本文新表所有 CHECK 违约（23514）→ 400 VALIDATION_FAILED（体积类才 413）。
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

ALTER TABLE users ADD COLUMN leaderboard_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE user_docs DROP CONSTRAINT user_docs_doc_type_allowed;
ALTER TABLE user_docs ADD CONSTRAINT user_docs_doc_type_allowed
  CHECK (doc_type IN ('profile','wrongbook','favorites','practice','challenge'));

CREATE TABLE challenge_days (
  account_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key          date NOT NULL,
  install_id        uuid NOT NULL,             -- 结算设备（P10.1 的 device.json installId）
  source            text NOT NULL CHECK (source IN ('local','ai')),
  started_at        timestamptz,
  finished_at       timestamptz NOT NULL,
  correct           smallint NOT NULL CHECK (correct >= 0),
  total             smallint NOT NULL CHECK (total BETWEEN 1 AND 5),    -- v1 挑战固定 5 题（CHALLENGE_SIZE）；扩批走新迁移
  score             int NOT NULL CHECK (score >= 0),      -- 服务端加权分（docs/26 §5）
  score_max         int NOT NULL CHECK (score_max >= score),
  score_by_lang     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"c":0,"cpp":173,…} 服务端铸（实得口径：答错计 0）
  score_by_difficulty jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"easy":200,"hard":210,…} 服务端铸（实得口径）
  flags             text[] NOT NULL DEFAULT '{}',          -- 异常标记（docs/26 §6.4），只标记不拦截
  submission_id     uuid NOT NULL,
  payload_sha256    text NOT NULL,             -- 提交体规范化后的 sha256（幂等冲突判定）
  settled_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (correct <= total),
  CHECK (jsonb_typeof(score_by_lang) = 'object'),
  CHECK (jsonb_typeof(score_by_difficulty) = 'object'),
  PRIMARY KEY (account_id, date_key)           -- 一天一批：多设备同日先到先得（docs/26 §8.4）
);

CREATE TABLE challenge_questions (
  account_id   uuid NOT NULL,
  date_key     date   NOT NULL,
  idx          smallint NOT NULL CHECK (idx >= 0),
  question_key text NOT NULL CHECK (question_key ~ '^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$'),
  lesson_id    text NOT NULL,
  qid          text NOT NULL,
  lang         text NOT NULL CHECK (lang IN ('common','c','cpp','java','python')),
  stage        smallint NOT NULL CHECK (stage BETWEEN 0 AND 3),
  qtype        text NOT NULL CHECK (qtype IN ('choice','fill','code','codefill','codefix','codewrite')),
  difficulty   text NOT NULL CHECK (difficulty IN ('easy','medium','hard','challenge')),
  source       text NOT NULL CHECK (source IN ('local','ai')),
  ok           boolean NOT NULL,
  points       int NOT NULL CHECK (points >= 0),
  PRIMARY KEY (account_id, date_key, idx),
  FOREIGN KEY (account_id, date_key)
    REFERENCES challenge_days(account_id, date_key) ON DELETE CASCADE
);

CREATE INDEX challenge_days_day_idx ON challenge_days (date_key);
CREATE INDEX challenge_questions_key_idx ON challenge_questions (date_key, question_key);

-- 双角色 GRANT（docs/22 §4.6）：只在角色已存在时执行（本地开发 / PGlite 无角色则跳过）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miai_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_days, challenge_questions TO miai_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO miai_app;
  END IF;
END $$;
