-- 0007_challenge_run_max.sql —— 挑战批长改版（2026-10-10 主人令）：
--   「固定 5 题（CHALLENGE_SIZE）」→「答对继续、答错立即停止」，单日最长 20 题
--   （protocol 真源新名 CHALLENGE_RUN_MAX=20；服务端结算接受 total ∈ [1, 20]）。
--   本迁移只放宽 challenge_days.total 的 CHECK：BETWEEN 1 AND 5 → BETWEEN 1 AND 20。
--
-- 约束真名核对（迁移前在 PGlite/PG18 实测 pg_constraint）：0003 的行内 CHECK 由 PG 自动命名，
-- 本表的批长约束真名 = challenge_days_total_check（定义原为 (total >= 1) AND (total <= 5)）。
-- DROP + ADD 同名约束，错误分流口径不变（23514 → 400 VALIDATION_FAILED）。
-- 对 score 的 CHECK 实测只有 `score >= 0`（无 ≤1440 的日上限约束；日上限一直由应用层
-- DAILY_SCORE_MAX = CHALLENGE_RUN_MAX × weightedPoints('challenge','cpp') = 20×288 = 5760 把关）
-- → 本次不动 score。
--
-- GRANT：无新表 / 新列 / 新序列，ALTER TABLE 不影响既有 ACL —— 无需补 GRANT
--（0003 的角色守卫式授权对 miai_app 的 DML 权限不因约束替换而变；grants 轨测试复跑兜底）。
--
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

ALTER TABLE challenge_days DROP CONSTRAINT challenge_days_total_check;
ALTER TABLE challenge_days ADD CONSTRAINT challenge_days_total_check
  CHECK (total BETWEEN 1 AND 20);   -- = CHALLENGE_RUN_MAX（protocol.ts，2026-10-10 起）
