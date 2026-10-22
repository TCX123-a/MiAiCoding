/**
 * config.json 合并与裁剪（src/main/store/config-merge.ts）
 *
 * 【这个文件在守什么】
 * 守的是**用户那把 API Key**。它是全项目唯一一个「坏了会直接花用户钱」的字段，
 * 而它坏掉的方式全都是静默的：
 *   - 每保存一次别的设置就被抹掉（用户以为 Key 会自己过期）
 *   - 被原样送到渲染进程（一次 XSS 就没了）
 *   - 粘贴时带上换行，请求头构造失败，报出来却是「连不上网」
 * 这三条都不会崩、不会报错、测试不写就永远不知道。
 *
 * 所以三态各自一条单测，外加一条**全文扫描**（不是查字段名 —— 改个名字就绕过去了）。
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_TIMEOUT_SEC,
  MIN_TIMEOUT_SEC,
  mergeConfigPayload,
  toPublicConfig,
  withPetEnabled
} from '../config-merge'
import {
  DEFAULT_APP_CONFIG,
  defaultPetConfig,
  emptyIdePaths,
  type AppConfig,
  type ConfigSavePayload
} from '../../../shared/types'
import {
  DEFAULT_LAYOUT,
  RIGHT_PANEL_MAX_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_STORE_MIN_SIZE,
  type LayoutConfig
} from '../../../shared/layout'
import { defaultWallpaper } from '../../../shared/wallpaper'
import { defaultSplash } from '../../../shared/splash'

const REAL_KEY = 'sk-0123456789abcdef0123456789abcdef'

function withKey(apiKey: string): AppConfig {
  const c = structuredClone(DEFAULT_APP_CONFIG)
  c.ai.apiKey = apiKey
  return c
}

/**
 * 一份「用户在设置页点了保存」的完整入参。
 *
 * ⚠️ 两个参数**必须分开传**：ai 里的字段走第一个，顶层字段走第二个。
 *
 * 【为什么不合成一个 Partial 一起 spread】试过，它骗过了我自己：
 * 把 `runTimeoutSec` 误传进第一个参数时，它只是变成 `ai` 上一个没人读的属性，
 * 顶层的默认值 10 原封不动 —— 于是「NaN 必须被拦住」那条用例**测试的是 10**，
 * 一直在断言一个根本没被改过的值。测试照跑、照绿，测的却不是我以为的东西。
 * 拆成两个参数之后，TS 的多余属性检查会在 typecheck 阶段就把这种误传顶回来。
 */
function payload(
  ai: Partial<ConfigSavePayload['ai']> = {},
  top: Partial<Omit<ConfigSavePayload, 'ai'>> = {}
): ConfigSavePayload {
  return {
    version: 1,
    reviewEnabled: true,
    runTimeoutSec: 10,
    layout: { ...DEFAULT_LAYOUT },
    envCache: {},
    // 渲染层**恒带全量值**（和 apiKey 相反，理由见 pickIdePaths 的注释）。
    // '' 是它的合法终态（未配置），也是本夹具的起点。v9 起是四键表：
    // 改没改的键每次都必须带上 —— 缺键会被当成「没改」保留旧值。
    nativeIdePaths: emptyIdePaths(),
    // 同 nativeIdePaths：渲染层恒带全量块（设置卡片「松手落盘」时整块提交）
    wallpaper: defaultWallpaper(),
    // 同 wallpaper：开屏块也由渲染层整块提交（v14 起）
    splash: defaultSplash(),
    ...top,
    ai: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', ...ai }
  } as ConfigSavePayload
}

// ---------------------------------------------------------------- Key 不出主进程

describe('toPublicConfig：Key 绝不出现在返回值里', () => {
  it('**全文扫描**：序列化之后哪儿都找不到那把 Key', () => {
    // 只断言 `ai.apiKey === undefined` 是不够的 —— 将来有人加个 `aiKey`、
    // 或者把整个 config 塞进别的字段，字段检查会**放它过去**。
    // 扫全文才拦得住，代价只是这一行。
    const pub = toPublicConfig(withKey(REAL_KEY))
    expect(JSON.stringify(pub)).not.toContain(REAL_KEY)
    expect(JSON.stringify(pub)).not.toContain(REAL_KEY.slice(3, 20))
  })

  it('但界面必须知道「配没配」，否则会一直显示未配置', () => {
    // 抹掉一个字段就得补上界面需要的那一点点信息。少了 hasKey，
    // 用户明明填好了 Key 却看到「未配置」，会以为是自己存失败，反复重填。
    expect(toPublicConfig(withKey(REAL_KEY)).ai.hasKey).toBe(true)
    expect(toPublicConfig(withKey('')).ai.hasKey).toBe(false)
  })

  it('只有空白也算没配 —— 和 deepseek.ts 那边的判断保持一致', () => {
    expect(toPublicConfig(withKey('   ')).ai.hasKey).toBe(false)
  })

  it('该留的一个不少（界面靠这些渲染设置页）', () => {
    const pub = toPublicConfig(withKey(REAL_KEY))
    expect(pub.ai.baseUrl).toBe(DEFAULT_APP_CONFIG.ai.baseUrl)
    expect(pub.ai.model).toBe(DEFAULT_APP_CONFIG.ai.model)
    expect(pub.reviewEnabled).toBe(DEFAULT_APP_CONFIG.reviewEnabled)
    expect(pub.runTimeoutSec).toBe(DEFAULT_APP_CONFIG.runTimeoutSec)
    expect(pub.theme).toBe(DEFAULT_APP_CONFIG.theme)
  })
})

// ---------------------------------------------------------------- 夜间模式
//
// 【这一节守什么】`theme` 是**加在已有配置文件之后**的字段（v3），
// 于是它有两种全新的、且**都不报错**的坏法：
//
//   1. **老配置文件里根本没有它** —— 原样丢给界面的话，渲染进程会把它写成
//      `<html data-theme="undefined">`。而 CSS 选择器是 `:root[data-theme='dark']`，
//      匹配不上，界面**静默停在浅色**。用户看到的是「夜间模式开了跟没开一样」。
//   2. **文件里是个脏字符串**（手改过，或者从别处抄来一个 'Dark'）—— 同上。
//
// 主进程是唯一能拦住这两条的地方：渲染进程那边只有 TypeScript 类型，
// 类型管不住一个从磁盘读进来的字符串。拦住它的就是 `themeName()` 那个白名单。

describe('theme：老配置 / 脏值都必须落在合法主题上', () => {
  it('配置里没有 theme（升级上来的真实场景）→ 给 light，不是 undefined', () => {
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.theme

    expect(toPublicConfig(old as AppConfig).theme).toBe('light')
  })

  it('白名单外的值一律退回 light', () => {
    for (const junk of ['Dark', 'DARK', ' dark ', 'sepia', 'auto', '', 0, null, {}, ['dark']]) {
      const cfg = withKey('')
      cfg.theme = junk as never
      expect(toPublicConfig(cfg).theme).toBe('light')
    }
  })

  it('合法值原样带过去（含 light —— 不能因为「和默认一样」就省掉）', () => {
    const cfg = withKey('')
    cfg.theme = 'dark'
    expect(toPublicConfig(cfg).theme).toBe('dark')
    cfg.theme = 'light'
    expect(toPublicConfig(cfg).theme).toBe('light')
  })
})

describe('theme：保存时也是「空值算不改」那一套', () => {
  it('带 dark → 存成 dark', () => {
    const p = payload()
    p.theme = 'dark'
    expect(mergeConfigPayload(withKey(''), p).theme).toBe('dark')
  })

  it('带 light → 存成 light（用户必须能关掉夜间模式）', () => {
    const current = withKey('')
    current.theme = 'dark'
    const p = payload()
    p.theme = 'light'

    expect(mergeConfigPayload(current, p).theme).toBe('light')
  })

  it('**没带 theme → 保持现有**，不是推回 light', () => {
    // 这条要是写错，代价很隐蔽：改个超时时间、点个音效开关，
    // 界面就从夜间「跳」回白天 —— 因为每一次别的保存都把主题重置了。
    const current = withKey('')
    current.theme = 'dark'

    expect(mergeConfigPayload(current, payload()).theme).toBe('dark')
  })

  it('脏值 → 保持现有，而且**不抛错**', () => {
    // 和 apiKey 那边「非法就抛」的规矩**故意不一样**。
    // 判据是同一条：这个字段坏了会怎样？Key 坏了会花用户的钱，必须拦死；
    // 主题坏了最坏就是颜色不对 —— 为一种颜色把「设置存不进去」端出去，
    // 代价比它防的事大得多。所以这里是退让，不是拒绝。
    const current = withKey('')
    current.theme = 'dark'

    for (const junk of ['Dark', 'sepia', 42, null, {}, ['light']]) {
      const p = payload()
      p.theme = junk as never
      expect(mergeConfigPayload(current, p).theme).toBe('dark')
    }
  })
})

// ---------------------------------------------------------------- 原生模式（极性）
//
// 【这一节守什么】`nativeRunEnabled` 是**方向可能反掉**的字段，而两种反法都不报错：
//
//   1. `toPublicConfig` 里写成 `!== false` —— 和隔壁 soundEnabled 一字之差的
//      「顺手对齐」。它的默认值是 **false**，而 `undefined !== false` 是 **true**：
//      于是每一个**从没打开过这个开关**的用户，界面上的开关都显示为「开着」，
//      点运行就多一个弹窗、机器上的 gcc 被调起来。他找不到原因，因为设置页
//      从来没告诉过他这件事 —— 开关显示的一直是「开」，看起来是他自己开的。
//   2. `mergeConfigPayload` 里把「没带这个字段」和「明确要关掉」混成一件事 ——
//      用户保存一次音量设置，原生模式被悄悄打开/关掉。
//
// 所以下面这几条**必须同时在场**：「缺省是关」单独一条能被写死的 false 骗过去，
// 「亲手开着的留得住」单独一条能被写死的 true 骗过去。两条一起才咬得住。

describe('toPublicConfig：nativeRunEnabled 的极性（本次风险最高的一行）', () => {
  it('★ 配置里**根本没有这个字段** → 给 false，不是 undefined、更不是 true', () => {
    // 这条就是冲着 `!== false` 那个写法来的：`undefined !== false` 是 true，
    // 写错的话这条会红，而且红得指名道姓。
    // 「给 false 而不是 undefined」是另一半：undefined 在设置页那个开关上
    // 渲染成「关着」，看着没事，但一旦有人把它当布尔往下传（`if (cfg.nativeRunEnabled)`），
    // 含义就随 `!` 的个数漂移 —— 交给渲染进程的值必须是确定的布尔。
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.nativeRunEnabled

    const pub = toPublicConfig(old as AppConfig)
    expect(pub.nativeRunEnabled).toBe(false)
    expect(typeof pub.nativeRunEnabled, '必须是布尔，不能是 undefined').toBe('boolean')
  })

  it('亲手打开的（true）原样带过去', () => {
    const cfg = withKey('')
    cfg.nativeRunEnabled = true
    expect(toPublicConfig(cfg).nativeRunEnabled).toBe(true)
  })

  it('**明确关掉的（false）不会被当成「没设置」而翻上去**', () => {
    // 和上面那条配对：只测 true 的话，`=== true` 和 `!== false` 都能绿。
    const cfg = withKey('')
    cfg.nativeRunEnabled = false
    expect(toPublicConfig(cfg).nativeRunEnabled).toBe(false)
  })

  it('脏值（字符串 / 数字 / 对象）一律落成 false —— **不靠真值性判断**', () => {
    // `'false'` 和 `'true'` 都在里面：前者说明「字符串不能靠真值性转」（`Boolean('false')` 是 true），
    // 后者说明「也不能靠内容匹配 —— 我们根本不认字符串」。
    for (const junk of ['true', 'false', 1, 0, {}, [], null, undefined]) {
      const cfg = withKey('')
      cfg.nativeRunEnabled = junk as never
      expect(
        toPublicConfig(cfg).nativeRunEnabled,
        `这个值被读成了 true：${String(junk)}`
      ).toBe(false)
    }
  })
})

describe('mergeConfigPayload：保存时「没带」与「明确关掉」是两件事', () => {
  it('入参没带这个字段 → **保持现有**（开着的不会被一次无关保存关掉）', () => {
    // 用户打开原生模式，然后去改了一下超时时间 —— 这次保存的入参里
    // 理应有 nativeRunEnabled（界面会带上），但**万一没有**（旧渲染层、
    // 或者将来某个新入口忘了拼这个字段），正确的是「别动它」。
    // 打回 false 的话，症状是「开关存不住」，用户会反复去点。
    const current = withKey('')
    current.nativeRunEnabled = true
    expect(mergeConfigPayload(current, payload()).nativeRunEnabled).toBe(true)
  })

  it('现有值是 undefined（老配置漏了迁移）时，缺省落成 **false** 而不是 undefined', () => {
    // 和 toPublicConfig 那条同一个理由的另一半：写盘的值也得是确定的布尔。
    // 留着 undefined 的话，下次读配置时会走 `bool(undefined, false)` —— 结果对，
    // 但中间那段时间里，磁盘上那份配置的语义是没有定义的。
    const current = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete current.nativeRunEnabled
    expect(mergeConfigPayload(current as AppConfig, payload()).nativeRunEnabled).toBe(false)
  })

  it('入参**明确带 false** → 真的能关掉（用户点开关关得掉）', () => {
    // 少了这条，「缺省听现有的」那条能用一个「永远保持现有」的实现骗过去，
    // 而那种实现下用户**关不掉**这个开关 —— 只能改配置文件。
    const current = withKey('')
    current.nativeRunEnabled = true
    const p = payload()
    p.nativeRunEnabled = false
    expect(mergeConfigPayload(current, p).nativeRunEnabled).toBe(false)
  })

  it('入参**明确带 true** → 真的能打开', () => {
    const current = withKey('')
    // 先证明起点是关的：不证明的话，下面那个 true 可能只是「它本来就在」
    expect(mergeConfigPayload(current, payload()).nativeRunEnabled).toBe(false)
    const p = payload()
    p.nativeRunEnabled = true
    expect(mergeConfigPayload(current, p).nativeRunEnabled).toBe(true)
  })

  it('入参里是**非布尔**的脏值 → 当「没带」处理，保持现有（绝不悄悄打开）', () => {
    // `typeof === 'boolean'` 那道判据就是为这条存在的。若改成真值判断，
    // 一个 `'false'`（字符串，真值性为真）会把**关着的**开关打开 ——
    // 这是这一节里最贵的一种反法，因为它连用户的手滑都不需要：
    // 任何一处「带上了但类型不对」的调用都会触发。
    const current = withKey('')
    for (const junk of ['true', 'false', 1, {}, []]) {
      const p = payload()
      p.nativeRunEnabled = junk as never
      expect(
        mergeConfigPayload(current, p).nativeRunEnabled,
        `脏值把开关打开了：${String(junk)}`
      ).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- 不再提醒（极性）
//
// 【这一节守什么】`nativeRunQuiet`（v8 新增）是 nativeRunEnabled 的**同极性兄弟**
// （默认 false），坏法和上一节逐条对应，且都静默：
//   · `toPublicConfig` 写成 `!== false` —— 漏迁移的 undefined 会读成「不再提醒」，
//     用户的弹窗**自己消失**、代码被交给另一个编译器跑；
//   · `mergeConfigPayload` 把缺省读成 true —— 一次无关保存就替用户勾上不再提醒。
// 同极性 ≠ 可以顺手续写：每一处该 `=== true` 的地方都得自己写对。

describe('nativeRunQuiet：同 nativeRunEnabled 的极性（默认 false，`=== true` 才作数）', () => {
  it('★ 配置里**根本没有这个字段** → 给 false（漏迁移 = 继续每次都问，不是静默不问）', () => {
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.nativeRunQuiet

    const pub = toPublicConfig(old as AppConfig)
    expect(pub.nativeRunQuiet).toBe(false)
    expect(typeof pub.nativeRunQuiet, '必须是布尔，不能是 undefined').toBe('boolean')
  })

  it('亲手勾过不再提醒的（true）原样带过去；脏值一律落成 false', () => {
    const cfg = withKey('')
    cfg.nativeRunQuiet = true
    expect(toPublicConfig(cfg).nativeRunQuiet).toBe(true)
    for (const junk of ['true', 'false', 1, 0, {}, [], null, undefined]) {
      const bad = withKey('')
      bad.nativeRunQuiet = junk as never
      expect(toPublicConfig(bad).nativeRunQuiet, `这个值被读成了 true：${String(junk)}`).toBe(false)
    }
  })

  it('保存时**没带**这个字段 → 保持现有（勾过的不会被一次无关保存拨回询问）', () => {
    const current = withKey('')
    current.nativeRunQuiet = true
    expect(mergeConfigPayload(current, payload()).nativeRunQuiet).toBe(true)
  })

  it('现有值是 undefined（老配置漏了迁移）时，缺省落成 **false** 而不是 undefined', () => {
    // 和 nativeRunEnabled 那条同一个理由的另一半（上面 mergeConfigPayload
    // 那节里）：写盘的值必须当场落成确定的布尔。留着 undefined 的话，
    // 下次读配置只是靠 `=== true` 兜底「结果碰巧对」，中间那段时间
    // 磁盘上那份配置的语义是没有定义的。
    const current = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete current.nativeRunQuiet
    expect(mergeConfigPayload(current as AppConfig, payload()).nativeRunQuiet).toBe(false)
  })

  it('保存时**明确带 true / false** → 都听入参的（设置页两个方向都要能拨）', () => {
    // 少了找齐两个方向的这两条，「缺省听现有的」能用一个「永远保持现有」
    // 的实现骗过去 —— 而那种实现下设置页的「每次运行前询问」开关怎么拨都不动。
    const current = withKey('')
    const on = payload()
    on.nativeRunQuiet = true
    expect(mergeConfigPayload(current, on).nativeRunQuiet).toBe(true)

    current.nativeRunQuiet = true
    const off = payload()
    off.nativeRunQuiet = false
    expect(mergeConfigPayload(current, off).nativeRunQuiet).toBe(false)
  })

  it('入参里是**非布尔**的脏值 → 当「没带」处理，**两个方向**都不许被拨动', () => {
    // `typeof === 'boolean'` 那道判据为这条存在：`'false'` 的真值性为真，
    // 靠真值判断的话它会把勾上的不再提醒当成「要打开」—— 连用户手滑都不需要。
    // 反方向也一样要守：脏值不许把已勾上的不再提醒**拨掉**（弹窗会重新冒出来）。
    //
    // ⚠️ 每一轮用**各自新的** current。第一版在循环外复用一个、第一次迭代
    // 末尾把它改成 true，第二轮起「保持现有」保的就是 true —— 断言 false 的那
    // 半边当场红了，红的是判据自己，不是实现。
    for (const junk of ['true', 'false', 1, {}, []]) {
      const off = withKey('')
      const p = payload()
      p.nativeRunQuiet = junk as never
      expect(
        mergeConfigPayload(off, p).nativeRunQuiet,
        `脏值替用户勾上了不再提醒：${String(junk)}`
      ).toBe(false)

      const on = withKey('')
      on.nativeRunQuiet = true
      const p2 = payload()
      p2.nativeRunQuiet = junk as never
      expect(
        mergeConfigPayload(on, p2).nativeRunQuiet,
        `脏值把已勾上的不再提醒拨掉了：${String(junk)}`
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------- 收藏练习答错入错题本
//
// 【这一节守什么】`favWrongToBook`（v6 新增）是个默认 **true** 的开关，
// 它的极性**和 nativeRunEnabled 刚好相反**，而两种写反的后果都是静默的：
//   · 给渲染进程落成 false/undefined —— 设置页那个开关显示成"关着"，
//     用户明明没错过任何东西，却在升级之后发现收藏里错的题一条都没进错题本；
//   · 保存时缺省落成 false —— 一次**无关**的设置保存（改个超时时间）就把
//     用户开着的开关悄悄关了，而且他不会把它和刚才那次保存联系起来。
// 判断的依据只有一条：这个字段的默认值是 true（「软件的性子」），
// 所以每一处取默认值都必须写 `!== false`，一处都错不得。

describe('toPublicConfig：favWrongToBook 的极性（默认是 true，别照抄上一节）', () => {
  it('★ 配置里**根本没有这个字段** → 给 true，不是 undefined、更不是 false', () => {
    // 这条就是冲着 `!== false` 那个写法来的：`undefined !== false` 是 true。
    // 写成 `=== true` 的话这条会红，而且红得指名道姓
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.favWrongToBook

    const pub = toPublicConfig(old as AppConfig)
    expect(pub.favWrongToBook).toBe(true)
    expect(typeof pub.favWrongToBook, '必须是布尔，不能是 undefined').toBe('boolean')
  })

  it('用户**亲手关掉**的（false）原样带过去', () => {
    // 和上面那条配对：只测 true 的话，一个写死的 true 也能绿 ——
    // 而那等于「每次读配置都把用户关掉的开关又打开」
    const cfg = withKey('')
    cfg.favWrongToBook = false
    expect(toPublicConfig(cfg).favWrongToBook).toBe(false)
  })

  it('脏值（字符串 / 数字 / 对象）一律落成 true —— 不靠真值性判断', () => {
    // 'false' 在里面：`Boolean('false')` 是 true，靠真值性转的话它"碰巧"对，
    // 但 `0` / `null` 会翻成 false —— 一个手改坏的值就会把开关关掉
    for (const junk of ['true', 'false', 0, 1, {}, [], null, undefined]) {
      const cfg = withKey('')
      cfg.favWrongToBook = junk as never
      expect(
        toPublicConfig(cfg).favWrongToBook,
        `这个值被读成了 false：${String(junk)}`
      ).toBe(true)
    }
  })
})

describe('mergeConfigPayload：favWrongToBook 保存时「没带」与「明确关掉」是两件事', () => {
  it('入参没带这个字段 → **保持现有**（关着的不会被一次无关保存打开）', () => {
    const current = withKey('')
    current.favWrongToBook = false
    expect(mergeConfigPayload(current, payload()).favWrongToBook).toBe(false)
  })

  it('现有值是 undefined（老配置漏了迁移）时，缺省落成 **true** 而不是 undefined', () => {
    // 这一条是本节风险最高的一行：取现有值时的 `!== false`。
    // 写成 `=== true` 的话，一个「老配置 + 一次无关保存」的组合会把
    // 全应用本来的性子（答错就记）静默关掉
    const current = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete current.favWrongToBook
    expect(mergeConfigPayload(current as AppConfig, payload()).favWrongToBook).toBe(true)
  })

  it('入参**明确带 false** → 真的能关掉（用户点开关关得掉）', () => {
    const current = withKey('')
    const p = payload()
    p.favWrongToBook = false
    expect(mergeConfigPayload(current, p).favWrongToBook).toBe(false)
  })

  it('入参**明确带 true** → 真的能打开', () => {
    const current = withKey('')
    current.favWrongToBook = false
    const p = payload()
    p.favWrongToBook = true
    expect(mergeConfigPayload(current, p).favWrongToBook).toBe(true)
  })

  it('入参里是**非布尔**的脏值 → 当「没带」处理，保持现有', () => {
    // `typeof === 'boolean'` 那道判据就是为这条存在的。若改成真值判断，
    // 一个 `0` 会把开着的开关关掉、一个 `'false'` 也会（真值性为真，
    // 但内容是"假"——两种解释都错，正确做法是根本不认它）
    const on = withKey('')
    const off = withKey('')
    off.favWrongToBook = false
    for (const junk of ['true', 'false', 0, 1, {}, []]) {
      const p1 = payload()
      p1.favWrongToBook = junk as never
      expect(mergeConfigPayload(on, p1).favWrongToBook, `脏值关掉了开关：${String(junk)}`).toBe(true)
      const p2 = payload()
      p2.favWrongToBook = junk as never
      expect(mergeConfigPayload(off, p2).favWrongToBook, `脏值打开了开关：${String(junk)}`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- 音效音量（0~100）
//
// 【这一节守什么】`sfxVolume` 是 v5 新增的字段，它有**两种都不报错**的坏法：
//
//   1. **漏迁移时给渲染进程一个 undefined** —— 它进 `<input type="range">` 是
//      非法值，浏览器回落到**轨道中点**，于是「我的音量自己变成一半了」，
//      关掉重开还是这样，而配置文件里那个字段根本不存在。
//   2. **越界值被原样写进文件** —— 500 会在播放时变成 5 倍增益（一耳朵爆音），
//      写进去之后我们再也改不回来了。这是**写盘前**最后一道。
//
// ⚠️ 还有一条**没有**被上面两条覆盖，所以单独写：「0 是个正经的值」。
// `cfg.sfxVolume || 100` 这种写法下 0 会变成 100（0 是假值），
// 用户每次重启静音都被还回来，而他会以为滑块存不住。

describe('toPublicConfig：sfxVolume 必须是 0~100 的整数', () => {
  it('★ 配置里**根本没有这个字段** → 给 100，不是 undefined', () => {
    // undefined 喂给 range 会落到轨道中点（50），而且**不报错**：
    // 用户看到的是「音量自己变成一半」，重启也还在。
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.sfxVolume

    const pub = toPublicConfig(old as AppConfig)
    expect(pub.sfxVolume).toBe(100)
    expect(typeof pub.sfxVolume, '必须是数字，不能是 undefined').toBe('number')
  })

  it('★ 用户亲手拨到 **0**（静音）的不会被顶成 100', () => {
    const cfg = withKey('')
    cfg.sfxVolume = 0
    expect(toPublicConfig(cfg).sfxVolume).toBe(0)
  })

  it('越界值在交给界面之前就被钳住', () => {
    const cfg = withKey('')
    cfg.sfxVolume = 999
    expect(toPublicConfig(cfg).sfxVolume).toBe(100)
    cfg.sfxVolume = -20
    expect(toPublicConfig(cfg).sfxVolume).toBe(0)
  })

  it('脏值（NaN / 字符串 / 对象）一律落成 100 —— **不靠真值性判断**', () => {
    // 落成 0 的话，一个手改坏的值会让整个软件静默无声，用户只会去查扬声器。
    for (const junk of [Number.NaN, '80', {}, [], null, undefined, Number.POSITIVE_INFINITY]) {
      const cfg = withKey('')
      cfg.sfxVolume = junk as never
      expect(toPublicConfig(cfg).sfxVolume, `这个值没被挡住：${String(junk)}`).toBe(100)
    }
  })
})

describe('mergeConfigPayload：保存音量时「没带」与「拨到 0」是两件事', () => {
  it('入参没带这个字段 → **保持现有**（调到 30 不会被一次无关保存顶回 100）', () => {
    const current = withKey('')
    current.sfxVolume = 30
    expect(mergeConfigPayload(current, payload()).sfxVolume).toBe(30)
  })

  it('★ 现有值是 **0** 时也保持 0（不是被当成「没设置」而回升）', () => {
    // 这条和上一条配对：只测 30 的话，`current.sfxVolume || 100` 也能绿。
    const current = withKey('')
    current.sfxVolume = 0
    expect(mergeConfigPayload(current, payload()).sfxVolume).toBe(0)
  })

  it('入参**明确带 0** → 真的静音（用户拨到底存得住）', () => {
    const current = withKey('')
    const p = payload()
    p.sfxVolume = 0
    expect(mergeConfigPayload(current, p).sfxVolume).toBe(0)
  })

  it('入参带合法值 → 存成它', () => {
    const p = payload()
    p.sfxVolume = 42
    expect(mergeConfigPayload(withKey(''), p).sfxVolume).toBe(42)
  })

  it('入参是**越界值** → 写盘前钳住（写进去就改不回来了）', () => {
    for (const [input, want] of [
      [500, 100],
      [-1, 0],
      [79.6, 80]
    ] as const) {
      const p = payload()
      p.sfxVolume = input
      expect(mergeConfigPayload(withKey(''), p).sfxVolume, `输入 ${input}`).toBe(want)
    }
  })

  it('入参是脏值（NaN / 字符串 / 对象）→ 当「没带」处理，保持现有，**不抛错**', () => {
    // 和 theme 那边同一条规矩：这个字段坏了最坏是音量不对（听得出来、改得回来），
    // 为它让整次保存失败（用户刚改的音效开关也跟着不存）不划算。
    const current = withKey('')
    current.sfxVolume = 55
    for (const junk of [Number.NaN, '60', {}, [], null]) {
      const p = payload()
      p.sfxVolume = junk as never
      expect(mergeConfigPayload(current, p).sfxVolume, `脏值：${String(junk)}`).toBe(55)
    }
  })
})

// ---------------------------------------------------------------- apiKey 三态

describe('apiKey 是三态，不是两态', () => {
  it('① 不传 → 保持原样（只想改别的字段时）', () => {
    const merged = mergeConfigPayload(withKey(REAL_KEY), payload())
    expect(merged.ai.apiKey).toBe(REAL_KEY)
  })

  it('② 空串 → **保持原样**，不是清空', () => {
    // 这是整件事的关键：渲染进程永远不知道真 Key，它保存时必然带回空串。
    // 要是把空串当「用户想清空」，每保存一次别的设置 Key 就没了。
    const merged = mergeConfigPayload(withKey(REAL_KEY), payload({ apiKey: '' }))
    expect(merged.ai.apiKey).toBe(REAL_KEY)
  })

  it('③ null → 真的清空（设置页的「清除 Key」走这条）', () => {
    // 只有 null 这一条路能删 Key。少了它，Key 就永远卡在配置里删不掉。
    const merged = mergeConfigPayload(withKey(REAL_KEY), payload({ apiKey: null }))
    expect(merged.ai.apiKey).toBe('')
  })

  it('④ 新字符串 → 换掉', () => {
    const merged = mergeConfigPayload(withKey('sk-old'), payload({ apiKey: 'sk-new' }))
    expect(merged.ai.apiKey).toBe('sk-new')
  })

  it('从「没配」变成「配了」，hasKey 跟着翻转', () => {
    const merged = mergeConfigPayload(withKey(''), payload({ apiKey: REAL_KEY }))
    expect(toPublicConfig(merged).ai.hasKey).toBe(true)
  })
})

describe('粘贴带空白 / 换行的 Key', () => {
  it('**首尾空白被去掉** —— 带换行的 Key 会让请求头构造直接抛错', () => {
    // 从网页复制 Key 极易连带选中换行。不去掉的话 fetch 在设置 header 时就抛，
    // 而那个异常会被归类成 offline「连不上网」，用户会去查路由器，方向全错。
    const merged = mergeConfigPayload(withKey(''), payload({ apiKey: `  ${REAL_KEY}\n` }))
    expect(merged.ai.apiKey).toBe(REAL_KEY)
  })

  it('全是空白 → 当成「没填」，不是「把 Key 改成一串空格」', () => {
    const merged = mergeConfigPayload(withKey(REAL_KEY), payload({ apiKey: '   \t ' }))
    expect(merged.ai.apiKey).toBe(REAL_KEY)
  })

  it('Key 中间的字符一个都不许动（有些 Key 里就有连字符/下划线）', () => {
    const weird = 'sk-a-b_c.d~e'
    expect(mergeConfigPayload(withKey(''), payload({ apiKey: weird })).ai.apiKey).toBe(weird)
  })
})

// ---------------------------------------------------------------- baseUrl / model

describe('baseUrl 和 model：空值算「没改」', () => {
  it('清空输入框 → 保留原值，不会让请求发到空地址', () => {
    const merged = mergeConfigPayload(withKey(REAL_KEY), payload({ baseUrl: '', model: '' }))
    expect(merged.ai.baseUrl).toBe(DEFAULT_APP_CONFIG.ai.baseUrl)
    expect(merged.ai.model).toBe(DEFAULT_APP_CONFIG.ai.model)
  })

  it('改了就换（用户可能用的是代理 / 别的 OpenAI 兼容服务）', () => {
    const merged = mergeConfigPayload(
      withKey(REAL_KEY),
      payload({ baseUrl: 'https://my-proxy.local/v1', model: 'deepseek-reasoner' })
    )
    expect(merged.ai.baseUrl).toBe('https://my-proxy.local/v1')
    expect(merged.ai.model).toBe('deepseek-reasoner')
  })

  it('首尾空白同样去掉', () => {
    const merged = mergeConfigPayload(
      withKey(REAL_KEY),
      payload({ baseUrl: '  https://api.deepseek.com  ', model: ' deepseek-chat ' })
    )
    expect(merged.ai.baseUrl).toBe('https://api.deepseek.com')
    expect(merged.ai.model).toBe('deepseek-chat')
  })
})

// ---------------------------------------------------------------- 原生 IDE 路径（三态，且方向与上面相反）
//
// 【这一节守什么】`nativeIdePaths`（v9：单个 nativeIdePath 拆成每语言四键）
// 是**全项目唯一「空是合法终态」的文本字段族**，因此它的规矩和隔壁
// pickText **恰好相反**：
//   · pickText（baseUrl / model）：空串 = 「没改」，保留原值；
//   · pickIdePaths（每语言的本地 IDE 路径）：空串 = 「清空该键」，真的删掉。
// 把这个方向写反是**静默毁设置**的一类错，两个方向都要各钉各的：
//   · 这里照抄「空=没改」→ 用户把某门语言的路径删了、点了保存，它又自己回来，
//     而且没有别的路能删掉它（和 apiKey 当初必须补一个 `null` 是同一个教训）；
//   · 反过来把 pickText 也改成「空=清空」→ 用户误清空 baseUrl，保存后连不上网。
// v9 起三态再进一步：**整个表** undefined/null = 四键全保留，**逐键** undefined/null
// = 只保留那一键、其余键照常认空串。所以下面除了单边的几条，还有
// 「同一份载荷里两键方向并存」和「与 baseUrl 并存」两条对照用例。

describe('toPublicConfig：nativeIdePaths 透传，脏值落成空串', () => {
  it('用户配好的四键路径原样带过去（含中文与空格 —— 真实安装路径就这样）', () => {
    const cfg = withKey('')
    cfg.nativeIdePaths = {
      c: 'D:\\Program Files (x86)\\Dev-Cpp\\devcpp.exe',
      cpp: 'D:\\Program Files (x86)\\Dev-Cpp\\devcpp.exe',
      java: 'D:\\tools\\jdk\\bin\\java.exe',
      python: ''
    }
    expect(toPublicConfig(cfg).nativeIdePaths).toEqual(cfg.nativeIdePaths)
  })

  it('老配置漏迁移（undefined）→ 四键全给空串，不是 undefined', () => {
    // undefined 丢给渲染层，设置页那几个输入框绑上去看着像「没配置」（其实是错的），
    // 而渲染层里一句 `.trim()` 就能把整个设置页炸掉。降级成 '' 是**如实**的。
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.nativeIdePaths

    const pub = toPublicConfig(old as AppConfig)
    expect(pub.nativeIdePaths).toEqual(emptyIdePaths())
    for (const v of Object.values(pub.nativeIdePaths)) {
      expect(typeof v, '四键都必须是字符串，不能有 undefined').toBe('string')
    }
  })

  it('整个值脏（数字 / null / 对象 / 数组）→ 四键一并落成空串', () => {
    for (const junk of [42, null, {}, []]) {
      const cfg = withKey('')
      cfg.nativeIdePaths = junk as never
      expect(
        toPublicConfig(cfg).nativeIdePaths,
        `这个值没被挡住：${String(junk)}`
      ).toEqual(emptyIdePaths())
    }
  })

  it('★ 逐键脏值只落那一键，其余键保住（不做「一格坏、全表空」的连坐）', () => {
    // 连坐的坏法很隐蔽：用户只有 java 那格被手改坏，重开设置页却发现
    // C 那格配好的路径也没了。逐键挡、逐键落 '' 才是诚实的。
    const cfg = withKey('')
    cfg.nativeIdePaths = {
      c: 'C:\\tools\\devcpp.exe',
      cpp: 42,
      java: null,
      python: 'C:\\tools\\py.exe'
    } as never
    expect(toPublicConfig(cfg).nativeIdePaths).toEqual({
      c: 'C:\\tools\\devcpp.exe',
      cpp: '',
      java: '',
      python: 'C:\\tools\\py.exe'
    })
  })
})

describe('mergeConfigPayload：nativeIdePaths 三态（★ 与 pickText 方向相反）', () => {
  /** 一份四键都配了值的现配置 */
  function withIde(): AppConfig {
    const c = withKey('')
    c.nativeIdePaths = {
      c: 'C:\\tools\\devcpp.exe',
      cpp: 'C:\\tools\\devcpp.exe',
      java: 'C:\\tools\\idea64.exe',
      python: 'C:\\tools\\pycharm64.exe'
    }
    return c
  }

  it('★ 入参带空串 → **真清空该键**（用户删了路径 / 点了「清除」）', () => {
    // 夹具的默认载荷就带四键全 ''（渲染层恒带全量值）。写反成「空=没改」的话，
    // 用户这辈子都删不掉一个配错的路径 —— 它会一次次自己回来。
    expect(mergeConfigPayload(withIde(), payload()).nativeIdePaths).toEqual(emptyIdePaths())
  })

  it('★ 逐键三态在同一份载荷里并存：空串清空那一键，undefined 保留那一键', () => {
    // 这是四键化之后最容易写错的一条：把三态实现成"整体一次判断"的话，
    // 载荷里只要有任何一键是 undefined，整表就都被当"没改"（或反过来）。
    // 用户此时刚在设置页清掉了 java、没碰过其他三键 —— 只有逐键判断才对。
    const p = payload()
    p.nativeIdePaths = { c: '', cpp: undefined, java: '  D:\\new\\idea64.exe  ' } as never
    const merged = mergeConfigPayload(withIde(), p).nativeIdePaths
    expect(merged, 'c 键空串必须清空、java 新值必须 trim 后生效、cpp 缺键必须保留').toEqual({
      c: '',
      cpp: 'C:\\tools\\devcpp.exe',
      java: 'D:\\new\\idea64.exe',
      python: 'C:\\tools\\pycharm64.exe'
    })
  })

  it('入参**整个字段没带**（undefined）→ 四键全部保持现有', () => {
    // 类型上它是必填，但这里是写盘前的最后一道：测试夹具经 `as` 转换、
    // 或将来某个新调用方漏拼了字段，都可能真的缺。缺字段时猜「清空」
    // 会把配好的四键静默毁掉；听现有的才是安全侧。
    const p = payload()
    delete (p as Partial<ConfigSavePayload>).nativeIdePaths
    expect(mergeConfigPayload(withIde(), p).nativeIdePaths).toEqual(withIde().nativeIdePaths)
  })

  it('入参整个字段是 `null` → 同样四键全保留（undefined 与 null 一套语义）', () => {
    const p = payload()
    p.nativeIdePaths = null as never
    expect(mergeConfigPayload(withIde(), p).nativeIdePaths).toEqual(withIde().nativeIdePaths)
  })

  it('★ 入参整个字段不是对象（数字 / 字符串 / 数组 / 布尔）→ **抛错**', () => {
    // 同 pickText 的非字符串：调用方类型写错了，糊过去只会把 bug 藏起来。
    // 数组特别点一下名：它不是对象（isObject 挡），一个 `[]` 若被当"空表"
    // 处理，会把配置里四键路径静默清光。
    for (const junk of [42, 'oops', [], true]) {
      const p = payload()
      p.nativeIdePaths = junk as never
      expect(() => mergeConfigPayload(withIde(), p), `这个值没被拦住：${String(junk)}`).toThrow()
    }
  })

  it('★ 逐键非字符串 → 抛错（同上，逐键也要挡）', () => {
    for (const junk of [42, {}, [], true]) {
      const p = payload()
      p.nativeIdePaths = { ...emptyIdePaths(), java: junk } as never
      expect(() => mergeConfigPayload(withIde(), p), `java 上的这个值没被拦住：${String(junk)}`).toThrow()
    }
  })

  it('★ 输出是**全新对象**（不能把入参的引用原样带出去）', () => {
    // 带出去的话，落盘后的 config 和渲染层传来那个对象是同一份 ——
    // 下一轮 save() 里有人"顺手改一下"，磁盘上的旧值跟着变，且无处可查。
    const p = payload()
    p.nativeIdePaths = { ...emptyIdePaths(), c: 'C:/new.exe' }
    const merged = mergeConfigPayload(withIde(), p)
    expect(merged.nativeIdePaths).toEqual(p.nativeIdePaths)
    expect(merged.nativeIdePaths, '必须是新对象，不是入参引用').not.toBe(p.nativeIdePaths)
  })

  it('★ 和 baseUrl 的对照：同一份载荷里，空串对两者**方向相反**', () => {
    // 这条把「两套规矩并存」钉在同一个断言里：谁将来想「统一」成一种，
    // 无论改成哪种，这条都会红 —— 而只测单边的用例拦不住那种统一。
    const p = payload({ baseUrl: '' }, { nativeIdePaths: { ...emptyIdePaths(), java: '' } })

    const merged = mergeConfigPayload(withIde(), p)
    expect(merged.nativeIdePaths.java, 'java 路径的空串必须清空').toBe('')
    expect(merged.ai.baseUrl, 'baseUrl 的空串必须保留原值').toBe(DEFAULT_APP_CONFIG.ai.baseUrl)
  })

  it('回环幂等：渲染层把读到的值原样存回来，一个字节都不变', () => {
    // 真调用点就是这样走一圈的：toPublicConfig 读出去 → 用户没碰 →
    // save() 原样带回。带空格和中文的路径在这条路上不许被 trim 坏、
    // 也不许被当成「空」清掉。
    const cur = withIde()
    const p = payload({}, { nativeIdePaths: toPublicConfig(cur).nativeIdePaths })

    expect(mergeConfigPayload(cur, p).nativeIdePaths).toEqual(cur.nativeIdePaths)
  })
})

// ---------------------------------------------------------------- 壁纸设置块（v10）
//
// 【这一节守什么】`wallpaper` 是又一个「加在已有配置文件之后」的整块字段，
// 坏法和 layout 一族完全同构：老配置里没有它（丢给界面就是 undefined）、
// 拖坏的滑杆值（NaN/越界）落盘、以及**整块**的缺失语义（听现有的，不是重置）。
// 子键级的三态**刻意不做**（和 layout 一样整块认）：渲染层恒带全量块，
// 缺键只可能是我们自己的 bug，这时听现有的才是安全侧。

describe('toPublicConfig：wallpaper 老配置 / 脏值都落成完整块', () => {
  it('老配置没有这一节 → 补出完整默认块（2026-10-17 分享版起默认关、没选、失焦全停）', () => {
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.wallpaper

    const got = toPublicConfig(old as AppConfig).wallpaper
    expect(got).toEqual(defaultWallpaper())
    expect(got.enabled).toBe(false)
    expect(got.power.pauseOnBlur).toBe(true)
  })

  it('用户调过的值原样带过去（含子块里的）', () => {
    const cfg = withKey('')
    cfg.wallpaper = defaultWallpaper()
    cfg.wallpaper.dim = 60
    cfg.wallpaper.selectedId = '3284636810'
    cfg.wallpaper.power.pauseOnBlur = false

    const got = toPublicConfig(cfg).wallpaper
    expect(got.dim).toBe(60)
    expect(got.selectedId).toBe('3284636810')
    expect(got.power.pauseOnBlur).toBe(false)
  })

  it('整块是脏类型 → 完整默认块，不炸、不把 undefined 丢给界面', () => {
    for (const junk of [null, 'wp', 42, []]) {
      const cfg = withKey('')
      cfg.wallpaper = junk as never
      expect(toPublicConfig(cfg).wallpaper, `这个值没被挡住：${String(junk)}`).toEqual(defaultWallpaper())
    }
  })
})

describe('mergeConfigPayload：wallpaper 整块语义 + 写盘前钳位', () => {
  it('入参带全量块 → 采纳；越界值在写盘前被钳住', () => {
    // NaN 和越界各自是两条路：NaN 退默认、真数字钳端点（细节在
    // shared/wallpaper 的单测里逐字段钉过，这里只证明**写盘这条路真的挂了闸**）。
    const p = payload()
    p.wallpaper = { ...defaultWallpaper(), dim: 999, blur: NaN, volume: 80 }
    const got = mergeConfigPayload(withKey(''), p).wallpaper
    expect(got.dim).toBe(100)
    expect(got.blur).toBe(0)
    expect(got.volume).toBe(80)
  })

  it('入参整块没带（undefined）→ 听现有的，**不是重置成默认**', () => {
    // 类型上它是必填，但这里是写盘前最后一道：夹具经 `as`、新调用方漏拼
    // 都可能真的缺。缺了猜「重置」会把用户调好的 dim/selectedId 静默洗掉。
    const cur = withKey('')
    cur.wallpaper = defaultWallpaper()
    cur.wallpaper.dim = 60
    cur.wallpaper.selectedId = '3284636810'

    const p = payload()
    delete (p as Partial<ConfigSavePayload>).wallpaper
    const got = mergeConfigPayload(cur, p).wallpaper
    expect(got.dim).toBe(60)
    expect(got.selectedId).toBe('3284636810')
  })

  it('输出是**全新对象**（连子块都不是入参那份）', () => {
    const p = payload()
    p.wallpaper = defaultWallpaper()
    p.wallpaper.dim = 42
    const got = mergeConfigPayload(withKey(''), p).wallpaper
    expect(got.dim).toBe(42)
    expect(got).not.toBe(p.wallpaper)
    expect(got.power).not.toBe(p.wallpaper.power)
  })

  it('回环幂等：读出去再原样存回来，一个字节都不变', () => {
    const cur = withKey('')
    cur.wallpaper = defaultWallpaper()
    cur.wallpaper.dim = 47
    cur.wallpaper.parallax.amount = 7

    const p = payload()
    p.wallpaper = toPublicConfig(cur).wallpaper
    expect(mergeConfigPayload(cur, p).wallpaper).toEqual(cur.wallpaper)
  })
})

// ---------------------------------------------------------------- 开屏设置块（v14）
//
// 【这一节守什么】`splash` 是第三个「加在已有配置文件之后」的整块字段，
// 坏法和 wallpaper 同构：老配置里没有它（丢给界面就是 undefined）、
// 拖坏的滑杆值落盘（音量 NaN 写进 JSON 会变成 null，下次读回又是个新麻烦）、
// 以及**整块**的缺失语义（听现有的，不是重置）。子键级三态同样刻意不做 ——
// 渲染层恒带全量块，缺键只可能是我们自己的 bug，听现有的才是安全侧。
//
// ⚠️ 和 wallpaper 的差异只有一处：开屏块里全是扁平字段（无子块），
// 「整树新造」的检查对象从子块换成了池子数组。

describe('toPublicConfig：splash 老配置 / 脏值都落成完整块', () => {
  it('老配置没有这一节 → 补出完整默认块（2026-10-17 分享版起默认关、随机、静音）', () => {
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.splash

    const got = toPublicConfig(old as AppConfig).splash
    expect(got).toEqual(defaultSplash())
    expect(got.enabled).toBe(false)
    expect(got.pick).toBe('random')
    expect(got.sound).toBe(false)
  })

  it('用户调过的值原样带过去（含池子、不透明兜底、假值 enabled:false）', () => {
    const cfg = withKey('')
    cfg.splash = defaultSplash()
    cfg.splash.enabled = false
    cfg.splash.pick = 'fixed'
    cfg.splash.fixedFile = 'lxj-1.mp4'
    cfg.splash.pool = ['lxj-1.mp4', 'nd-brand.mp4']
    cfg.splash.volume = 35
    cfg.splash.opaque = true

    const got = toPublicConfig(cfg).splash
    expect(got.enabled).toBe(false)
    expect(got.fixedFile).toBe('lxj-1.mp4')
    expect(got.pool).toEqual(['lxj-1.mp4', 'nd-brand.mp4'])
    expect(got.volume).toBe(35)
    expect(got.opaque).toBe(true)
  })

  it('整块是脏类型 → 完整默认块，不炸、不把 undefined 丢给界面', () => {
    for (const junk of [null, 'sp', 42, []]) {
      const cfg = withKey('')
      cfg.splash = junk as never
      expect(toPublicConfig(cfg).splash, `这个值没被挡住：${String(junk)}`).toEqual(defaultSplash())
    }
  })
})

describe('mergeConfigPayload：splash 整块语义 + 写盘前钳位', () => {
  it('入参带全量块 → 采纳；越界值在写盘前被钳住', () => {
    // 三条路各走一遍：真数字钳端点（上/下）、NaN 退默认 —— 后者最要紧，
    // NaN 写进 JSON 会变 null，下次启动读回来又是一个我们没设计过的值。
    const p = payload()
    p.splash = { ...defaultSplash(), volume: 999 }
    expect(mergeConfigPayload(withKey(''), p).splash.volume).toBe(100)
    p.splash = { ...defaultSplash(), volume: -5 }
    expect(mergeConfigPayload(withKey(''), p).splash.volume).toBe(0)
    p.splash = { ...defaultSplash(), sound: true, volume: NaN }
    const got = mergeConfigPayload(withKey(''), p).splash
    expect(Number.isFinite(got.volume)).toBe(true)
    expect(got.volume).toBe(defaultSplash().volume)
    expect(got.sound).toBe(true) // 同一次归一里别的合法值不受连累
  })

  it('入参整块没带（undefined）→ 听现有的，**不是重置成默认**', () => {
    // 类型上它是必填，但这里是写盘前最后一道：夹具经 `as`、新调用方漏拼
    // 都可能真的缺。缺了猜「重置」会把用户关掉的开屏/调好的音量静默洗掉。
    const cur = withKey('')
    cur.splash = defaultSplash()
    cur.splash.enabled = false
    cur.splash.fixedFile = 'lxj-1.mp4'
    cur.splash.volume = 30

    const p = payload()
    delete (p as Partial<ConfigSavePayload>).splash
    const got = mergeConfigPayload(cur, p).splash
    expect(got.enabled).toBe(false)
    expect(got.fixedFile).toBe('lxj-1.mp4')
    expect(got.volume).toBe(30)
  })

  it('输出是**全新对象**（池子数组也不是入参那份）', () => {
    const p = payload()
    p.splash = defaultSplash()
    p.splash.pool = ['a.mp4']
    const got = mergeConfigPayload(withKey(''), p).splash
    expect(got.pool).toEqual(['a.mp4'])
    expect(got).not.toBe(p.splash)
    expect(got.pool).not.toBe(p.splash.pool)
  })

  it('回环幂等：读出去再原样存回来，一个字节都不变', () => {
    const cur = withKey('')
    cur.splash = defaultSplash()
    cur.splash.pick = 'fixed'
    cur.splash.fixedFile = 'nd-brand.mp4'
    cur.splash.pool = ['nd-brand.mp4', 'lxj-1.mp4']
    cur.splash.sound = true
    cur.splash.volume = 60

    const p = payload()
    p.splash = toPublicConfig(cur).splash
    expect(mergeConfigPayload(cur, p).splash).toEqual(cur.splash)
  })
})

// ---------------------------------------------------------------- envCache 不回退

describe('envCache 只认主进程那份', () => {
  it('**渲染进程带着旧缓存来保存，不会把新缓存顶掉**', () => {
    // 场景：用户开着设置页放了一会儿，这期间后台检测刷新了缓存，
    // 他再点保存 → 用旧快照覆盖 → 「刚检测出来的编译器又变成没装」。
    // 这类回退极难复现，所以在这里钉死。
    const current = structuredClone(DEFAULT_APP_CONFIG)
    current.envCache = { at: '2026-09-13T10:00:00.000Z', report: {} as never }

    const stale = payload()
    stale.envCache = { at: '2020-01-01T00:00:00.000Z', report: {} as never }

    expect(mergeConfigPayload(current, stale).envCache).toBe(current.envCache)
  })
})

// ---------------------------------------------------------------- 超时钳位

describe('runTimeoutSec 会被钳进合法区间', () => {
  it.each([
    [0, MIN_TIMEOUT_SEC],
    [-5, MIN_TIMEOUT_SEC],
    [9999, MAX_TIMEOUT_SEC],
    [10.6, 11],
    [10.4, 10]
  ])('%i 秒 → %i 秒', (input, expected) => {
    expect(mergeConfigPayload(withKey(''), payload({}, { runTimeoutSec: input })).runTimeoutSec).toBe(
      expected
    )
  })

  it('**NaN 必须被拦住** —— 它能穿过 runner 那道 clamp，表现为每次运行都被瞬间掐死', () => {
    // Math.min(Math.max(NaN, 1), 60) === NaN，setTimeout(fn, NaN) 当成 0 毫秒。
    // 报出来的却是「超时」，指向完全错误的方向。
    expect(() => mergeConfigPayload(withKey(''), payload({}, { runTimeoutSec: NaN }))).toThrow()
  })

  it('Infinity 同样拦住', () => {
    expect(() => mergeConfigPayload(withKey(''), payload({}, { runTimeoutSec: Infinity }))).toThrow()
  })
})

// ---------------------------------------------------------------- 坏入参

describe('入参非法就抛错，而且一个字节都不写', () => {
  const bad: [string, unknown][] = [
    ['整个是 null', null],
    ['整个是字符串', 'config'],
    ['ai 没了', { version: 1, reviewEnabled: true, runTimeoutSec: 10 }],
    ['reviewEnabled 不是布尔', { version: 1, reviewEnabled: 'yes', runTimeoutSec: 10, ai: {} }],
    ['runTimeoutSec 是字符串', { version: 1, reviewEnabled: true, runTimeoutSec: '10', ai: {} }],
    ['baseUrl 不是字符串', { version: 1, reviewEnabled: true, runTimeoutSec: 10, ai: { baseUrl: 42 } }],
    ['model 是对象', { version: 1, reviewEnabled: true, runTimeoutSec: 10, ai: { model: {} } }]
  ]

  it.each(bad)('%s → 抛错', (_name, input) => {
    expect(() => mergeConfigPayload(withKey(REAL_KEY), input as ConfigSavePayload)).toThrow()
  })

  it('version 听现有的，渲染进程改不动（迁移逻辑的钥匙不交出去）', () => {
    const current = withKey(REAL_KEY)
    current.version = 7
    const p = payload()
    p.version = 1
    expect(mergeConfigPayload(current, p).version).toBe(7)
  })

  it('合并是**纯**的：不改传入的那个 current', () => {
    const current = withKey('sk-old')
    mergeConfigPayload(current, payload({ apiKey: null }))
    expect(current.ai.apiKey).toBe('sk-old')
  })
})

// ---------------------------------------------------------------- 三栏布局
//
// 【这一节守什么】
// `layout` 是**加在已有配置文件之后**的一个字段，所以它有两种全新的坏法，
// 而且两种都不报错：
//   1. **老配置文件里根本没有这一节** —— 直接抛给界面就是一个 undefined，
//      App.vue 拿它算 pane 尺寸会炸在启动那一步（白屏）。
//   2. **尺寸被写坏** —— 越界或 NaN 一旦落盘就改不回来了，
//      而 NaN 会变成 `width: NaN%`，那一栏直接塌成 0。

describe('layout：老配置文件里没有这一节，必须能自己补齐', () => {
  it('**整节缺失（升级上来的真实场景）→ 补默认值，而不是原样丢给界面**', () => {
    // 主人机器上的 config.json 是加 layout 之前写下的。
    // json-store 的 read() 只在「整个文件不存在」时返回 null，**不做字段级兜底**，
    // 所以这里拿到的就是 undefined —— 少了这一步，升级后第一次启动就是白屏，
    // 而且开发机（配置是新的）永远复现不了。
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete old.layout

    expect(toPublicConfig(old as AppConfig).layout).toEqual(DEFAULT_LAYOUT)
  })

  it('只缺其中一个字段也补（不是整节丢弃）', () => {
    const cfg = withKey('')
    cfg.layout = { sidebarSize: 25 } as LayoutConfig

    const got = toPublicConfig(cfg).layout
    expect(got.sidebarSize).toBe(25) // 用户拖过的值保住
    expect(got.rightPanelSize).toBe(DEFAULT_LAYOUT.rightPanelSize)
    expect(got.rightPanelOpen).toBe(DEFAULT_LAYOUT.rightPanelOpen)
  })

  it('整个是 null / 字符串 / 数字也不炸', () => {
    for (const junk of [null, 'layout', 42, []]) {
      const cfg = withKey('')
      cfg.layout = junk as unknown as LayoutConfig
      expect(toPublicConfig(cfg).layout).toEqual(DEFAULT_LAYOUT)
    }
  })
})

describe('layout：越界值在写盘前被钳住', () => {
  const merge = (layout: unknown) =>
    mergeConfigPayload(withKey(''), payload({}, { layout: layout as LayoutConfig })).layout

  it.each([
    ['拖过头（比上限还大）', 999, SIDEBAR_MAX_SIZE],
    // 下限用 STORE 那个 11，不是拖拽下限 0：这里是**写盘口**，拖拽途中的
    // 小值到不了这儿（松手 ≤10 走折叠、不写宽度），会落盘的都是
    // 「下次照此打开」的值 —— 和右栏同一套（2026-10-04 起左栏同罪同罚）。
    ['拖过头（比落盘下限还小）', -5, SIDEBAR_STORE_MIN_SIZE],
    ['刚好卡在上限', SIDEBAR_MAX_SIZE, SIDEBAR_MAX_SIZE],
    ['恰好落在落盘下限', SIDEBAR_STORE_MIN_SIZE, SIDEBAR_STORE_MIN_SIZE]
  ])('sidebarSize %s → 钳进合法区间', (_name, input, want) => {
    expect(merge({ ...DEFAULT_LAYOUT, sidebarSize: input }).sidebarSize).toBe(want)
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['字符串', '20' as unknown as number],
    ['null', null as unknown as number],
    ['undefined', undefined as unknown as number]
  ])('sidebarSize 是 %s → 退回默认，**不是写进文件**', (_name, input) => {
    // NaN 特别要点名：它能穿过 `Math.min(Math.max(...))`（和谁比都是 false），
    // 于是被原样写进配置，之后 `width: NaN%` 让那一栏塌成 0 —— 而文件已经改不回来了。
    // 同一个坑 runTimeoutSec 那边已经踩过一次。
    expect(merge({ ...DEFAULT_LAYOUT, sidebarSize: input }).sidebarSize).toBe(DEFAULT_LAYOUT.sidebarSize)
  })

  it('右栏宽度走同一道钳位（不是只防了左栏）', () => {
    expect(merge({ ...DEFAULT_LAYOUT, rightPanelSize: 999 }).rightPanelSize).toBe(RIGHT_PANEL_MAX_SIZE)
  })

  it('rightPanelOpen 不是布尔 → 退回默认，**不是被当成 false**', () => {
    // 「当成 false」的话，一次数据意外就把用户的右栏关掉了 —— 而且是静默关掉，
    // 他下次打开只看到面板没了，不知道跟升级有关。
    for (const junk of ['yes', 0, 1, null, undefined]) {
      expect(merge({ ...DEFAULT_LAYOUT, rightPanelOpen: junk }).rightPanelOpen).toBe(
        DEFAULT_LAYOUT.rightPanelOpen
      )
    }
  })

  it('sidebarOpen 不是布尔 → 兜底成 true（与右栏同方向，绝不替用户关上）', () => {
    // 复刻上一条的判据，只是换到左栏：v10 及以前写下的配置里没有这个字段，
    // 兜底方向一旦写反，升级完用户的左栏会整个消失，而文件里没有任何
    // 「被关掉过」的痕迹。
    for (const junk of ['yes', 0, 1, null, undefined]) {
      expect(merge({ ...DEFAULT_LAYOUT, sidebarOpen: junk }).sidebarOpen).toBe(
        DEFAULT_LAYOUT.sidebarOpen
      )
    }
  })
})

describe('layout：收起右栏不许碰到宽度', () => {
  it('**只改 rightPanelOpen，两个宽度一个字节都不动**', () => {
    const cur = withKey('')
    cur.layout = {
      sidebarSize: 26,
      sidebarOpen: true,
      sidebarRail: false,
      rightPanelSize: 19,
      rightPanelOpen: true
    }

    const got = mergeConfigPayload(cur, payload({}, { layout: { ...cur.layout, rightPanelOpen: false } }))
    expect(got.layout).toEqual({
      sidebarSize: 26,
      sidebarOpen: true,
      sidebarRail: false,
      rightPanelSize: 19,
      rightPanelOpen: false
    })
  })

  it('入参整节没带 layout → 听现有的（和「空值算没改」是同一套规矩）', () => {
    const cur = withKey('')
    cur.layout = {
      sidebarSize: 26,
      sidebarOpen: true,
      sidebarRail: false,
      rightPanelSize: 19,
      rightPanelOpen: false
    }

    const p = payload()
    delete (p as Partial<ConfigSavePayload>).layout
    expect(mergeConfigPayload(cur, p).layout).toEqual(cur.layout)
  })

  it('**同一天拖来拖去是幂等的** —— 存一次回来一模一样，不会越存越偏', () => {
    let cur = withKey('')
    for (let i = 0; i < 5; i++) {
      cur = mergeConfigPayload(cur, payload({}, { layout: { ...cur.layout, sidebarSize: 21.4 } }))
    }
    expect(cur.layout.sidebarSize).toBe(21.4)
  })
})

// ---------------------------------------------------------------- 主进程自发开关桌宠（withPetEnabled）

/*
 * 【这一节守什么】右键菜单「关闭大肥鱼」→ 宿主 → app.ts 调 withPetEnabled，
 * 这是**主进程自己**改配置的唯一入口（不走渲染层的 config:save 载荷）。
 * 它坏掉的方式都不报错：
 *   - 顺手改到别处（把 Key 抹了 / 主题顶回默认）→ 菜单关个宠物，用户一片设置
 *     跟着变，而且没有任何界面动作能把这两件事联系起来；
 *   - 原地改 current（返回旧引用）→ 写盘这次是对的，但内存里那份"现有配置"
 *     也变了，合并链上后续拿到的就成了一只脚踩进去的共享对象。
 */

describe('withPetEnabled：主进程自发开关桌宠，别的一律不动', () => {
  it('关掉 → pet.enabled 落 false，pet 其余字段与顶层字段原值全保', () => {
    const cur = withKey(REAL_KEY)
    cur.pet = { enabled: true, size: 300, corner: 'top-left', followMouse: false, hungryRoam: false }
    cur.theme = 'dark'

    const got = withPetEnabled(cur, false)
    expect(got.pet).toEqual({
      enabled: false,
      size: 300,
      corner: 'top-left',
      followMouse: false,
      hungryRoam: false
    })
    expect(got.theme).toBe('dark')
    // 这个文件的主线（见文件头）：无论从哪条路改配置，Key 都不许被动
    expect(got.ai.apiKey).toBe(REAL_KEY)
  })

  it('★ 整树新造：不原地改 current，pet 也不是同一个引用', () => {
    const cur = withKey('')
    const got = withPetEnabled(cur, false)
    expect(cur.pet.enabled).toBe(true) // 原对象一个字节没动
    expect(got.pet).not.toBe(cur.pet)
    expect(got).not.toBe(cur)
  })

  it('开回来（true）是另一条方向，也照样只动这一个键', () => {
    const cur = withKey('')
    cur.pet = { ...cur.pet, enabled: false }
    const got = withPetEnabled(cur, true)
    expect(got.pet.enabled).toBe(true)
  })

  it('历史文件里 pet 只剩开关 → 写盘前补齐成完整块（normalizePetConfig 管住这一道）', () => {
    const cur = withKey('')
    ;(cur as unknown as { pet: unknown }).pet = { enabled: false }
    const got = withPetEnabled(cur, true)
    expect(got.pet).toEqual(defaultPetConfig())
  })
})

// ---------------------------------------------------------------- AI 动态出题（极性）

/**
 * 【这一节守什么】`ai.dynamicEnabled`（v20）默认 **false**，它决定用户会不会
 * 在不知情的情况下花自己的 Token。坏法与 nativeRunEnabled 一模一样：
 *
 *   1. `toPublicConfig` 写成 `!== false` —— 老配置里是 undefined，界面开关
 *      会显示成「开着」，用户以为是自己开的，于是每天挑战都在扣钱。
 *   2. `mergeConfigPayload` 把「没带」当成「关掉」—— 用户改一次模型名，
 *      刚打开的开关就自己关了（症状是「开关存不住」）。
 *
 * 两条必须同时在：只测缺省会被写死的 false 骗过，只测保留会被写死的 true 骗过。
 */
describe('ai.dynamicEnabled：默认关，且保存别的字段不能把它冲掉', () => {
  it('★ 配置里没有这个字段（老配置漏迁移）→ false，且必须是确定的布尔', () => {
    const old = structuredClone(DEFAULT_APP_CONFIG) as Partial<AppConfig>
    delete (old.ai as Partial<AppConfig['ai']>).dynamicEnabled
    const pub = toPublicConfig(old as AppConfig)
    expect(pub.ai.dynamicEnabled).toBe(false)
    expect(typeof pub.ai.dynamicEnabled).toBe('boolean')
  })

  it('亲手打开的 true 原样带过去；明确关掉的 false 也不会被翻上去', () => {
    const on = withKey('')
    on.ai.dynamicEnabled = true
    expect(toPublicConfig(on).ai.dynamicEnabled).toBe(true)

    const off = withKey('')
    off.ai.dynamicEnabled = false
    expect(toPublicConfig(off).ai.dynamicEnabled).toBe(false)
  })

  it('脏值（字符串 / 数字 / 对象）一律落成 false，不靠真值性判断', () => {
    for (const junk of ['true', 'false', 1, 0, {}, [], null, undefined]) {
      const cfg = withKey('')
      cfg.ai.dynamicEnabled = junk as never
      expect(
        toPublicConfig(cfg).ai.dynamicEnabled,
        `这个值被读成了 true：${String(junk)}`
      ).toBe(false)
    }
  })

  it('保存入参没带这个字段 → 保持现有（改模型名不会顺手关掉它）', () => {
    const current = withKey('')
    current.ai.dynamicEnabled = true
    expect(mergeConfigPayload(current, payload()).ai.dynamicEnabled).toBe(true)
  })

  it('保存入参明确带 true / false → 真的能开关', () => {
    const current = withKey('')
    const on = payload()
    on.ai.dynamicEnabled = true
    expect(mergeConfigPayload(current, on).ai.dynamicEnabled).toBe(true)

    const off = payload()
    off.ai.dynamicEnabled = false
    expect(mergeConfigPayload(current, off).ai.dynamicEnabled).toBe(false)
  })

  it('入参里是非布尔的脏值 → 当「没带」处理，绝不悄悄打开', () => {
    const current = withKey('')
    current.ai.dynamicEnabled = false
    for (const junk of ['true', 'false', 1, {}, []]) {
      const p = payload()
      p.ai.dynamicEnabled = junk as never
      expect(
        mergeConfigPayload(current, p).ai.dynamicEnabled,
        `脏值把开关打开了：${String(junk)}`
      ).toBe(false)
    }
  })
})
