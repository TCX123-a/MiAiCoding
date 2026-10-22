-- 0009_challenge_total_5000.sql —— 挑战批长上界 20 → 5000（挑战 v3，2026-10-10 主人令）：
--   取消「单日最多 20 题」的产品上限：答对继续、答错立即停止，客户端改抽整个已学题库。
--   本迁移只放宽 challenge_days.total 的 CHECK：BETWEEN 1 AND 20 → BETWEEN 1 AND 5000。
--   沿革：0003 定 1..5（v1 固定 5 题）→ 0007 放宽到 1..20（挑战 v2 连对制）→ 本迁移 0009
--   （挑战 v3）：5000 不是产品上限而是健全性上界——全库实测 4169 题 + AI 段 20 的最坏 4189
--   之上留余量（protocol 真源 CHALLENGE_RUN_MAX=5000）。
--
-- 约束真名核对（迁移前实测 pg_constraint）：0003 的行内 CHECK 由 PG 自动命名，本表的批长
-- 约束真名 = challenge_days_total_check（当前定义 (total >= 1) AND (total <= 20)，0007 所改）。
-- DROP + ADD 同名约束，错误分流口径不变（23514 → 400 VALIDATION_FAILED）。
-- 对 score 的 CHECK 仍只有 0003 定义的两条（score >= 0 与 score_max >= score）：单日分数上限
-- 仍只由应用层 DAILY_SCORE_MAX = 5000 × 250 = 1,250,000 把关（难度分制：语言权重全 100，
-- challenge 档 250/题）→ 本次不动 score；smallint 容量 5000 无虞。
--
-- 0007 的批长上界（1..20）已被 runner sha256 钉死、不可再编辑（只增不改），故新增本迁移。
--
-- GRANT：无新表 / 新列 / 新序列，ALTER TABLE 不影响既有 ACL —— 无需补 GRANT
--（0003 的角色守卫式授权对 miai_app 的 DML 权限不因约束替换而变；grants 轨测试复跑兜底）。
--
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

ALTER TABLE challenge_days DROP CONSTRAINT challenge_days_total_check;
ALTER TABLE challenge_days ADD CONSTRAINT challenge_days_total_check
  CHECK (total BETWEEN 1 AND 5000);   -- = CHALLENGE_RUN_MAX（protocol.ts，挑战 v3 起）
