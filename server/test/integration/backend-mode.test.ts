/**
 * 双轨选择自证（harness 闸门）：MIAI_TEST_PG 的「设置 / 未设置」必须精确决定测试后端。
 *  - 设了 → ctx.backend 必须是 'pg'：若 helpers 静默忽略环境变量（比如回退 PGlite），
 *    这里就是红点——「真 PG 轨道全绿」的前提是它真的跑在真 PG 上；
 *  - 未设 → 必须是 'pglite'。
 * pg 模式另有专项：连的必须是本文件新建的临时库（miai_t_ 前缀），而不是 MIAI_TEST_PG
 * 指向的那个库本身（防「其实在所有测试共用一个库」这种隐蔽的脏状态来源）。
 * 另有空串守卫：MIAI_TEST_PG='' 属配置错误——判定口径是「存在」不是「真值」，
 * 显式空串必须当场炸（连 db.ts 的门都进不去就被拦下），不许被当成「未设置」。
 * 只动 test/**。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/app.js';
import { createTestDatabase } from '../helpers/db.js';

const pgMode = process.env.MIAI_TEST_PG !== undefined;
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx?.raw.close(); // beforeAll 炸掉时 ctx 未建：别让收尾再抛一个误导性的 TypeError
});

describe('测试后端选择自证（PGlite / 真 PG 双轨）', () => {
  it('backend 与 MIAI_TEST_PG 的存在性精确一致', () => {
    expect(ctx.backend).toBe(pgMode ? 'pg' : 'pglite');
  });

  it.runIf(pgMode)('pg 模式：连的是本文件的临时库（miai_t_ 前缀）且是真 PostgreSQL', async () => {
    // 用 URL 的 pathname 判，不用对整串锚定：连接串合法地可以带 ?sslmode=... 之类的查询参数
    expect(new URL(ctx.pgUrl!).pathname).toMatch(/^\/miai_t_[0-9a-f]{12}$/);
    const { rows } = await ctx.raw.query<{ db: string; ver: string }>(
      'SELECT current_database() AS db, version() AS ver',
    );
    expect(rows[0]!.db).toMatch(/^miai_t_[0-9a-f]{12}$/);
    expect(rows[0]!.ver).toMatch(/^PostgreSQL \d+/);
  });

  it.runIf(!pgMode)('pglite 模式：无 pgUrl（真 PG 专属字段不伪造），引擎同样报 PostgreSQL 版本串', async () => {
    expect(ctx.pgUrl).toBeUndefined();
    const { rows } = await ctx.raw.query<{ ver: string }>('SELECT version() AS ver');
    expect(rows[0]!.ver).toMatch(/^PostgreSQL \d+/);
  });

  it('MIAI_TEST_PG 显式空串 = 配置错误（双轨判定按「存在」不按「真值」，不许被当未设置）', async () => {
    const original = process.env.MIAI_TEST_PG;
    process.env.MIAI_TEST_PG = '';
    try {
      await expect(createTestDatabase()).rejects.toThrow(/空串/);
    } finally {
      if (original === undefined) {
        delete process.env.MIAI_TEST_PG;
      } else {
        process.env.MIAI_TEST_PG = original;
      }
    }
  });
});
