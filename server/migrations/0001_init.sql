-- 0001_init.sql —— miai 后端初始 schema（docs/22 §4.2 五张表之四 + §4.5 索引 + §4.6 双角色 GRANT）。
-- 规则：只增不改。本文件一旦被应用，其字节内容不可再编辑——迁移 runner 会校验 sha256
-- （schema_migrations 表由 runner 自行创建，见 src/db/migrate.ts）。
-- 约束命名供错误分流使用（docs/22 自由度 #1/#3/#4）：
--   user_docs_payload_size   → 23514 → 413 PAYLOAD_TOO_LARGE（绝不落 500）
--   其它 CHECK 违约           → 23514 → 400 VALIDATION_FAILED
--   users_username_lower_key → 23505 → 409 USERNAME_TAKEN
--   sessions_token_hash_key  → 23505 → 500 INTERNAL（概率可忽略）

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  username_lower text NOT NULL,
  password_hash text NOT NULL,
  avatar_hash text,
  avatar_png bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  CONSTRAINT users_username_lower_key UNIQUE (username_lower)
);

CREATE TABLE sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  client_label text,
  revoked_at timestamptz,
  revoked_reason text,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_revoked_reason_allowed CHECK (
    revoked_reason IS NULL
    OR revoked_reason IN ('logout','logout_all','password_change','disabled','account_deleted','purge')
  )
);

CREATE TABLE user_docs (
  account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  revision bigint NOT NULL,
  doc_ver int NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, doc_type),
  CONSTRAINT user_docs_doc_type_allowed CHECK (doc_type IN ('profile','wrongbook','favorites','practice')),
  CONSTRAINT user_docs_revision_positive CHECK (revision >= 1),
  CONSTRAINT user_docs_doc_ver_positive CHECK (doc_ver >= 1),
  CONSTRAINT user_docs_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT user_docs_payload_size CHECK (octet_length(payload::text) <= 10 * 1024 * 1024)
);

CREATE TABLE auth_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event text NOT NULL,
  account_id uuid,
  username text,
  ip inet,
  ua_hash text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_audit_event_allowed CHECK (event IN (
    'register','login_ok','login_fail','login_blocked','logout','logout_all',
    'change_password','delete_account','account_disabled','sessions_revoked','rate_limited'
  ))
);

CREATE INDEX sessions_active_account_idx ON sessions (account_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_idle_expires_idx ON sessions (idle_expires_at);
CREATE INDEX auth_audit_created_idx ON auth_audit (created_at);
CREATE INDEX auth_audit_account_created_idx ON auth_audit (account_id, created_at);

-- 双角色 GRANT（docs/22 §4.6）：只在角色已存在时执行（本地开发 / PGlite 无角色则跳过）。
-- miai_owner 建表/迁移；miai_app 仅四表 DML + 序列 USAGE，无 DDL。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miai_app') THEN
    GRANT USAGE ON SCHEMA public TO miai_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, user_docs, auth_audit TO miai_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO miai_app;
  END IF;
END $$;
