/**
 * 打包后精简 Electron 语言包：只保留中文（简/繁）与英文。
 *
 * 原始 locales 目录有 55 个 .pak、约 49MB；界面语言只有中文，
 * 保留 4 个够用。缺失的 locale 会被 Chromium 自动回退到 en-US，
 * 不会出现空白界面。
 */
const { readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const KEEP = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak'])

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }
  const localesDir = join(context.appOutDir, 'locales')
  let removed = 0
  for (const name of readdirSync(localesDir)) {
    if (name.endsWith('.pak') && !KEEP.has(name)) {
      rmSync(join(localesDir, name))
      removed += 1
    }
  }
  console.log(`[after-pack] locales 精简：移除 ${removed} 个语言包，保留 ${[...KEEP].join(' / ')}`)
}
