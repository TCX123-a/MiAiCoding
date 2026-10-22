-- 0013_username_change_audit.sql —— 用户名修改（2026-10-22 用户系统批次）。
--
-- 【只做一件事】auth_audit_event_allowed 白名单 +1：change_username。
-- PUT /v1/me/username 成功后写一条审计；用户名字段本身就是公开信息（榜面可见），
-- 审计里只记新名字，不记旧名字（旧名字另有 register 事件可追溯）。
--
-- 【为什么不改表结构】用户名本来就在 users.username / username_lower 两列，
-- 唯一约束与格式约束 0012 已齐备；改名只是 UPDATE，不需要新列。
--
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

ALTER TABLE auth_audit DROP CONSTRAINT auth_audit_event_allowed;
ALTER TABLE auth_audit ADD CONSTRAINT auth_audit_event_allowed CHECK (event IN (
  'register','login_ok','login_fail','login_blocked','logout','logout_all',
  'change_password','change_username','delete_account','account_disabled','sessions_revoked','rate_limited',
  'password_reset','recover_fail'
));
