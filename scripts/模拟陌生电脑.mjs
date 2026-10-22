/**
 * 陌生电脑模拟器 —— 「明明装了却说没装」的回归台。
 *
 * 【为什么需要它】
 * 2026-09-17 主人的朋友装了 Java + Python，软件的检测找不到 Java、
 * Python 一跑就报错、点「重新检测」还没反应。复盘发现：
 * **这类 bug 在开发机上永远测不出来** —— 开发机的编译器早在 PATH 里了，
 * 兜底分支一次都不走。朋友那台机器上却是「装在 D 盘、不在 PATH、还夹着
 * Microsoft Store 的空壳别名」，全是开发机上不存在的条件。
 *
 * 所以把「朋友的电脑」拆成一条条可复现的断言，放在
 * `src/main/env/__tests__/foreign-pc.test.ts` 里；
 * 本脚本是它的**可运行入口**，把结果打成人看得懂的样子。
 *
 * ⚠️ 场景和断言只在那个测试文件里写一份。本脚本不复制任何判断逻辑 ——
 * 两份逻辑迟早会走岔，到时候脚本绿着、真实检测已经坏了。
 *
 * 用法：node scripts/模拟陌生电脑.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SUITE = 'src/main/env/__tests__/foreign-pc.test.ts'

/**
 * 直接跑 vitest 的入口脚本，**不经过 npx / .cmd**。
 * Node 修掉那个 .cmd 相关的 CVE 之后，`spawn('npx.cmd', ..., {shell:false})`
 * 会直接 ENOENT —— 而它的表现是非零退出码 + 零输出，看起来就像「模拟失败了」，
 * 排查方向会被带偏到检测逻辑上去。
 */
const VITEST = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))

console.log('')
console.log('  陌生电脑模拟器 —— 验证「装了编译器却检测不到」不再发生')
console.log('  ' + '─'.repeat(66))
console.log('')
console.log('  模拟的场景：')
console.log('    · 编译器装在 D 盘（非默认盘、不在 PATH 里）')
console.log('    · 装了多个版本，排在前面的那个是坏的')
console.log('    · PATH 里躺着 Microsoft Store 的空壳别名（which 命中但跑不起来）')
console.log('    · PATH 里躺着 0 字节的假 exe（下载中断 / 装到一半取消）')
console.log('    · 编译器是应用启动之后才装的（只进了注册表，没进进程 PATH）')
console.log('    · 各家 JDK 发行版 / Anaconda / scoop 的安装落点')
console.log('    · 装了 Dev-C++：工具链在 Program Files (x86) 下、不在 PATH 里，且版本是老的（TDM-GCC 4.9.2）')
console.log('    · IDE 装在任意位置：从注册表卸载项里认出安装根（Dev-C++ 那条连 InstallLocation 都没有）')
console.log('')

if (!existsSync(VITEST)) {
  console.error(`  找不到 vitest：${VITEST}`)
  console.error('  先在项目根目录跑一次 npm install。')
  process.exit(1)
}

const r = spawnSync(process.execPath, [VITEST, 'run', SUITE, '--reporter=verbose'], {
  stdio: 'inherit'
})

console.log('')
if (r.status === 0) {
  console.log('  ✅ 全部通过：上面每一种「朋友的电脑」都能正确检测出编译器。')
  console.log('')
  process.exit(0)
} else {
  console.log('  ❌ 有场景失败了 —— 检测逻辑对那种电脑不管用，别拿去分享。')
  console.log('')
  process.exit(r.status ?? 1)
}
