-- 测试夹具：部分失败场景的第 2 份——第一条语句合法，第二条必炸。
-- 预期：整份文件事务回滚 → broken_b 不存在、schema_migrations 不记账 version=2。
CREATE TABLE broken_b (
  id int PRIMARY KEY
);
INSERT INTO table_that_does_not_exist (x) VALUES (1);
