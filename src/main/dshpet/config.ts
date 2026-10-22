import { readFileSync } from 'fs'
import { PET_DSH } from '../../shared/copy'
import type { PetConfig } from '../../shared/types'

/** 设置 schema 真源在 shared/types（设置卡 / 迁移 / config-merge 共用同一份）；这里只转出 */
export { normalizePetConfig } from '../../shared/types'
export type { PetConfig, PetCorner } from '../../shared/types'

/**
 * dsh-pet 桌面模式 · 配置生成（src/main/dshpet/config.ts，2026-10-06）
 *
 * 我们不复刻 dsh-pet 的整套宿主配置体系（用户层/种类层/白名单校验），只做
 * 一件事：把它包内自带的 `assets/config.jsonc` 当**条目级配置（main 条目）**
 * 原样读出来，覆盖上咪爱自己的几个旋钮，然后按宿主契约包一层 `{ main: conf }`
 * 直接喂给渲染端。
 *
 * 【为什么是 { main: conf } 这层壳】渲染端 boot() 拿到 /config 后会自己调
 * S.flattenConfigPets(merged) —— 它的入参就是「按条目名 keyed 的对象」，每个
 * 条目值里有 pets/animations/physics 等字段。包内 config.jsonc 的形状恰好就是
 * 一个条目值，所以壳只需一层，拍平交给渲染端（contract 见 shared-core.js 的
 * flattenConfigPets：entry 级字段会被吹进每只宠物，assetRoot=条目名 'main'）。
 *
 * 【为什么在**每个** GET /config 里重新读盘而不是启动时读一次】文件 25KB，
 * 读一次毫秒级；换来的好处是「改配置不用动代码路径」——重载宠物 = 重启
 * helper 进程，它重新拉 /config 就是新值。少一条缓存失效的暗道。
 *
 * 【JSONC 剥注释为什么不用正则】config.jsonc 的注释文字里出现 `//`（比如
 * URL）并不罕见，正则剥注释会在字符串里挖洞。这里用最小的状态机：字符串态
 * （含转义）优先，其次行注释、块注释。宁少剥不可错剥 —— 错剥的 JSON 解析
 * 失败会当场炸（响亮），但**错剥成合法 JSON** 就会静默喂错配置（危险）。
 */

/** 剥 JSONC 注释（// 与 /* *\/，均在字符串外才生效）。不改动其余字节。 */
export function stripJsonc(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  let inStr = false
  while (i < n) {
    const c = src[i]
    if (inStr) {
      out += c
      if (c === '\\' && i + 1 < n) {
        out += src[i + 1]
        i += 2
        continue
      }
      if (c === '"') inStr = false
      i += 1
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

export function parseJsonc<T>(src: string): T {
  return JSON.parse(stripJsonc(src)) as T
}

/**
 * 把包内 config.jsonc 变成咪爱口径的 `{ main: conf }`（/config 的响应体）。
 *
 * 覆盖点（每一项都有理由，别顺手扩）：
 *  - pets 收敛成单只：id 固定 'main'、display 'desktop'（咪爱只开桌面模式，
 *    没有 web 浮窗那一半）。
 *  - balanceEnabled: **true**（V1-30，2026-10-16 夜 UX 整改。主人裁定
 *    「余额档位用户应该能看见啊？目前不是接了 deepseek 的 API 吗？」）——
 *    宿主现在真的会生产余额数据（菜单「查看余额」→ host.ts 的 refreshBalance
 *    现查 DeepSeek），开着它渲染端才收账：档位动画 + 报账气泡。旧注释里的
 *    「我们零 API」已随聊天/余额两条链作废。
 *  - whisperEnabled: 仍关 —— 它控的是**供应商的自动生成**（周期轮询让宿主
 *    现编一句）；咪爱的碎碎念是自己的节律（brain 的 say 链路 + pet-quips
 *    台词池），开着它等于两个生成器抢同一只气泡。菜单里的手动「听大肥鱼
 *    碎碎念」不走这个开关（见 build/dshpet-patch.mjs 的工具块）。
 *  - workStatusEnabled: 仍关 —— DSH 会话遥测在咪爱没有数据源（host 从不写
 *    workStatus 叶子），菜单树也不再列这个死组（menuEvents 见下）。
 *  - menuEvents: 菜单树**只列有数据源的事件组**（V1-30 的整改：原来
 *    buildMenuTree 遍历全部 events 键、不读任何开关，用户会看到「工作状态」
 *    这种不存在功能的死组）。balance = refreshBalance 会写；whisper = 每次
 *    说话都抽它的动画池（showWhisper 的 pool，say 链路在用）。名单改动只
 *    影响菜单展示，不影响事件路由（路由由上面三个 enabled 各自把门）。
 *  - size/corner 来自咪爱设置；其余 position 字段保留包内默认（margin 是
 *    屏幕边距，主人没提就不动）。
 */
export function buildPetConfig(rawConf: unknown, pet: PetConfig): { main: Record<string, unknown> } {
  if (!rawConf || typeof rawConf !== 'object' || Array.isArray(rawConf)) {
    // 响亮失败：没有包内配置就没有素材池，静默造一份空壳只会让宠物流产成空气。
    // 数组同罪：`[]` 也是 typeof 'object'，放过去的下场是 pets 列表恒空、
    // 精灵落地即无来源 —— 那正是这条 throw 要拦的静默形态。
    throw new Error('dsh-pet: assets/config.jsonc did not parse to an object')
  }
  const conf = JSON.parse(JSON.stringify(rawConf)) as Record<string, unknown>
  const list = Array.isArray(conf.pets) ? (conf.pets as Record<string, unknown>[]) : []
  const base = list[0] && typeof list[0] === 'object' ? list[0] : {}
  const position = (base.position && typeof base.position === 'object' ? base.position : {}) as Record<string, unknown>
  conf.pets = [
    {
      ...base,
      id: 'main',
      // 显示名（宠物元素 title）恒为 copy.ts 的 PET_DSH.NAME（大肥鱼）——
      // 不再沿用包内角色名，理由见那份常量的注释（V1-29 / V2-05）
      name: PET_DSH.NAME,
      size: pet.size,
      display: 'desktop',
      balanceEnabled: true,
      whisperEnabled: false,
      workStatusEnabled: false,
      menuEvents: ['balance', 'whisper'],
      position: { ...position, corner: pet.corner }
    }
  ]
  return { main: conf }
}

/** 从磁盘读包内 config.jsonc 并生成 /config 响应体。读/解析失败一律 throw（响亮）。 */
export function loadPetConfigFile(assetsConfigPath: string, pet: PetConfig): { main: Record<string, unknown> } {
  const src = readFileSync(assetsConfigPath, 'utf8')
  return buildPetConfig(parseJsonc<unknown>(src), pet)
}
