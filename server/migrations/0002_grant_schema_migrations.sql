-- 0002_grant_schema_migrations.sql —— 双角色 GRANT 补齐（安全审查 F3）。
-- schema_migrations 由迁移 runner（miai_owner）创建，0001 的守卫式 GRANT 未含此表
-- → 生产 miai_app 角色下 /v1/health 的 schemaVer 恒 0（静默 catch 掩盖 42501 权限错）。
-- 修复 = 一条 GRANT SELECT（health 只读 MAX(version)，不需要任何写权）。
-- 规则：只增不改；守卫式执行（PGlite / 本地开发无角色则跳过），与 0001 同款。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miai_app') THEN
    GRANT SELECT ON schema_migrations TO miai_app;
  END IF;
END $$;
