-- 0011_rice_checkin_kind.sql —— rice_ledger.kind 白名单扩一项：'checkin'（每日签到 +2 碗）。
--
-- 【为什么是加一条迁移而不是改 0006】迁移只增不改（0006 文件头：应用后不可再编辑，
-- runner 校验 sha256）。0006 里 kind 是内联 CHECK（PG 自动命名 rice_ledger_kind_check），
-- 这里 DROP 掉重建为九项白名单。
--
-- 【为什么 checkin 必须进白名单】签到实发 2 碗（app.ts 的 PET_CHECKIN_RICE =
-- pet.ts 的 PET_REWARD_RICE.checkin）。账本模型下 pet.json.rice 是 clamp(Σentries)
-- 的镜像 —— **任何不进账本的加饭都会被下一次镜像重算抹掉**。docs/26 §6.2 写表时
-- 签到还没接饭，漏了这一行（2026-10-10 夜补；两端 protocol.ts 同批加 checkin: 2，
-- 日上限 1 = 签到每日一次）。
--
-- 同批更正的语义（见 protocol.ts 与 cloud-protocol.test.ts）：
--   · chase/chat 两行在白名单里保留（服务端宽容收），但**客户端 v1 从不上行**
--     —— 实现里这两个动作扣的是饱食度（exertPet），不是饭；§6.2 表中的
--     「依据 = PET_CHASE_COST/PET_CHAT_COST」是文档写错了实现事实。
--
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

ALTER TABLE rice_ledger DROP CONSTRAINT rice_ledger_kind_check;
ALTER TABLE rice_ledger ADD CONSTRAINT rice_ledger_kind_check CHECK (kind IN
  ('adopt','lesson','review','answer','run','feed','chase','chat','checkin'));
