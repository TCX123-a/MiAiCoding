-- 0006_rice.sql —— 大白饭镜像账（docs/26 §3.6 / §6）：rice_ledger / rice_balances。
--
-- 流水是权威（逐条身份 entry_key，幂等去重 / 日上限 / 重放防护的落点）；
-- rice_balances 是 = clamp(SUM(rice_ledger.delta), 0, 999) 的派生缓存（每日任务对账，不一致重算覆盖）。
-- 服务端角色 = 镜像账 + 闸：不发饭（证明不了对错）、不消费（消费在客户端）、不惩罚（v1 不清零）。
--
-- 约束命名供错误分流：本表 CHECK 违约（23514）→ 400 VALIDATION_FAILED。
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

CREATE TABLE rice_ledger (
  seq         bigint GENERATED ALWAYS AS IDENTITY,  -- 全局入账序（下行增量游标）
  id          uuid NOT NULL DEFAULT uuidv7(),       -- PG18 新函数：时间有序 UUID
  account_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_key   text NOT NULL CHECK (char_length(entry_key) BETWEEN 8 AND 80),
  kind        text NOT NULL CHECK (kind IN
                ('adopt','lesson','review','answer','run','feed','chase','chat')),
  delta       smallint NOT NULL,                    -- 收入 >0；支出 <0；逐 kind 白名单（docs/26 §6.2）
  day_key     date NOT NULL,                        -- 客户端本地日
  at          timestamptz NOT NULL,                 -- 客户端发生时刻（时钟可异常→flag）
  ref         jsonb,                                -- 证据：lessonId / 指纹 / adopter 等
  flags       text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, entry_key)
);
CREATE INDEX rice_ledger_pull_idx ON rice_ledger (account_id, seq);
CREATE INDEX rice_ledger_day_idx  ON rice_ledger (account_id, day_key, kind);

CREATE TABLE rice_balances (       -- 派生缓存：= SUM(rice_ledger.delta) 的物化
  account_id   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance      int NOT NULL CHECK (balance BETWEEN 0 AND 999),
  earned_total bigint NOT NULL DEFAULT 0,
  spent_total  bigint NOT NULL DEFAULT 0,
  last_seq     bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 双角色 GRANT（docs/22 §4.6）：只在角色已存在时执行（本地开发 / PGlite 无角色则跳过）。
-- rice_ledger.seq 是 identity 序列——DML 需要序列 USAGE（ALL SEQUENCES 兜住）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miai_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON rice_ledger, rice_balances TO miai_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO miai_app;
  END IF;
END $$;
