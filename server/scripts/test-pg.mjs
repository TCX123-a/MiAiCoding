/**
 * 真 PG 双轨入口：MIAI_TEST_PG 已设置则尊重之，否则用本机 PG18 沙箱默认地址。
 * 用法：npm run test:pg [-- <vitest 过滤参数>]
 * 前置：`../_pg18local`（仓库的兄弟目录）的 PG18 已运行在 127.0.0.1:54329（启动方式见该目录 README）。
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// 判定口径与 test/helpers/db.ts 严格一致：变量「存在」即 pg 模式（哪怕空串）。
// 所以这里显式判 undefined——`||=` 会把显式空串悄悄替换成默认地址，让
// 「MIAI_TEST_PG='' 应该报配置错误」的意图静默变成「跑通了真 PG」。
if (process.env.MIAI_TEST_PG === undefined) {
  process.env.MIAI_TEST_PG = 'postgres://postgres@127.0.0.1:54329/postgres';
}
console.log(`[test:pg] MIAI_TEST_PG=${process.env.MIAI_TEST_PG}`);

// 直接以 node 拉起 vitest 的入口（绕开 npx/.cmd：Windows 上 shell 拼命令行既慢又有引号坑）
const require = createRequire(import.meta.url);
const vitestEntry = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const result = spawnSync(process.execPath, [vitestEntry, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exitCode = result.status ?? 1;
