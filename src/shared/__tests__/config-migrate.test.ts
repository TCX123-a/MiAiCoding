/**
 * config.json 的版本迁移（src/shared/config-migrate.ts）
 *
 * 【这个文件在守什么】
 * 迁移的输入是「**别人硬盘上那份我们没见过、也不该假设的**文件」，
 * 而它的失败方式几乎全是静默的 —— 没有崩溃、没有报错，只是某个设置悄悄变了样：
 *
 *   1. **Api Key 被抹掉**。用户在 DeepSeek 后台生成的 Key 只显示一次，
 *      丢了就得重新生成一把。而界面上 Key 那一栏**永远是空的**（设计如此，
 *      真 Key 只存在主进程），所以他**看不出是被我们弄丢的** ——
 *      只会觉得「这软件怎么老要重填」。
 *   2. **老配置读出来 `soundEnabled` 是 undefined**。`undefined` 在 `if` 里是假，
 *      于是**升级上来的老用户一开就是静音**，还找不到原因（开关显示是勾上的，
 *      因为复选框对 undefined 的处理是「不勾」…… 两处不一致时更好看）。
 *   3. **version 没被写上去**。那样每次读配置都得重迁一遍，
 *      而且事后分不出磁盘上那份是哪个年代的。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it, vi } from 'vitest'
import { MAX_TIMEOUT_SEC, MIN_TIMEOUT_SEC, migrateConfig } from '../config-migrate'
import {
  CURRENT_CONFIG_VERSION,
  DEFAULT_APP_CONFIG,
  defaultPetConfig,
  emptyIdePaths,
  type AppConfig
} from '../types'
import { defaultSplash } from '../splash'

/** 一份**当前版本**的完整配置，用来做「迁移不该改动已经对了的东西」的基线 */
const current = (): AppConfig => structuredClone(DEFAULT_APP_CONFIG)

// ---------------------------------------------------------------- 最要紧的一条

describe('apiKey **绝对不能**在迁移里丢掉', () => {
  it('老配置（v1，没有 soundEnabled）里的 Key 原样带过来', () => {
    // 这是整份迁移里唯一一条「弄错了会让用户真的损失东西」的规矩。
    // 别的字段错了顶多是显示不对，这个错了用户得再去后台生成一把 Key。
    const key = 'sk-0123456789abcdef0123456789abcdef'
    const out = migrateConfig({ version: 1, ai: { apiKey: key } })
    expect(out.ai.apiKey).toBe(key)
  })

  it('**不 trim**：前后带空格也一字不改地留着', () => {
    // 看起来像小事，其实不是。这个字段不是我们写进去的，用户从网页上复制
    // 什么就是什么。「顺手规范化」在这里是**把改动伪装成清理** ——
    // 万一某家的 Key 真允许这种形状，我们就在他没察觉的情况下换了它的值。
    // 真需要 trim 的地方是保存入口（config-merge 的 nextApiKey），那里有单测盯着。
    const out = migrateConfig({ ai: { apiKey: '  sk-padded  ' } })
    expect(out.ai.apiKey).toBe('  sk-padded  ')
  })

  it('反向验证：**空串也是合法值**，不能被 fallback 顶掉', () => {
    // 「没配 Key」和「配了一把空 Key」在存储上都是空串，迁移必须原样接受。
    // 少了这一条，上面那条「不 trim」用一个 `?? ''` 也能绿 ——
    // 而那会把空串当成缺失，语义就变了。
    expect(migrateConfig({ ai: { apiKey: '' } }).ai.apiKey).toBe('')
  })

  it('apiKey 不是字符串时退回空串（而不是把某个对象塞进去）', () => {
    // 手工编辑过的配置文件里什么都可能。塞一个非字符串进去，
    // 后面拼 Authorization 头的时候才会炸，那时已经离现场很远了。
    expect(migrateConfig({ ai: { apiKey: { nested: true } } }).ai.apiKey).toBe('')
  })

  it('`ai` 整节都不在（或不是对象）时**不崩**，给一节默认值', () => {
    for (const raw of [{ version: 1 }, { ai: null }, { ai: 'nope' }, { ai: [] }]) {
      const out = migrateConfig(raw)
      expect(out.ai.apiKey).toBe('')
      expect(out.ai.baseUrl).toBe(DEFAULT_APP_CONFIG.ai.baseUrl)
      expect(out.ai.model).toBe(DEFAULT_APP_CONFIG.ai.model)
    }
  })
})

// ---------------------------------------------------------------- v1 → v2

describe('v1 → v2：soundEnabled 那一行', () => {
  it('老配置里**根本没有这个字段** → 读出来是 true（音效默认开着）', () => {
    // 这是 `bool(raw.soundEnabled, true)` 里那个 `true` 存在的全部理由。
    // 写成 `false` 的话，升级上来的老用户一开就静音 —— 而他会以为功能坏了，
    // 因为开关在界面上是勾着的（复选框对 undefined 有自己的解读）。
    const out = migrateConfig({ version: 1, reviewEnabled: true })
    expect(out.soundEnabled).toBe(true)
  })

  it('用户**亲手关掉**的必须留住（不能被「默认即 true」顶回去）', () => {
    // 少这一条，上面那条用一个写死的 true 也能绿 —— 而那等于
    // 「每次启动都把用户的静音设置强行打开」。这两条必须同时在场才有意义。
    expect(migrateConfig({ version: 1, soundEnabled: false }).soundEnabled).toBe(false)
  })

  it('非布尔值退回 true，不把 `"false"` 这种字符串当真', () => {
    // JSON 里写 "false" 是个常见的手滑。当真的话 `if ("false")` 是**真**，
    // 静音开关会反着来 —— 静默的、方向相反的错误。
    expect(migrateConfig({ soundEnabled: 'false' }).soundEnabled).toBe(true)
    expect(migrateConfig({ soundEnabled: 0 }).soundEnabled).toBe(true)
    expect(migrateConfig({ soundEnabled: null }).soundEnabled).toBe(true)
  })

  it('产物**永远**是当前版本号，哪怕输入是 v1、或者压根没写 version', () => {
    // 不这么写的话迁完还是老版本号，下次读配置又得再迁一遍 ——
    // 而且磁盘上那份永远看起来像「没迁过」，事后没法判断。
    // 这里**故意不写 `toBe(2)`**：它和上一行验的是同一个表达式，一点判别力都不加，
    // 却会在每次 bump 时变成一个和现实不符、又没人会注意的假货。
    // （同一个坑在 stores/__tests__/settings.test.ts 里已经栽过一次，那边留了记录。）
    for (const raw of [{ version: 1 }, {}, { version: undefined }, { version: 'x' }]) {
      expect(migrateConfig(raw).version).toBe(CURRENT_CONFIG_VERSION)
    }
  })

  it('版本**比当前还新**时照常搬运，认识的字段全留住', () => {
    // 用户装过更新版本又装回旧版。另一种做法（整份拒绝、退回默认值）
    // 会把他**全部**设置清掉，比丢掉几个未来字段严重得多。
    const out = migrateConfig({ version: 99, soundEnabled: false, reviewEnabled: false })
    expect(out.soundEnabled).toBe(false)
    expect(out.reviewEnabled).toBe(false)
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
  })
})

// ---------------------------------------------------------------- v2 → v3

describe('v2 → v3：theme 那一行', () => {
  it('老配置里**根本没有这个字段** → 读出来是 light（界面不变）', () => {
    // 和上面 soundEnabled 那组的默认值方向**刚好相反**：
    // 音效默认开（true）是「软件的性子」，主题默认浅（'light'）是
    // 「别动用户已有的东西」—— 升级上来的用户不该某天开机发现界面变黑了。
    expect(migrateConfig({ version: 2 }).theme).toBe('light')
  })

  it('用户**亲手设成夜间**的必须留住（不能被默认值顶回去）', () => {
    // 少这一条，上面那条用一个写死的 'light' 也能绿 —— 而那等于
    // 「每次启动都把夜间模式关掉」，用户会以为设置没保存。
    expect(migrateConfig({ version: 2, theme: 'dark' }).theme).toBe('dark')
    expect(migrateConfig({ version: 2, theme: 'light' }).theme).toBe('light')
  })

  it('白名单外的值一律退回 light —— **这一条是这组里最要紧的**', () => {
    // `themeName()` 存在的全部理由就在这条上。这些值本身都「看着像主题名」，
    // 如果被原样搬进内存，会一路写到 `<html data-theme="Dark">`，
    // 而 CSS 选择器是 `:root[data-theme='dark']` —— 匹配不上，界面**静默退回浅色**。
    // 用户看到的症状是「我明明设了夜间模式，重启又变回来了」，全程没有任何报错。
    // 大小写、空格、拼错的、别的主题名、以及非字符串，一个都不能放过去。
    for (const bad of ['Dark', 'DARK', ' dark ', 'sepia', 'auto', '', 0, null, undefined, {}]) {
      expect(migrateConfig({ theme: bad }).theme).toBe('light')
    }
  })

  it('版本**比当前还新**时 theme 照常搬运', () => {
    expect(migrateConfig({ version: 99, theme: 'dark' }).theme).toBe('dark')
    expect(migrateConfig({ version: 99 }).theme).toBe('light')
  })
})

// ---------------------------------------------------------------- v3 → v4

/**
 * v3 → v4：nativeRunEnabled 那一行。
 *
 * 【为什么这一条比 theme 那条还重】
 * theme 读错了，最坏是界面颜色不对 —— 看得见，改得回来。
 * 这个字段读错了，是**把用户的代码交给另一个程序去跑**，而且方向还可能相反：
 *   · 该关却读成开 → 从没要求过的人在不知情的情况下走了他的 shell，还每次多一个弹窗；
 *   · 该开却读成关 → 用户打开开关、重启，发现开关「自己关掉了」，功能像坏了。
 * 两种都不报错。所以下面「默认 false」和「亲手开的必须留住」**必须同时在场**，
 * 少任何一条，另一条都能用一个写死的值骗过去。
 */
describe('v3 → v4：nativeRunEnabled 那一行', () => {
  it('老配置里**根本没有这个字段** → 读出来是 false（升级上来的用户保持关着）', () => {
    // 这是 `bool(raw.nativeRunEnabled, false)` 里那个 `false` 存在的全部理由。
    // 写成 true 的话，每一个升级上来的用户——包括那些机器上压根没装编译器的——
    // 下次点运行都会撞上一个自己没开过的开关，然后拿到一句
    // “找不到 gcc”，而他从没要求过这件事。
    expect(migrateConfig({ version: 3 }).nativeRunEnabled).toBe(false)
    expect(DEFAULT_APP_CONFIG.nativeRunEnabled, '默认值本身也得是 false').toBe(false)
  })

  it('用户**亲手打开**的必须留住（不能被默认值顶回去）', () => {
    // 少这一条，上面那条用一个写死的 false 也能绿 —— 而那等于
    // 「每次启动都把原生模式关掉」，用户会以为开关存不住。
    expect(migrateConfig({ version: 3, nativeRunEnabled: true }).nativeRunEnabled).toBe(true)
    expect(migrateConfig({ version: 3, nativeRunEnabled: false }).nativeRunEnabled).toBe(false)
  })

  it('★ 非布尔值一律退回 **false**，`"false"` / `"true"` / 1 都不当真', () => {
    // 这组是本文件的红线所在。JSON 里写 `"false"` 是常见手滑，而 `if ("false")`
    // 是**真** —— 当真的话，一个写着 false 的值会把用户送上原生模式：
    // 方向相反、还静默。这条字段的错方向比 theme 那次更贵（那边只是颜色不对）。
    // 反过来，`1` / `"true"` 也不能当成开：用户没打开过的开关，不该由一份手改过的
    // 配置文件替他打开。**两个方向都退回 false**，没有例外。
    for (const bad of ['false', 'true', 1, 0, 'yes', [], {}, null, undefined]) {
      expect(
        migrateConfig({ nativeRunEnabled: bad }).nativeRunEnabled,
        `这个值被读成了 true，但它不是布尔 true：${String(bad)}`
      ).toBe(false)
    }
  })

  it('版本**比当前还新**时照常搬运（和 theme / soundEnabled 同一套规矩）', () => {
    expect(migrateConfig({ version: 99, nativeRunEnabled: true }).nativeRunEnabled).toBe(true)
    expect(migrateConfig({ version: 99 }).nativeRunEnabled).toBe(false)
  })
})

// ---------------------------------------------------------------- v4 → v5

/**
 * v4 → v5：sfxVolume 那一行。
 *
 * 【这一条的默认值方向和 soundEnabled **相同**，和 theme / nativeRunEnabled 相反】
 * 那个「方向」不是随便定的，它取决于**默认值是软件的性子，还是用户已有的东西**：
 *   · 音效默认开、音量默认 100% —— 是「这个软件本来就该响」；
 *   · 主题默认浅、原生模式默认关 —— 是「别动用户已有的东西 / 别替他做危险决定」。
 * 升级上来的老用户**听到的音量和昨天一模一样**（都是满的），所以他不会觉得
 * 这次升级动了什么 —— 这正是一条迁移该有的样子。
 */
describe('v4 → v5：sfxVolume 那一行', () => {
  it('老配置里**根本没有这个字段** → 读出来是 100（和升级前听到的一样响）', () => {
    // 给 0 的话，升级上来的用户会突然发现"整个软件没声音了"，
    // 而设置页那个开关明明是开着的 —— 他会去查音频驱动。
    expect(migrateConfig({ version: 4 }).sfxVolume).toBe(100)
    expect(DEFAULT_APP_CONFIG.sfxVolume, '默认值本身也得是满的').toBe(100)
  })

  it('★ 用户**亲手拨到 0**（静音）的必须留住 —— 0 是个正经的值，不是"没有值"', () => {
    // 这一条是这组里最容易写坏的地方：`raw.sfxVolume || 100` 这种写法会让
    // **0 变成 100**（0 是假值），于是用户每重启一次，静音就被还回来一次。
    // 他只会觉得"这个滑块存不住"。所以判断只能用 `Number.isFinite`，
    // 不能用真假值 —— 两行代码长得几乎一样，行为正好相反。
    expect(migrateConfig({ version: 4, sfxVolume: 0 }).sfxVolume).toBe(0)
    expect(migrateConfig({ version: 4, sfxVolume: 1 }).sfxVolume).toBe(1)
    expect(migrateConfig({ version: 4, sfxVolume: 50 }).sfxVolume).toBe(50)
  })

  it('越界值被钳进 [0, 100]（写进文件就晚了）', () => {
    // 500 会在播放时变成 5 倍增益 —— 一耳朵爆音。
    expect(migrateConfig({ sfxVolume: 999 }).sfxVolume).toBe(100)
    expect(migrateConfig({ sfxVolume: -30 }).sfxVolume).toBe(0)
  })

  it('小数四舍五入成整数（界面显示和文件内容必须对得上）', () => {
    expect(migrateConfig({ sfxVolume: 79.6 }).sfxVolume).toBe(80)
    expect(migrateConfig({ sfxVolume: 79.4 }).sfxVolume).toBe(79)
  })

  it('★ NaN / Infinity / 字符串 → 退回 **100**，**不是**被钳成 0', () => {
    // 和 runTimeoutSec 那条同一个道理：NaN 的意思是「这个值没意义」，
    // 不是「用户想要静音」。钳成 0 的话，一个手改坏的值会让整个软件**静默地**
    // 一点声音都没有，而用户只会去怀疑扬声器。
    // ⚠️ NaN **能穿过** `Math.min(Math.max(NaN, 0), 100)`（和谁比都是 false），
    // 所以 `Number.isFinite` 这一道不能省 —— 少了它，NaN 会被原样搬下去，
    // 最后写进 `gain.gain.value = NaN`，那一路音效**永远不响且不报错**。
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '80', null, undefined, {}, []]) {
      expect(
        migrateConfig({ sfxVolume: bad }).sfxVolume,
        `这个值没有被退回默认：${String(bad)}`
      ).toBe(100)
    }
  })

  it('版本**比当前还新**时照常搬运（和上面几个字段同一套规矩）', () => {
    expect(migrateConfig({ version: 99, sfxVolume: 30 }).sfxVolume).toBe(30)
    expect(migrateConfig({ version: 99 }).sfxVolume).toBe(100)
  })
})

// ---------------------------------------------------------------- v5 → v6

/**
 * v5 → v6：favWrongToBook 那一行（收藏练习答错要不要进错题本）。
 *
 * 【默认值方向同 soundEnabled（给 true），和 theme / nativeRunEnabled 相反】
 * 判据还是那条：它是「软件的性子」还是「用户已有的东西」？
 * 全应用每一种练习答错都进错题本，收藏练习没有理由在升级的那一瞬间变成例外 ——
 * 所以老配置读出来必须是 true。写反的后果是**一部分用户的错题本从此悄悄少东西**，
 * 而他根本不会往设置上想（那个开关他从来没碰过）。
 */
describe('v5 → v6：favWrongToBook 那一行', () => {
  it('老配置里**根本没有这个字段** → 读出来是 true（答错照样进错题本）', () => {
    expect(migrateConfig({ version: 5 }).favWrongToBook).toBe(true)
    expect(DEFAULT_APP_CONFIG.favWrongToBook, '默认值本身也得是 true').toBe(true)
  })

  it('★ 用户**亲手关掉**的必须留住（不能被「默认即 true」顶回去）', () => {
    // 少这一条，上面那条用一个写死的 true 也能绿 —— 而那等于
    // 「每次启动都把用户关掉的开关又打开」。这一对必须同时在场才有意义
    expect(migrateConfig({ version: 5, favWrongToBook: false }).favWrongToBook).toBe(false)
  })

  it('非布尔值退回 true（`"false"` 这种字符串不当真）', () => {
    // 和 soundEnabled 那边同一个坑：`if ("false")` 是**真**，
    // 开关的方向会反着来 —— 静默的、方向相反的错误
    for (const bad of ['false', 0, 1, null, {}, []]) {
      expect(migrateConfig({ favWrongToBook: bad }).favWrongToBook, `这个值没被退回默认：${String(bad)}`).toBe(
        true
      )
    }
  })

  it('版本**比当前还新**时照常搬运（和上面几个字段同一套规矩）', () => {
    expect(migrateConfig({ version: 99, favWrongToBook: false }).favWrongToBook).toBe(false)
  })
})

// ---------------------------------------------------------------- v7 → v8

/**
 * v7 → v8：nativeRunQuiet 那一行（原生模式的「不再提醒」）。
 *
 * 【默认值方向同 nativeRunEnabled：给 false（继续每次都问）】
 * 判据还是那条：默认值是「软件的性子」还是「别动用户已有的东西」？
 * 「不再提醒」只有在用户**在弹窗里亲手勾过**之后才能成立 —— 它是对
 * 「每跑一次问一句」的豁免，不能让升级这个动作替他做。
 *
 * 【默认给 false 比看上去更要紧】true 的后果不是多问一句，而是**少问一句**：
 * 一个从没勾过不再提醒的用户，升级后弹窗自己没了，代码被交给另一个编译器跑，
 * 全程没有任何提示 —— 和 nativeRunEnabled「该关却读成开」是同一类事故
 * （那个方向的测试见 v3 → v4 那组）。
 */
describe('v7 → v8：nativeRunQuiet 那一行', () => {
  it('老配置里**根本没有这个字段** → 读出来是 false（升级上来的用户继续每次都问）', () => {
    expect(migrateConfig({ version: 7 }).nativeRunQuiet).toBe(false)
    expect(DEFAULT_APP_CONFIG.nativeRunQuiet, '默认值本身也得是 false').toBe(false)
  })

  it('用户**亲手勾过不再提醒**的必须留住（不能被默认值顶回去）', () => {
    // 少这一条，上面那条用一个写死的 false 也能绿 —— 而那等于
    // 「每次启动都把用户勾的『不再提醒』抹掉」，弹窗又冒出来了。
    expect(migrateConfig({ version: 7, nativeRunQuiet: true }).nativeRunQuiet).toBe(true)
    expect(migrateConfig({ version: 7, nativeRunQuiet: false }).nativeRunQuiet).toBe(false)
  })

  it('★ 非布尔值一律退回 **false**，`"false"` / `"true"` / 1 都不当真', () => {
    // 同 nativeRunEnabled 那组：JSON 里写 "false" 是常见手滑，而 `if ("false")`
    // 是**真**。当真的话，一个写着 false 的值会把弹窗静默关掉（= 替用户
    // 勾上了他从没勾过的「不再提醒」）。两个方向都退回 false，没有例外。
    for (const bad of ['false', 'true', 1, 0, 'yes', [], {}, null, undefined]) {
      expect(
        migrateConfig({ nativeRunQuiet: bad }).nativeRunQuiet,
        `这个值被读成了 true，但它不是布尔 true：${String(bad)}`
      ).toBe(false)
    }
  })

  it('版本**比当前还新**时照常搬运（和上面几个字段同一套规矩）', () => {
    expect(migrateConfig({ version: 99, nativeRunQuiet: true }).nativeRunQuiet).toBe(true)
    expect(migrateConfig({ version: 99 }).nativeRunQuiet).toBe(false)
  })
})

// ---------------------------------------------------------------- v8 → v9

/**
 * v8 → v9：单个 nativeIdePath 拆成每语言四键 nativeIdePaths。
 *
 * 【为什么值得这么多对照臂】旧值只是一枚**没有语言信息**的选择，而主人
 * 实测的病恰是「一个程序开所有语言、总有一半乱码」—— 闭着眼睛四键全填
 * 等于把病原样搬进新结构。分派口径（2026-10-01 拍板）：通用编辑器清空成
 * 「自动」、专用工具只填它画像里的语言、认不出的 exe 四键全填（那是用户的
 * 显式选择）。**通用编辑器与专用工具必须成对测** —— 只测一边的话，一个
 * 「四键全填」的简化实现也能全绿。
 */
describe('v8 → v9：nativeIdePath 拆成每语言四键', () => {
  it('老配置里**根本没有这个字段** → 四键全空（不替用户猜路径）', () => {
    // 方向同 nativeRunEnabled：升级上来的用户保持未配置，点「打开」时
    // 按语言现检现荐 —— 而不是替他把某个"常见安装路径"钉进四格里。
    expect(migrateConfig({ version: 8 }).nativeIdePaths).toEqual(emptyIdePaths())
    expect(DEFAULT_APP_CONFIG.nativeIdePaths, '默认值本身也是四键全空').toEqual(emptyIdePaths())
  })

  it('★ 空白串 / 非字符串 → 四键全空（空 = 未配置，不是"保留上次"）', () => {
    for (const bad of ['', '   ', '\t', 0, null, undefined, {}, []]) {
      expect(
        migrateConfig({ version: 8, nativeIdePath: bad }).nativeIdePaths,
        `这个值没被退回四键全空：${String(bad)}`
      ).toEqual(emptyIdePaths())
    }
  })

  it('★ 旧值 = Dev-C++（专用工具）→ 只填 c / cpp，java、python 留空走自动推荐', () => {
    // 旧值只是一枚"没有语言信息"的选择；Dev-C++ 的画像里只有 c/cpp，
    // 把它也填进 java/python 等于明知故犯地制造乱码。
    const p = 'C:\\Program Files (x86)\\Dev-Cpp\\devcpp.exe'
    expect(migrateConfig({ version: 8, nativeIdePath: p }).nativeIdePaths).toEqual({
      c: p,
      cpp: p,
      java: '',
      python: ''
    })
  })

  it('★ 对照臂：旧值 = VS Code（通用编辑器）→ 四键**全空**（退位给按语言推荐）', () => {
    // 和上一条成对：只测 Dev-C++ 的话，「四键全填」的简化实现也会绿。
    // 通用编辑器什么都开得了，正因如此旧值不锁任何槽位 —— 让每门语言
    // 各自去推荐表里选（装了什么用什么，行为不会丢）。
    const p = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
    expect(migrateConfig({ version: 8, nativeIdePath: p }).nativeIdePaths).toEqual(emptyIdePaths())
    // 同族的另两个也必须被认出来（大小写不敏感这条路上各留一臂）
    expect(
      migrateConfig({ version: 8, nativeIdePath: 'D:/apps/VSCodium.exe' }).nativeIdePaths
    ).toEqual(emptyIdePaths())
    expect(migrateConfig({ version: 8, nativeIdePath: 'D:/apps/CURSOR.EXE' }).nativeIdePaths).toEqual(
      emptyIdePaths()
    )
  })

  it('旧值 = PyCharm → 只填 python；IntelliJ IDEA → 只填 java', () => {
    expect(migrateConfig({ version: 8, nativeIdePath: 'D:/apps/pycharm64.exe' }).nativeIdePaths).toEqual(
      { c: '', cpp: '', java: '', python: 'D:/apps/pycharm64.exe' }
    )
    expect(migrateConfig({ version: 8, nativeIdePath: 'D:/apps/idea64.exe' }).nativeIdePaths).toEqual({
      c: '',
      cpp: '',
      java: 'D:/apps/idea64.exe',
      python: ''
    })
  })

  it('★ 认不出的 exe（用户自己挑的程序）→ 四键全填（他的显式选择不许丢）', () => {
    // 和白名单外程序的编码回退（defaultEncodingOf）配套：四键全填 +
    // 按语言回退 = 升级前后逐字节一致，不比现在差。若"简化"成清空，
    // 用户会发现「我明明配过的程序，升级后点打开变成现检现荐了」。
    const p = 'D:/tools/my-editor.exe'
    expect(migrateConfig({ version: 8, nativeIdePath: p }).nativeIdePaths).toEqual({
      c: p,
      cpp: p,
      java: p,
      python: p
    })
  })

  it('旧值前后带空格 → 先 trim 再分发（同一条路径不许存成两个样）', () => {
    expect(
      migrateConfig({ version: 8, nativeIdePath: '  D:/tools/devcpp.exe  ' }).nativeIdePaths
    ).toEqual({ c: 'D:/tools/devcpp.exe', cpp: 'D:/tools/devcpp.exe', java: '', python: '' })
  })

  it('★ 新字段已在文件里 → 逐键取值，旧单值即使还在也被无视（幂等的机理）', () => {
    // 迁移的产出里有完整四键，第二遍迁移走这一类。旧字段若还在文件里
    // 却参与了判定，就会把用户 v9 之后改过的格子又按旧值覆盖回去。
    const out = migrateConfig({
      version: 8,
      nativeIdePath: 'C:/tools/devcpp.exe',
      nativeIdePaths: { c: '  C:/new.exe  ', cpp: '', python: 'C:/py.exe' }
    })
    expect(out.nativeIdePaths).toEqual({ c: 'C:/new.exe', cpp: '', java: '', python: 'C:/py.exe' })
  })

  it('新字段在、但逐键是脏值 → 该键落空，不崩、不塞对象', () => {
    // 手改坏了的文件：42 / {} / 纯空白都不是路径，各自落成 ''（text 的脏值语义）。
    const out = migrateConfig({
      nativeIdePaths: { c: 42, cpp: {}, java: '   ', python: 'C:/py.exe' }
    })
    expect(out.nativeIdePaths).toEqual({ c: '', cpp: '', java: '', python: 'C:/py.exe' })
  })

  it('新字段在、但根本不是对象（数组/字符串）→ 退回旧单值分派，而不是崩', () => {
    // isObject 把数组挡在外面，于是照旧单值那条路分发 —— Dev-C++ 的旧值
    // 正常落到 c/cpp。这里同时守住「坏形状不导致四键全空」这个方向。
    const p = 'C:/tools/devcpp.exe'
    const want = { c: p, cpp: p, java: '', python: '' }
    expect(migrateConfig({ version: 8, nativeIdePath: p, nativeIdePaths: [] }).nativeIdePaths).toEqual(want)
    expect(migrateConfig({ version: 8, nativeIdePath: p, nativeIdePaths: 'oops' }).nativeIdePaths).toEqual(
      want
    )
  })

  it('版本**比当前还新**时照常搬运（和上面几个字段同一套规矩）', () => {
    const p = 'C:/tools/devcpp.exe'
    expect(migrateConfig({ version: 99, nativeIdePath: p }).nativeIdePaths.c).toBe(p)
    expect(migrateConfig({ version: 99 }).nativeIdePaths).toEqual(emptyIdePaths())
  })

  it('幂等：带空格的旧值迁一次被 trim 并分发，再迁一次不再变', () => {
    const once = migrateConfig({ version: 8, nativeIdePath: '  D:/tools/devcpp.exe  ' })
    expect(once.nativeIdePaths.c).toBe('D:/tools/devcpp.exe')
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v9 → v10

/**
 * v9 → v10：新增 `wallpaper` 壁纸设置块（docs/23）。
 *
 * 【为什么这节只有四条】这块的**形状闸门**全部收在 shared/wallpaper.ts 的
 * normalizeWallpaper 里（它自己的测试逐字段钉区间与脏值），这里只管迁移
 * 这一层的三件事：老配置要补出完整块、用户真实值一个不改、幂等。
 */
describe('v9 → v10：新增 wallpaper 壁纸设置块', () => {
  it('老配置（v9，没有这一节）→ 补出完整默认块（2026-10-17 分享版起默认关）', () => {
    const out = migrateConfig({ version: 9 })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.wallpaper).toEqual(DEFAULT_APP_CONFIG.wallpaper)
    expect(out.wallpaper.enabled).toBe(false) // 分享版拍板：全新配置默认关
    expect(out.wallpaper.selectedId).toBe('') // '' = 没选，只垫渐变底
  })

  it('用户亲手调过的值必须留住（迁移不等于重置）', () => {
    const mine = { enabled: false, dim: 60, selectedId: '3284636810', playbackRate: 1.5 }
    const out = migrateConfig({ version: 9, wallpaper: mine })
    expect(out.wallpaper.enabled).toBe(false)
    expect(out.wallpaper.dim).toBe(60)
    expect(out.wallpaper.selectedId).toBe('3284636810')
    expect(out.wallpaper.playbackRate).toBe(1.5)
  })

  it('脏值被 normalizeWallpaper 挡住：NaN 退默认、越界钳端点、非布尔回默认极性', () => {
    const out = migrateConfig({
      wallpaper: { dim: NaN, blur: 999, volume: -3, enabled: 'nope', audio: { source: 'bluetooth' } }
    })
    expect(out.wallpaper.dim).toBe(35)
    expect(out.wallpaper.blur).toBe(40)
    expect(out.wallpaper.volume).toBe(0)
    expect(out.wallpaper.enabled).toBe(false)
    expect(out.wallpaper.audio.source).toBe('off')
  })

  it('幂等：迁一次再迁不再变', () => {
    const once = migrateConfig({ version: 9, wallpaper: { dim: 42, selectedId: ' x ' } })
    expect(migrateConfig(once)).toEqual(once)
    // 顺手钉住第一遍真的走了 normalize（不然后面那条相等断言对"压根没迁"也绿）
    expect(once.wallpaper.selectedId).toBe('x')
  })

  it('版本比当前还新时照常搬运（和别的字段同一套规矩）', () => {
    expect(migrateConfig({ version: 99, wallpaper: { dim: 50 } }).wallpaper.dim).toBe(50)
  })
})

// ---------------------------------------------------------------- v11 → v12

/**
 * v11 → v12：壁纸外观面板的四个新键（objectFit / transitionDir / trackOn /
 * parallax.mascotFollow，2026-10-05 照开源壁纸引擎移植。其中 mascotFollow
 * 已于 v13 删除 —— 其残键清理的用例在 v12 → v13 那一段）。
 *
 * 【为什么没有一段独立的 v11 代码】这四键是**同块内的补键**：读口照旧整块过
 * normalizeWallpaper，缺键补默认、脏值退默认 —— 迁移段什么都不用做，
 * 版本号一写就完成了（config-migrate.ts 里那段注释写明了这个口径）。
 * 所以这里只钉「真实老配置（v11 块里没有这四个键）升上来之后长什么样」。
 */
describe('v11 → v12：壁纸块新键补齐', () => {
  it('v11 老配置（块里没这四个键）→ 补默认：cover / left / trackOn=true', () => {
    const out = migrateConfig({
      version: 11,
      wallpaper: { enabled: true, dim: 40, selectedId: '3284636810', parallax: { enabled: true, amount: 5, smooth: 60 } }
    })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.wallpaper.objectFit).toBe('cover')
    expect(out.wallpaper.transitionDir).toBe('left')
    expect(out.wallpaper.trackOn).toBe(true)
    // 老键一个不动（迁移不等于重置）
    expect(out.wallpaper.dim).toBe(40)
    expect(out.wallpaper.selectedId).toBe('3284636810')
    expect(out.wallpaper.parallax.amount).toBe(5)
    expect(out.wallpaper.parallax.smooth).toBe(60)
  })

  it('v12 用户值原样留住，脏值退回默认（幂等）', () => {
    const once = migrateConfig({
      version: 11,
      wallpaper: { objectFit: 'contain', transitionDir: 'up', trackOn: false }
    })
    expect(once.wallpaper.objectFit).toBe('contain')
    expect(once.wallpaper.transitionDir).toBe('up')
    expect(once.wallpaper.trackOn).toBe(false)
    expect(migrateConfig(once)).toEqual(once)
    // 脏值这条另起一份，别混进上面「原样留住」的语义里
    const dirty = migrateConfig({ version: 11, wallpaper: { objectFit: 'stretch', trackOn: 'yes' } })
    expect(dirty.wallpaper.objectFit).toBe('cover')
    expect(dirty.wallpaper.trackOn).toBe(true)
  })
})

// ---------------------------------------------------------------- v12 → v13

/**
 * v12 → v13：① 删 parallax.mascotFollow（「吉祥物跟随」，主人 2026-10-05
 * 实测后确认不要）；② 增 itemProps / itemTuning 两块（「壁纸属性」面板的
 * 存储，见 wallpaper.test.ts 的 v13 describe 钉形状）。
 *
 * 【为什么照旧没有独立迁移段】两件事都由 normalizeWallpaper 读口整树重建时
 * 一并完成：mascotFollow 不在重建产物里 → 残键静默丢弃；两块缺省 → 补空表。
 * config-migrate.ts L215-221 的那段注释即迁移记录。
 * 这里只管迁移这一层（残键丢没丢净、真实值留没留住、幂等），
 * 逐字段的形状闸门在对口文件里。
 */
describe('v12 → v13：mascotFollow 残键丢弃 + 属性/微调两块补空', () => {
  it('v12 老配置里的 mascotFollow 残键丢净，parallax 的其余真实值一个不动', () => {
    const out = migrateConfig({
      version: 12,
      wallpaper: {
        selectedId: '3284636810',
        parallax: { enabled: true, amount: 7, smooth: 42, mascotFollow: true }
      }
    })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect('mascotFollow' in out.wallpaper.parallax).toBe(false)
    expect(out.wallpaper.parallax.amount).toBe(7)
    expect(out.wallpaper.parallax.smooth).toBe(42)
    expect(out.wallpaper.selectedId).toBe('3284636810')
  })

  it('v12 老配置（两块都没见过）→ 补出空表（缺省口径与默认块一致）', () => {
    const out = migrateConfig({ version: 12 })
    expect(out.wallpaper.itemProps).toEqual({})
    expect(out.wallpaper.itemTuning).toEqual({})
    // 三处缺省不许漂移：默认块 / 迁移缺省 / 净化缺省
    expect(DEFAULT_APP_CONFIG.wallpaper.itemProps).toEqual({})
    expect(DEFAULT_APP_CONFIG.wallpaper.itemTuning).toEqual({})
  })

  it('逐张微调的真实值留住、净化照常（迁移不等于重置、也不等于放行脏值）；幂等', () => {
    const once = migrateConfig({
      version: 12,
      wallpaper: {
        itemProps: { '3284636810': { speed: 1, label: 'wave' }, '': { x: 1 } },
        itemTuning: { '3284636810': { flipH: false, blur: 12, opacity: 999 }, '123': { zoom: 1 } }
      }
    })
    expect(once.wallpaper.itemProps).toEqual({ '3284636810': { speed: 1, label: 'wave' } }) // 空 id 丢
    expect(once.wallpaper.itemTuning['3284636810']).toEqual({ flipH: false, blur: 12 }) // 999→钳 100 落中性 → 删
    expect('123' in once.wallpaper.itemTuning).toBe(false) // zoom 1 = 中性 → 整张空 → 删 id
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v13 → v14

/**
 * v13 → v14：新增 splash 开屏动画设置块（主人 2026-10-05 批复）。
 *
 * 【为什么照旧没有独立迁移段】和 wallpaper 同构：整块由 normalizeSplash
 * 读口整树重建时一并补全（config-migrate.ts L223-229 的那段注释即迁移记录）。
 * 这里只管迁移这一层（老配置补默认、真实值留住、脏值净化、幂等），
 * 逐字段的形状闸门在 splash.test.ts 的对口 describe 里。
 *
 * ⚠️ 默认方向是**开**：升级上来的用户立刻能看到开屏。这条要是被改成
 * `enabled: false`，下面的「补默认」用例会红 —— 那正是它存在的意义
 * （默认方向翻车是静默的：老用户以为「这版没做开屏」）。
 */
describe('v13 → v14：splash 开屏设置块补齐', () => {
  it('v13 老配置（从没见过 splash）→ 补出完整默认块（2026-10-17 分享版起默认关、随机、静音）', () => {
    const out = migrateConfig({ version: 13 })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.splash).toEqual(defaultSplash())
    expect(out.splash.enabled).toBe(false)
    expect(out.splash.pick).toBe('random')
    expect(out.splash.sound).toBe(false)
    // 三处缺省不许漂移：默认块 / 迁移缺省 / 净化缺省
    expect(DEFAULT_APP_CONFIG.splash).toEqual(defaultSplash())
  })

  it('用户调过的值原样带过来（含池子与不透明兜底）', () => {
    const out = migrateConfig({
      version: 13,
      splash: {
        enabled: false,
        pick: 'fixed',
        fixedFile: 'lxj-1.mp4',
        pool: ['lxj-1.mp4', 'nd-brand.mp4'],
        sound: true,
        volume: 40,
        fit: 'cover',
        opaque: true
      }
    })
    expect(out.splash).toEqual({
      enabled: false,
      pick: 'fixed',
      fixedFile: 'lxj-1.mp4',
      pool: ['lxj-1.mp4', 'nd-brand.mp4'],
      sound: true,
      volume: 40,
      fit: 'cover',
      opaque: true
    })
  })

  it('脏值净化（迁移不等于放行脏值）：越界音量钳住、白名单外枚举回默认、池子去重', () => {
    const out = migrateConfig({
      version: 13,
      splash: {
        volume: 999,
        pick: 'FIXED',
        fit: 'stretch',
        pool: ['a.mp4', 'a.mp4', '', 42, 'b.mp4']
      }
    })
    expect(out.splash.volume).toBe(100)
    expect(out.splash.pick).toBe('random')
    expect(out.splash.fit).toBe('contain')
    expect(out.splash.pool).toEqual(['a.mp4', 'b.mp4'])
  })

  it('整块是脏类型（字符串/数组）→ 完整默认块，不崩', () => {
    for (const junk of ['splash', 42, [], null]) {
      const out = migrateConfig({ version: 13, splash: junk })
      expect(out.splash, `这个值没被挡住：${String(junk)}`).toEqual(defaultSplash())
    }
  })

  it('幂等：迁出来的配置再迁一遍逐字节不变', () => {
    const once = migrateConfig({
      version: 13,
      splash: { pick: 'fixed', fixedFile: 'x.mp4', pool: ['x.mp4'] }
    })
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v14 → v15

describe('v14 → v15：轮播池 rotation.pool 补齐', () => {
  it('v14 老配置（rotation 在、就是没有 pool）→ pool: [] = 全部参与', () => {
    const out = migrateConfig({
      version: 14,
      wallpaper: { enabled: true, rotation: { enabled: true, intervalMin: 30, order: 'random' } }
    })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.wallpaper.rotation).toEqual({
      enabled: true,
      intervalMin: 30,
      order: 'random',
      pool: []
    })
  })

  it('用户勾过的池子原样带过来（保序；工坊数字 id 与 custom: 前缀 id 都能过）', () => {
    const out = migrateConfig({
      version: 14,
      wallpaper: { rotation: { pool: ['3284636810', 'custom:star.png'] } }
    })
    expect(out.wallpaper.rotation.pool).toEqual(['3284636810', 'custom:star.png'])
  })

  it('脏值净化（迁移不等于放行脏值）：非字符串 / 空串丢、保序去重', () => {
    const out = migrateConfig({
      version: 14,
      wallpaper: { rotation: { pool: ['a', 'a', '', 42, 'b'] } }
    })
    expect(out.wallpaper.rotation.pool).toEqual(['a', 'b'])
  })

  it('幂等：迁出来的配置再迁一遍逐字节不变', () => {
    const once = migrateConfig({ version: 14, wallpaper: { rotation: { pool: ['x'] } } })
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v16 → v17

/**
 * v16 → v17：新增 pet 桌宠设置块（主人 2026-10-06 拍板：桌宠换 dsh-pet 引擎）。
 *
 * 【为什么照旧没有独立迁移段】和 wallpaper / splash 同构：整块由
 * normalizePetConfig 在迁移读口整树重建时一并补全（config-migrate.ts 里
 * 「v16 → v17 的那一段」注释即迁移记录）。这里只管迁移这一层（老配置补
 * 默认、真实值留住、脏值逐键净化、幂等）；坏值钳位的逐键口径与主进程宿主
 * src/main/dshpet/config.ts 的 normalizePetSettings 同源同值。
 *
 * ⚠️ 默认方向是**开**：升级上来的用户桌宠直接出场。这条要是被改成
 * `enabled: false`，下面「补默认」用例会红 —— 那正是它存在的意义。
 */
describe('v16 → v17：pet 桌宠设置块补齐', () => {
  it('v16 老配置（从没见过 pet）→ 补出完整默认块（默认开 / 462 / 右下角）', () => {
    const out = migrateConfig({ version: 16 })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.pet).toEqual(defaultPetConfig())
    // 三处缺省不许漂移：默认块 / 迁移缺省 / 净化缺省（v19 起含两个主动开关）
    expect(out.pet).toEqual({
      enabled: true,
      size: 462,
      corner: 'bottom-right',
      followMouse: true,
      hungryRoam: true
    })
    expect(DEFAULT_APP_CONFIG.pet).toEqual(defaultPetConfig())
  })

  it('用户亲手调过的值必须留住（迁移不等于重置）', () => {
    const out = migrateConfig({
      version: 16,
      pet: { enabled: false, size: 520, corner: 'top-left' }
    })
    expect(out.pet).toEqual({
      enabled: false,
      size: 520,
      corner: 'top-left',
      followMouse: true,
      hungryRoam: true
    })
  })

  it('坏一个键不洗掉另外几个好键（钳位保留用户意图）', () => {
    const out = migrateConfig({
      version: 16,
      pet: { enabled: false, size: 'big', corner: 'top-right' }
    })
    expect(out.pet).toEqual({
      enabled: false,
      size: 462,
      corner: 'top-right',
      followMouse: true,
      hungryRoam: true
    })
  })

  it('脏值净化：size 越界钳区间、非整数四舍五入、NaN 回默认', () => {
    expect(migrateConfig({ version: 16, pet: { size: 9999 } }).pet.size).toBe(700)
    expect(migrateConfig({ version: 16, pet: { size: 200 } }).pet.size).toBe(240)
    // 四舍五入与钳位是两道，顺序不能反（333.7 先舍入再进区间）
    expect(migrateConfig({ version: 16, pet: { size: 333.7 } }).pet.size).toBe(334)
    expect(migrateConfig({ version: 16, pet: { size: Number.NaN } }).pet.size).toBe(462)
  })

  it('脏值净化：corner 只认白名单四个角（大小写不同也算不同值）', () => {
    for (const junk of ['middle', 'TOP-LEFT', 'top_left', 42, {}]) {
      const out = migrateConfig({ version: 16, pet: { corner: junk } })
      expect(out.pet.corner, `这个值没被挡住：${String(junk)}`).toBe('bottom-right')
    }
    expect(migrateConfig({ version: 16, pet: { corner: 'bottom-left' } }).pet.corner).toBe(
      'bottom-left'
    )
  })

  it('脏值净化：enabled 只认布尔（字符串 "false" 不算数，退回默认开）', () => {
    expect(migrateConfig({ version: 16, pet: { enabled: 'false' } }).pet.enabled).toBe(true)
    expect(migrateConfig({ version: 16, pet: { enabled: 0 } }).pet.enabled).toBe(true)
    expect(migrateConfig({ version: 16, pet: { enabled: false } }).pet.enabled).toBe(false)
  })

  it('整块是脏类型（字符串/数字/数组/null）→ 完整默认块，不崩', () => {
    for (const junk of ['pet', 42, [], null]) {
      const out = migrateConfig({ version: 16, pet: junk })
      expect(out.pet, `这个值没被挡住：${String(junk)}`).toEqual(defaultPetConfig())
    }
  })

  it('幂等：迁出来的配置再迁一遍逐字节不变', () => {
    const once = migrateConfig({
      version: 16,
      pet: { enabled: false, size: 500, corner: 'top-right' }
    })
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v17 → v18

/**
 * v17 → v18：layout 加 `sidebarRail`（左栏三态的中间态「图标窄栏」）。
 *
 * 【照旧没有独立迁移段】整块由 normalizeLayout 在迁移读口重建时一并补全
 * （config-migrate.ts 里「v17 → v18 的那一段」注释即迁移记录）。这一层的
 * 三个要点：① 老配置（v17 及以前从没见过这个键）补 false —— 升级第一眼
 * 与升级前一模一样；② 用户亲手按出来的 rail 留住；③ 脏组合
 * （open:false + rail:true，读不出来的第四种）在读口钳掉。
 */
describe('v17 → v18：layout.sidebarRail 补齐（左栏三态的中间态）', () => {
  it('v17 老配置（从没见过 sidebarRail）→ 补 false，其余键一个字不动', () => {
    const out = migrateConfig({
      version: 17,
      layout: { sidebarSize: 21, sidebarOpen: true, rightPanelSize: 24, rightPanelOpen: false }
    })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.layout).toEqual({
      sidebarSize: 21,
      sidebarOpen: true,
      sidebarRail: false,
      rightPanelSize: 24,
      rightPanelOpen: false
    })
  })

  it('用户亲手收出来的 rail 必须留住（迁移不等于重置）', () => {
    const out = migrateConfig({
      version: 17,
      layout: { sidebarSize: 19, sidebarOpen: true, sidebarRail: true, rightPanelSize: 22, rightPanelOpen: true }
    })
    expect(out.layout.sidebarRail).toBe(true)
    expect(out.layout.sidebarSize).toBe(19)
  })

  it('脏组合（收起 + rail:true）→ rail 钳回 false（合法态只有三种）', () => {
    const out = migrateConfig({ version: 17, layout: { sidebarOpen: false, sidebarRail: true } })
    expect(out.layout.sidebarOpen).toBe(false)
    expect(out.layout.sidebarRail).toBe(false)
  })

  it('脏值（1 / "yes" / 对象）→ 回 false，**不是回 true**（方向与两个 Open 相反）', () => {
    for (const junk of [1, 'yes', 'true', {}]) {
      expect(
        migrateConfig({ version: 17, layout: { sidebarRail: junk } }).layout.sidebarRail,
        `这个值没被挡住：${String(junk)}`
      ).toBe(false)
    }
  })

  it('幂等：迁出来的配置再迁一遍逐字节不变', () => {
    const once = migrateConfig({ version: 17, layout: { sidebarRail: true, sidebarSize: 27 } })
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v18 → v19

/**
 * v18 → v19：pet 加两个主动行为开关 `followMouse` / `hungryRoam`。
 *
 * 【照旧没有独立迁移段】整块由 normalizePetConfig 在迁移读口重建时一并补全
 * （config-migrate.ts 里「v18 → v19 的那一段」注释即迁移记录）。三个要点：
 * ① 老配置（从没见过这两个键）补 **true** —— 主人 2026-10-09 下达「两个独立
 * 开关……默认开启」；② 用户亲手关掉的 false 必须留住（迁移不等于替他打开）；
 * ③ 字符串 'false' 不算数 —— 它在 if 里是**真**，放进去的表现是「关不掉」。
 */
describe('v18 → v19：pet 补两个主动行为开关（默认开）', () => {
  it('v18 老配置（从没见过这两个键）→ 补 true（默认开启）', () => {
    const out = migrateConfig({
      version: 18,
      pet: { enabled: true, size: 462, corner: 'bottom-right' }
    })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.pet.followMouse).toBe(true)
    expect(out.pet.hungryRoam).toBe(true)
  })

  it('用户亲手关掉的 false 必须留住（迁移不等于替他打开）', () => {
    const out = migrateConfig({ version: 18, pet: { followMouse: false, hungryRoam: false } })
    expect(out.pet.followMouse).toBe(false)
    expect(out.pet.hungryRoam).toBe(false)
  })

  it('脏值净化：字符串 "false" / 0 / {} / null 全部退回默认 true（只认布尔）', () => {
    for (const junk of ['false', 0, 'true', {}, null]) {
      const out = migrateConfig({ version: 18, pet: { followMouse: junk, hungryRoam: junk } })
      expect(out.pet.followMouse, `这个值没被挡住：${String(junk)}`).toBe(true)
      expect(out.pet.hungryRoam, `这个值没被挡住：${String(junk)}`).toBe(true)
    }
  })

  it('幂等：迁出来的配置再迁一遍逐字节不变', () => {
    const once = migrateConfig({ version: 18, pet: { followMouse: false, hungryRoam: true } })
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v19 → v20

/**
 * v19 → v20：ai 加 `dynamicEnabled`（AI 动态出题总开关）。
 *
 * 这条迁移的**全部风险都在默认值方向**：它决定用户会不会在不知情的情况下
 * 开始花自己的 Token。所以判据只有一条 —— 老配置 / 脏值 / 缺失一律 **false**，
 * 只有用户亲手存进来的布尔 true 才算数。
 */
describe('v19 → v20：AI 动态出题开关（默认关）', () => {
  it('v19 老配置（从没见过这个键）→ false', () => {
    const out = migrateConfig({
      version: 19,
      ai: { apiKey: 'sk-old', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }
    })
    expect(out.version).toBe(CURRENT_CONFIG_VERSION)
    expect(out.ai.dynamicEnabled).toBe(false)
    expect(out.ai.apiKey).toBe('sk-old')
  })

  it('用户亲手打开的 true 必须留住', () => {
    expect(migrateConfig({ version: 20, ai: { dynamicEnabled: true } }).ai.dynamicEnabled).toBe(true)
  })

  it('脏值只认布尔 true：字符串 "true" / 1 / {} / null 全退回 false', () => {
    for (const junk of ['true', 1, {}, null, 'false']) {
      const out = migrateConfig({ version: 20, ai: { dynamicEnabled: junk } })
      expect(out.ai.dynamicEnabled, `这个值没被挡住：${String(junk)}`).toBe(false)
    }
  })

  it('幂等：迁出来的配置再迁一遍逐字节不变', () => {
    const once = migrateConfig({ version: 19, ai: { dynamicEnabled: true } })
    expect(migrateConfig(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- layout 欠账

describe('layout：借这次迁移把历史欠账收编', () => {
  it('老配置**没有 layout 这一节**时不崩，补出一份完整的', () => {
    // 这就是布局功能上线时那个「升级后第一次启动白屏」的坑：
    // 开发机上的配置是新的，永远复现不了。
    const out = migrateConfig({ version: 1 })
    expect(out.layout).toEqual(DEFAULT_APP_CONFIG.layout)
  })

  it('用户**亲手拖出来的宽度**必须留住（迁移不等于重置）', () => {
    // 迁移最容易犯的错就是「顺手 normalize 一下」把真实数据也洗掉了。
    // 这里断言的是「搬过去之后还是他拖的那个值」。
    //
    // 【⚠️ 这里刻意只写三个字段中的两个 —— 主区宽度**不存在**】
    // 我第一版把这个 fixture 写成了 `{ sidebarSize, mainSize, rightPanelSize }`，
    // 测试当场红了，查下来是**我记错了 schema**：`LayoutConfig` 里没有 mainSize，
    // 主区宽度由 `mainSizeOf()` 现算（`100 - 左 - 右`），因为它要撑住一条
    // 「三栏加起来正好 100」的不变量 —— 见 layout.ts 开头那段。
    // 留着这行注释是因为「拖出来的宽度会被存下来」这个说法**听起来就该存三个数**，
    // 下一个改这里的人多半也会这么记。
    //
    // 【v18 起这条断言补一个键】migrateConfig 走 normalizeLayout 重建整棵树，
    // v18 新加的 sidebarRail（三态标志）会被补成 false —— 这是**增量**，
    // 不是把老值洗掉：四个老键仍然逐一等于他拖出来的值。
    const dragged = { sidebarSize: 21, sidebarOpen: true, rightPanelSize: 24, rightPanelOpen: false }
    expect(migrateConfig({ version: 1, layout: dragged }).layout).toEqual({
      ...dragged,
      sidebarRail: false
    })
  })

  it('layout 里混着 NaN 时被 normalizeLayout 挡掉，不会落成一个塌掉的栏', () => {
    // NaN 能穿过 `Math.min(Math.max(...))`（和谁比都是 false），
    // 写进文件之后那一栏直接塌成 0，而配置已经改不回来了。
    const out = migrateConfig({ layout: { sidebarSize: NaN, rightPanelSize: '22' } })
    expect(Number.isFinite(out.layout.sidebarSize)).toBe(true)
    expect(Number.isFinite(out.layout.rightPanelSize)).toBe(true)
    expect(out.layout.sidebarSize).toBe(DEFAULT_APP_CONFIG.layout.sidebarSize)
    expect(out.layout.rightPanelSize).toBe(DEFAULT_APP_CONFIG.layout.rightPanelSize)
  })
})

// ---------------------------------------------------------------- 其余字段

describe('其余字段的兜底', () => {
  it('runTimeoutSec 被钳进 [MIN, MAX]，超范围的也不放行', () => {
    // 边界值和 MIN/MAX 常量绑在一起断言：哪天区间改了，这里会跟着变，
    // 不会变成一组「写着 1 和 60、实际早就不对了」的假绿。
    expect(migrateConfig({ runTimeoutSec: 999 }).runTimeoutSec).toBe(MAX_TIMEOUT_SEC)
    expect(migrateConfig({ runTimeoutSec: 0 }).runTimeoutSec).toBe(MIN_TIMEOUT_SEC)
    expect(migrateConfig({ runTimeoutSec: -5 }).runTimeoutSec).toBe(MIN_TIMEOUT_SEC)
    expect(migrateConfig({ runTimeoutSec: 10 }).runTimeoutSec).toBe(10)
  })

  it('runTimeoutSec 是 NaN / 字符串时退回默认值（**不是**被钳成 MIN）', () => {
    // 这两条路的区别很重要：NaN 是「这个值没意义」，不是「用户想要最小超时」。
    // 钳成 1 秒的话，学员每一段死循环代码都会在 1 秒后被掐断，
    // 而他以为是自己的程序跑不动。
    expect(migrateConfig({ runTimeoutSec: NaN }).runTimeoutSec).toBe(
      DEFAULT_APP_CONFIG.runTimeoutSec
    )
    expect(migrateConfig({ runTimeoutSec: '30' }).runTimeoutSec).toBe(
      DEFAULT_APP_CONFIG.runTimeoutSec
    )
  })

  it('baseUrl / model 是空白串时退回默认值（空串不能让 AI 请求发出去）', () => {
    const out = migrateConfig({ ai: { baseUrl: '   ', model: '' } })
    expect(out.ai.baseUrl).toBe(DEFAULT_APP_CONFIG.ai.baseUrl)
    expect(out.ai.model).toBe(DEFAULT_APP_CONFIG.ai.model)
  })

  it('envCache 不是对象时当空的重算一遍（代价只是多跑一次检测）', () => {
    for (const raw of [{ envCache: 'x' }, { envCache: [] }, { envCache: null }]) {
      expect(migrateConfig(raw).envCache).toEqual({})
    }
  })

  it('envCache 是对象时原样带过去（它是主进程写穿的缓存，值由 env:detect 保证）', () => {
    // 迁移**不检查**这个字段里面的形状。理由：它只可能是我们自己写的，
    // 而且检查的成本（要完整复刻 EnvCache 的校验）远大于收益（重算一次而已）。
    const cache = { at: 123, report: {} }
    expect(migrateConfig({ envCache: cache }).envCache).toEqual(cache)
  })
})

// ---------------------------------------------------------------- 坏输入

describe('输入整份坏掉时：给默认值，但**必须出声**', () => {
  it('不是对象（数组 / 字符串 / null）→ 默认配置 + console.warn', () => {
    // 铁律里明令禁止的是「静默重建」。重建可以，不许不留痕 ——
    // 不然用户报「我的设置全没了」时，日志里一个字都没有。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of [null, undefined, 42, 'nope', []]) {
        expect(migrateConfig(raw)).toEqual(DEFAULT_APP_CONFIG)
      }
      expect(warn).toHaveBeenCalledTimes(5)
    } finally {
      warn.mockRestore()
    }
  })

  it('返回的是**深拷贝**：改产物不会污染 DEFAULT_APP_CONFIG', () => {
    // `DEFAULT_APP_CONFIG` 是模块级单例，全进程共用一份。
    // 不克隆的话，任何一次「拿到默认配置之后顺手改一改」都会**永久改掉默认值**，
    // 而且影响的是之后所有人的所有读取 —— 一个改坏、全局中毒。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = migrateConfig(null)
      out.ai.apiKey = 'MUTATED'
      out.layout.sidebarSize = 999
      expect(DEFAULT_APP_CONFIG.ai.apiKey).toBe('')
      expect(DEFAULT_APP_CONFIG.layout).not.toEqual({ ...out.layout })
    } finally {
      warn.mockRestore()
    }
  })

  it('成功路径**不出声**（别把正常情况也喊成异常）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      migrateConfig(current())
      migrateConfig({ version: 1 })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

// ---------------------------------------------------------------- 幂等

describe('幂等：迁过的配置再迁一次**什么都不变**', () => {
  it('migrate(migrate(x)) === migrate(x)', () => {
    // 这条守的是「主进程每次读配置都会跑一遍迁移」这个事实。
    // 不幂等的话，用户每重启一次应用，某些值就漂移一点 ——
    // 而漂移是单向累积的，几天后配置就面目全非了。
    const once = migrateConfig({
      version: 1,
      reviewEnabled: false,
      layout: { sidebarSize: 20 },
      nativeIdePath: 'C:/tools/devcpp.exe',
      nativeRunQuiet: true
    })
    // 顺手钉住第一遍真的做了 v8 → v9 分发（不然后面那条相等断言
    // 对「压根没迁这个字段」的实现也会绿）
    expect(once.nativeIdePaths.c).toBe('C:/tools/devcpp.exe')
    expect(migrateConfig(once)).toEqual(once)
  })

  it('已经是对的了的一份配置，迁完还是它自己', () => {
    const cfg = current()
    expect(migrateConfig(cfg)).toEqual(cfg)
  })
})
