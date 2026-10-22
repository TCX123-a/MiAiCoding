-- 0012_security_qa_and_username.sql —— 注册安全问答两列 + 用户名规则放宽（2026-10-13 主人令）。
--
-- 【三件事】
--  ① users 加 security_question / security_answer_hash 两列（找回密码用；答案只存 argon2id 哈希，
--     明文答案既不落库也不进日志）；
--  ② users_username_format 放宽：`3~20 位字母数字下划线` → `2~30 位中文/字母/数字/下划线、
--     不能数字开头`（配套 zod 与客户端文案同批放宽；协议真源常量 USERNAME_RE）；
--  ③ auth_audit_event_allowed 白名单扩两项：password_reset（找回重置成功）/ recover_fail（找回失败）。
--
-- 【为什么是加一条迁移】迁移只增不改（0001 文件头纪律；runner 逐文件校验 sha256）。
--
-- 【存量自查】旧规则允许数字开头（如 '123abc'），新规则不许 —— 直接 ADD 新 CHECK 时 PG 会对
-- 存量行报 23514，但报错不说是哪一行。这里先 DO 块逐行自查、把违规用户名点进 WARNING、
-- 再抛异常中止（部署脚本随之失败回滚）——「迁移失败」可见且可处置，而不是静默卡住。
--
-- 【PG 正则的 \u 转义】\uXXXX 是 PG ARE 的合法转义（已用 PGlite 实测 14 例：中文正例 /
-- 数字开头 / 注入形态 / emoji 代理对全部符合预期）。区间取 CJK 统一表意文字基本区
-- 4E00~9FFF（BMP 内，一字符一码位）；emoji 等增补平面字符不在区间、照样被拒。
--
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

-- ① 安全问答两列。NULL 允许 = 存量账号没设过；成对性由 CHECK 钉住（写入路径恒成对，
--    半截行在数据库层就是不可能的形状）。
ALTER TABLE users ADD COLUMN security_question text;
ALTER TABLE users ADD COLUMN security_answer_hash text;
ALTER TABLE users ADD CONSTRAINT users_security_qa_pair CHECK (
  (security_question IS NULL) = (security_answer_hash IS NULL)
);

-- ② 存量用户名自查（违新规则的行点名报出，然后整份迁移中止回滚）
DO $$
DECLARE
  bad_username text;
  bad_count integer := 0;
BEGIN
  FOR bad_username IN
    SELECT username FROM users
     WHERE username !~ '^[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]{1,29}$'
  LOOP
    bad_count := bad_count + 1;
    RAISE WARNING '存量用户名 % 不符合新格式规则（数字开头或形状不合法）', quote_literal(bad_username);
  END LOOP;
  IF bad_count > 0 THEN
    RAISE EXCEPTION '有 % 个存量用户名不符合新格式规则——人工处置（改名）后再应用 0012', bad_count;
  END IF;
END $$;

ALTER TABLE users DROP CONSTRAINT users_username_format;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (
  username ~ '^[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]{1,29}$'
);

-- ③ 审计事件白名单 +2（找回链两事件）
ALTER TABLE auth_audit DROP CONSTRAINT auth_audit_event_allowed;
ALTER TABLE auth_audit ADD CONSTRAINT auth_audit_event_allowed CHECK (event IN (
  'register','login_ok','login_fail','login_blocked','logout','logout_all',
  'change_password','delete_account','account_disabled','sessions_revoked','rate_limited',
  'password_reset','recover_fail'
));
