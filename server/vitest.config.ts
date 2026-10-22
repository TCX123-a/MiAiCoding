import { defineConfig } from 'vitest/config';

/**
 * 真 PG 双轨（MIAI_TEST_PG 设置时）：连接预算 = 每个**同时存活的**临时库「应用池 max 4 +
 * 管理池 max 1」；单个文件可以并行持有多个库（例如 account.test.ts 同时开 3 个上下文）。
 * 理论上限 = maxWorkers × 单文件最多库数 × 5 = 4×3×5 = 60 < 本地 PG 的 max_connections(100)；
 * 实际并发低于该上限（连接按需惰性建立）。要调大 maxWorkers 前先按「库数×5」重算。
 * PGlite 模式（默认）不受影响。判定口径与 test/helpers/db.ts 一致：变量「存在」即 pg 模式。
 */
const pgMode = process.env.MIAI_TEST_PG !== undefined;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    ...(pgMode ? { maxWorkers: 4, minWorkers: 1 } : {}),
  },
});
