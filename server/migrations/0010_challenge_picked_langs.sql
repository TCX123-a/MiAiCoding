-- 0010_challenge_picked_langs.sql —— 挑战结算携带「开赛前勾选的语言」（2026-10-10 夜，主人令）：
--   排行榜每行展示的「所选语言」改为：该账号在榜期挑战里**开赛前勾选过**的语言并集
--   （榜单语义 = 挑战选择与难度池；不再从题批语言反推）。数据来源落在这里：
--   challenge_days 新增 picked_langs text[]（每档一份，随结算上行）。
--
--   取值域 = CHALLENGE_PICKABLE_LANGS（protocol 真源：LANGS 去 common，四门）。允许空数组：
--   ① 迁移前旧档的 DEFAULT '{}'（legacy 诚实降级——老客户端上行不带该字段，服务端从
--      题批 lang 交集派生，全 common 的批派生为空）；② 显式上行空数组由应用层 400 拒
--      （契约：present 时必须非空且合法）。DB 空数组只为兼容而留。
--   重复值由应用层拒（400，zod refine）；DB CHECK 只保底：子集 + 基数 ≤4
--   （去重无法在 CHECK 表达式里查，值域 + 基数已封住伪造面）。
--
--   索引：不加。聚合只按 account_id + date_key 窗口筛行、再在筛后行集上 unnest 展开，
--   0003 建表配套的 account_id/date_key 索引已覆盖筛选路径。
--
--   GRANT：无新表 / 新序列；0003 的守卫式授权是表级 GRANT，新列自动覆盖 —— 无需补 GRANT
--   （grants 轨测试把 picked_langs 写进 miai_app 身份的 INSERT 作现场见证）。
--
-- 规则：只增不改；本文件被应用后不可再编辑（runner 校验 sha256）。

ALTER TABLE challenge_days
  ADD COLUMN picked_langs text[] NOT NULL DEFAULT '{}';

ALTER TABLE challenge_days
  ADD CONSTRAINT challenge_days_picked_langs_check
  CHECK (
    cardinality(picked_langs) <= 4
    AND picked_langs <@ ARRAY['c', 'cpp', 'java', 'python']::text[]
  );
