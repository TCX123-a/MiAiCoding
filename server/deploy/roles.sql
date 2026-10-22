-- roles.sql —— 双角色建角模板（docs/22 §4.6；可执行规格 = server/test/integration/grants-real-pg.test.ts:40-56，已在真 PG 上跑绿）。
-- 用法（服务器上，db 容器 healthy 之后、跑迁移之前）：
--   docker compose exec -T db psql -U miai -d miai -v ON_ERROR_STOP=1 < deploy/roles.sql
--
-- 顺序铁律：**先建角色 → 后跑迁移**。0001~0006 六个迁移文件里的真 GRANT 全是守卫式
--   「IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miai_app') THEN GRANT ...」
--   （0001:79-86 / 0002:8-9 / 0003:70-72 / 0004:37-39 / 0005:25-27 / 0006:41-43）——
--   角色晚建 = 守卫静默跳过 = 权限没落下 = 运行期才炸（schemaVer 恒 0 或 42501）。
--
-- 口令：两处占位符 <现场生成> 现场改成随机强口令（用 openssl rand -hex 24——
--   hex 零 URL 转义坑；base64 的 +/= 进连接串必须百分号编码，极易踩坑），
--   与 /opt/miai/.env 的两条连接串逐字一致；入库版本绝不含真口令。
-- 为什么两个角色都要能登录（LOGIN）：生产是**直连**两个角色
--   （DATABASE_URL 用 miai_app / MIGRATION_DATABASE_URL 用 miai_owner），不是 SET ROLE；
--   不能登录的角色会以「role ... is not permitted to log in」直接拒绝连接。
-- 幂等：角色是集群级对象；DO/EXCEPTION 照抄可执行规格——串行复跑撞 duplicate_object(42710)、
--   两进程并发首建撞 unique_violation(23505)，两类都吞。

-- ① 建角（幂等）
DO $$
BEGIN
  CREATE ROLE miai_owner LOGIN PASSWORD '<现场生成>';
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;

DO $$
BEGIN
  CREATE ROLE miai_app LOGIN PASSWORD '<现场生成>';
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;

-- ② 角色已存在、需要同步/轮换口令时，取消注释执行（值自行替换；不要提交真口令）：
-- ALTER ROLE miai_owner WITH LOGIN PASSWORD '<现场生成>';
-- ALTER ROLE miai_app   WITH LOGIN PASSWORD '<现场生成>';

-- ③ 连接权（容器里默认 PUBLIC 也能连，但显式写死，防将来 revoke）
GRANT CONNECT ON DATABASE miai TO miai_owner;
GRANT CONNECT ON DATABASE miai TO miai_app;

-- ④ schema public 的建表权：PG15+ 起 public 归 pg_database_owner（数据库属主 miai 自动拥有），
--    miai_owner 不是属主 ⇒ 必须显式给 CREATE/USAGE，否则迁移第一步 CREATE TABLE 就 42501。
--    USAGE 带 WITH GRANT OPTION：迁移内部的 `GRANT USAGE ON SCHEMA public TO miai_app`
--    由 miai_owner 执行，没有 grant option 时该条 GRANT 不落地。
--    注意：这里**不预授权 miai_app**——保持迁移里守卫式 GRANT 的真伪可区分（预授权会把它们变成摆设）。
GRANT CREATE ON SCHEMA public TO miai_owner;
GRANT USAGE ON SCHEMA public TO miai_owner WITH GRANT OPTION;

-- ⑤ 建完自证（必须输出 2；输出别的数 = 有角色没建成，禁止继续跑迁移）
SELECT count(*) AS roles_ready
FROM pg_roles WHERE rolname IN ('miai_owner', 'miai_app');

-- ⑥ 可选：权限落点复核（人工看 pg_namespace.nspacl 里有没有 miai_owner=UC）
-- SELECT nspname, nspacl FROM pg_namespace WHERE nspname = 'public';
