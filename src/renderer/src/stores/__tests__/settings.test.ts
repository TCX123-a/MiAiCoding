/**
 * 设置 store 的存取（stores/settings.ts）
 *
 * 【这个文件在守什么】
 * 守的是**「保存设置」这个动作不会顺手伤到别的东西**。它有三个静默失效的方式：
 *
 *   1. **把用户的 Key 抹了**。渲染进程拿不到真 Key（只有 hasKey 布尔），
 *      所以它保存时必然带着「空」回来。这个「空」被当成「不改」还是「清空」，
 *      决定了用户会不会每改一次别的设置就丢一次 Key。
 *   2. **把 Key 又传回来了**。三态里最危险的是「某天有人为了类型对齐，
 *      把真 Key 从界面回传一遍」—— 那等于把 Key 重新暴露进渲染进程。
 *   3. **把别的字段清空了**。保存超时时间时如果把 baseUrl 带成空串，
 *      下一个请求就发到一个不存在的地址。
 *
 * 三条都不报错、不崩溃，全靠这里钉住。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isReactive, reactive } from 'vue'
import { useSettingsStore } from '../settings'
import { CURRENT_CONFIG_VERSION, defaultPetConfig, emptyIdePaths, type ConfigSavePayload, type PublicAppConfig } from '../../../../shared/types'
import { DEFAULT_LAYOUT, SIDEBAR_MAX_SIZE } from '../../../../shared/layout'
import { defaultWallpaper } from '../../../../shared/wallpaper'
import { defaultSplash } from '../../../../shared/splash'

/**
 * 主进程会发回来的那份（**注意：没有 apiKey**）。
 *
 * `version` 走 `CURRENT_CONFIG_VERSION` 而不是写死 1：这里模拟的是
 * 「`toPublicConfig()` 的产出」，而它产出的**永远是当前版本**（readConfig 先迁移）。
 * 写死一个数字，等下次 bump 时会变成一个和现实不符、却又没人会注意的假货。
 */
function publicConfig(over: Partial<PublicAppConfig> = {}): PublicAppConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    reviewEnabled: true,
    runTimeoutSec: 10,
    soundEnabled: true,
    theme: 'light',
    // 新增字段要跟着补上：`PublicAppConfig` 是必填形状，漏了它 typecheck 会红。
    // 取值写 false（= 生产默认值）—— 写 true 会让这份夹具看起来像
    // 「主进程发回来的原生模式是开着的」，而默认是关，夹具得照默认写。
    nativeRunEnabled: false,
    // 同一条规矩（见上一行）：`nativeRunQuiet` 也是必填，取值照生产默认值
    // 写 false（继续每次询问）——写 true 会让这份夹具看起来像
    // 「主进程发回来的配置里已经勾过不再提醒」，而默认是没勾。
    nativeRunQuiet: false,
    // 同一条规矩（见上一行）：`favWrongToBook` 也是必填，取值照生产默认值写 true
    // ——「收藏练习答错照样进错题本」是全应用的既有性子，夹具写成别的就测不出
    // 「保存一次别的设置，这个开关被静默关掉」那类问题
    favWrongToBook: true,
    // 同类：`nativeIdePaths` 也是必填（v9 起是四键表），取值照生产默认值写
    // 四键全空（未配置）。写个假路径会让这份夹具看起来像「主进程发回来的
    // 配置里配好了本地 IDE」，而默认就是没配 —— 夹具得照默认写。
    nativeIdePaths: emptyIdePaths(),
    // 取值写 100（= 生产默认值，满音量）。夹具的作用是"照主进程会发回来的样子写"，
    // 所以这一项也得照默认值写，不能随手填个 50 图方便 —— 那样一来，
    // 「没拨过音量的用户保存一次别的设置，音量被改成 50」这类问题就永远测不出来。
    sfxVolume: 100,
    layout: { ...DEFAULT_LAYOUT },
    // 同类（见上一行）：`wallpaper` 也是必填（v10），取值照生产默认值写
    // —— 「默认开、没选、只垫渐变底」。这份默认本身就是个功能口径（决策点 7），
    // 夹具写别的会让「保存一次别的设置，壁纸设置被静默洗掉」那类问题测不出来。
    wallpaper: defaultWallpaper(),
    // 同类（v14）：`splash` 也是必填，取值照生产默认值写 —— 「默认开、
    // 随机、静音」。这份默认是主人 2026-10-05 批复的口径，夹具写别的会让
    // 「保存一次别的设置，开屏设置被静默洗掉」那类问题测不出来。
    splash: defaultSplash(),
    // 同类（v17）：`pet` 也是必填，取值照生产默认值写 —— 「默认开 /
    // 462px / 右下角」。写别的会让「保存一次别的设置，桌宠设置被静默洗掉」
    // 那类问题测不出来（host 侧 applySettings 正是拿这个块去重启宠物的）。
    pet: defaultPetConfig(),
    envCache: {},
    ai: { hasKey: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', dynamicEnabled: false },
    ...over
  }
}

/**
 * 装上假的 window.miai，记下每次 saveConfig 收到的入参。
 *
 * ⚠️ 这里**故意用 `structuredClone`**，不是随手写的。真实的
 * `ipcRenderer.invoke` 用的就是这个算法，而它**克隆不了 Vue 的响应式代理** ——
 * 会抛 `An object could not be cloned`。用同一个算法做假货，
 * 才能让「入参里混进了代理」这类问题在测试里就现形，而不是等用户点保存时才发现。
 * （这个 bug 真的存在过，就是这条抓出来的，详见 settings.ts 的 save()。）
 */
function stubMiai(cfg: PublicAppConfig = publicConfig()): ConfigSavePayload[] {
  const sent: ConfigSavePayload[] = []
  ;(globalThis as unknown as { window: unknown }).window = {
    miai: {
      getConfig: () => Promise.resolve(structuredClone(cfg)),
      saveConfig: (p: ConfigSavePayload) => {
        sent.push(structuredClone(p))
        return Promise.resolve()
      },
      detectEnv: () => Promise.resolve({})
    }
  }
  return sent
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// ---------------------------------------------------------------- Key 不会被误伤

describe('改别的设置，绝不会碰到 Key', () => {
  it('**入参里根本没有 apiKey 这个字段**（不是空串 —— 是压根没有）', async () => {
    // 这是整件事的关键。空串和「没有」在 main 那边**语义相同**（都是不改），
    // 但带上空串留了一个后患：哪天 main 把空串改判成「清空」，
    // 每一次保存别的设置都会静默抹掉用户的 Key。少带一个字段，这条路就不存在。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent).toHaveLength(1)
    expect('apiKey' in sent[0].ai).toBe(false)
  })

  it('保存超时时间也不会顺手清掉服务地址和模型', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ runTimeoutSec: 30 })

    expect(sent[0].ai).toEqual({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      dynamicEnabled: false
    })
    expect(sent[0].runTimeoutSec).toBe(30)
  })

  it('保存时**不会把 hasKey 带进入参** —— 它是返回体的字段，不该出现在入参里', async () => {
    const sent = stubMiai(publicConfig({ ai: { hasKey: true, baseUrl: 'x', model: 'y', dynamicEnabled: false } }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: true })

    expect('hasKey' in sent[0].ai).toBe(false)
  })
})

// ---------------------------------------------------------------- 夜间模式

/*
 * 【这一节守什么】「夜间模式存不住」这条路上，**任何一环断了都不报错** ——
 * 表现只是「下次打开又变回浅色了」，用户多半会以为是自己的错觉。
 *
 * 完整那条链是：界面 → `update()` → `save()` 拼 payload → IPC →
 * `mergeConfigPayload` → config.json → 下次启动 → `toPublicConfig` → 界面。
 * 这里钉的是**渲染进程这半截**：`save()` 的入参里到底带没带 theme。
 *
 * 【为什么专挑这里钉】`save()` 是**逐字段拼**出来的（故意不 spread，理由见它的注释），
 * 所以每加一个配置字段，最容易漏的就是它。漏了的话，在这里是被一条断言抓住，
 * 在真窗口里得**重启整个应用**再看一遍才发现 —— 贵得多。
 */
describe('夜间模式：theme 必须真的被送出去', () => {
  it('切成 dark → 入参里 theme 就是 dark', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ theme: 'dark' })

    expect(sent).toHaveLength(1)
    expect(sent[0].theme).toBe('dark')
  })

  it('切回 light 也是**明确送 light**，不是省略这个字段', async () => {
    // 「省略字段」的语义是「这次不改」（和 baseUrl / model 一样）。
    // 真省略了的话，用户从夜间切回白天**永远切不回来**，而且重启后依旧是夜间 ——
    // 看着就像「夜间模式关不掉了」。
    const sent = stubMiai(publicConfig({ theme: 'dark' }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ theme: 'light' })

    expect(sent[0].theme).toBe('light')
  })

  it('改**别的**设置时，当前的 theme 也会一起带上（不是 undefined）', async () => {
    // 保存是整份配置写盘，所以每一次保存都得把 theme 完整带上。
    // 带上 undefined 的话主进程会退回「保持现有」，本次不坏事；
    // 但文件里那个字段会一直是缺的，谁先打开 config.json 谁懵。
    const sent = stubMiai(publicConfig({ theme: 'dark' }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent[0].theme).toBe('dark')
  })

  it('改 theme 不会顺手把 Key 抹掉（和别的设置同一套规矩）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ theme: 'dark' })

    expect('apiKey' in sent[0].ai).toBe(false)
  })
})

// ---------------------------------------------------------------- 音效音量
//
// 【这一节守什么】和上面 theme 那一节同一个理由：`save()` 是**逐字段拼**出来的，
// 每加一个配置字段，最容易漏的就是它。漏了的话主进程会退回「保持现有」，
// 本次不坏事 —— 但文件里那个字段永远是缺的，而且"拨了音量重启又变回去"
// 这种问题要重启整个应用才看得见。
//
// ⚠️ 音量还多一种坏法，**theme 那边没有**：0 是合法值。用
// `cur.sfxVolume || 100` 之类的写法拼 payload，0 会被顶成 100 ——
// 用户拨到静音、重启，声音全回来了。

describe('音效音量：sfxVolume 必须真的被送出去', () => {
  it('拨到 40 → 入参里就是 40', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ sfxVolume: 40 })

    expect(sent).toHaveLength(1)
    expect(sent[0].sfxVolume).toBe(40)
  })

  it('★ 拨到 **0** → 入参里是 **0**，不是被当成「没带」而丢掉', async () => {
    // `||` / 真值性判断会把 0 变成"缺省"，于是一次静音存不下去。
    // `0` 和 `'0'` 都要区分：后者是字符串，主进程那边会被当脏值退回现有音量。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ sfxVolume: 0 })

    expect(sent[0].sfxVolume).toBe(0)
    expect(typeof sent[0].sfxVolume, '必须是数字 0，不能是字符串').toBe('number')
  })

  it('改**别的**设置时，当前音量也会一起带上（不是 undefined）', async () => {
    const sent = stubMiai(publicConfig({ sfxVolume: 35 }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent[0].sfxVolume).toBe(35)
  })

  it('改音量不会顺手把 Key 抹掉 / 把主题顶回浅色（每加一条写入口都要再验一次）', async () => {
    const sent = stubMiai(publicConfig({ theme: 'dark' }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ sfxVolume: 20 })

    expect('apiKey' in sent[0].ai).toBe(false)
    expect(sent[0].theme).toBe('dark')
  })
})

// ---------------------------------------------------------------- 清除 Key

describe('清除 Key 是唯一能真的删掉它的路', () => {
  it('**发出去的是 null，不是空串**', async () => {
    // 空串的语义是「这次不改」（界面本来就不知道真 Key）。
    // 只有 null 能表达「我要删掉它」—— 少了这条路，用户填错一次就再也删不掉了。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.clearAiKey()

    expect(sent[0].ai.apiKey).toBeNull()
  })

  it('清完之后界面立刻显示「未配置」（不用等重新读配置）', async () => {
    const sent = stubMiai(publicConfig({ ai: { hasKey: true, baseUrl: 'x', model: 'y', dynamicEnabled: false } }))
    const s = useSettingsStore()
    await s.load()
    expect(s.config.ai.hasKey).toBe(true)

    await s.clearAiKey()
    expect(s.config.ai.hasKey).toBe(false)
  })

  it('清 Key 不会连带清掉服务地址和模型', async () => {
    const sent = stubMiai(publicConfig({ ai: { hasKey: true, baseUrl: 'x', model: 'y', dynamicEnabled: false } }))
    const s = useSettingsStore()
    await s.load()
    await s.clearAiKey()

    expect(sent[0].ai.baseUrl).toBe('x')
    expect(sent[0].ai.model).toBe('y')
  })
})

// ---------------------------------------------------------------- 保存新 Key

describe('保存新 Key', () => {
  it('传什么发什么', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.updateAi({ apiKey: 'sk-new-key' })

    expect(sent[0].ai.apiKey).toBe('sk-new-key')
  })

  it('改模型时**不会**把 Key 一起带上（那条路走不通，也不该走）', async () => {
    const sent = stubMiai(publicConfig({ ai: { hasKey: true, baseUrl: 'x', model: 'old', dynamicEnabled: false } }))
    const s = useSettingsStore()
    await s.load()
    await s.updateAi({ model: 'deepseek-reasoner' })

    expect(sent[0].ai.model).toBe('deepseek-reasoner')
    expect('apiKey' in sent[0].ai).toBe(false)
  })

  it('AI 动态出题开关能存下来，且**不会顺手带上 Key**', async () => {
    const sent = stubMiai(
      publicConfig({ ai: { hasKey: true, baseUrl: 'x', model: 'y', dynamicEnabled: false } })
    )
    const s = useSettingsStore()
    await s.load()
    await s.updateAi({ dynamicEnabled: true })

    expect(sent[0].ai.dynamicEnabled).toBe(true)
    expect('apiKey' in sent[0].ai).toBe(false)
  })

  it('`markKeySaved()` 让界面从「未配置」翻成「已配置」', async () => {
    // 不翻的话，用户填完 Key 点保存，界面上还写着「未配置」——
    // 他会以为没存进去，反复重填。
    stubMiai()
    const s = useSettingsStore()
    await s.load()
    expect(s.config.ai.hasKey).toBe(false)

    s.markKeySaved()
    expect(s.config.ai.hasKey).toBe(true)
  })
})

// ---------------------------------------------------------------- 能被 IPC 送出去

describe('入参必须能被结构化克隆（IPC 就靠它）', () => {
  it('**响应式代理克隆不了** —— 这是那个 bug 的成因，留在这里当证据', () => {
    // 先把这个「为什么」钉住：代理不是「有点怪」的对象，是**根本送不出去**。
    // 哪天有人看到 save() 里的 toRaw 觉得多余想删掉，这条会提醒他代价是什么。
    const proxy = reactive({ a: 1 })
    expect(() => structuredClone(proxy)).toThrow()
  })

  it('store 交出来的入参**是能克隆的纯对象**（三条路都验一遍）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    // 每条路都走一遍：普通的改、改 AI、清 Key
    await s.update({ reviewEnabled: false })
    await s.updateAi({ model: 'x' })
    await s.clearAiKey()

    expect(sent).toHaveLength(3)
    // 假 saveConfig 内部已经克隆过一次了（克隆失败会直接抛），
    // 这里再显式验一次，是为了让「这条测试在守什么」读起来一目了然
    for (const p of sent) {
      expect(() => structuredClone(p)).not.toThrow()
    }
  })

  it('嵌套的 envCache 也不能是代理（代理藏在里层，顶层是看不出来的）', async () => {
    // 最容易漏的就是它：顶层字段是数字和布尔，读出来天然是原始值，
    // 看起来一切正常；而 envCache 是个对象，读出来是代理。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: true })

    expect(() => structuredClone(sent[0].envCache)).not.toThrow()
    expect(isReactive(sent[0].envCache)).toBe(false)
  })
})

// ---------------------------------------------------------------- 读配置

describe('读配置', () => {
  it('主进程给什么就用什么（界面不自己猜 hasKey）', async () => {
    stubMiai(publicConfig({ ai: { hasKey: true, baseUrl: 'https://proxy.local', model: 'x', dynamicEnabled: false } }))
    const s = useSettingsStore()
    await s.load()

    expect(s.config.ai.hasKey).toBe(true)
    expect(s.config.ai.baseUrl).toBe('https://proxy.local')
    expect(s.loaded).toBe(true)
  })

  it('**没 load 之前不许 save** —— 那会用默认值把用户的真实设置顶掉', async () => {
    // 这条不是在测「它坏了」，是在把一条**前提**写下来：
    // store 初值是 DEFAULT_APP_CONFIG，没 load 就 save 等于拿默认值覆盖真配置。
    // Key 不受影响（入参里没有它），但 baseUrl / 模型会被打回默认。
    const sent = stubMiai(publicConfig({ ai: { hasKey: true, baseUrl: 'https://proxy.local', model: 'x', dynamicEnabled: false } }))
    const s = useSettingsStore()

    await s.update({ runTimeoutSec: 30 }) // ← 故意不 load
    expect(sent[0].ai.baseUrl).toBe('https://api.deepseek.com') // 已经把真实值顶掉了

    // 所以调用方（设置页）必须**先 load 再改**。这条断言是给下一个人的告示牌。
  })
})

// ---------------------------------------------------------------- 三栏布局
//
// 【这一节守什么】
// `setLayout` 是「拖完分隔条」和「收起/展开右栏」唯一的写入口，而它坏掉的方式
// 全是静默的 —— 存进去的是整份配置，所以**漏一个字段就等于把那个字段重置成默认**：
//   - 拖个宽度，右栏莫名其妙被展开了
//   - 收个右栏，拖好的宽度被打回默认（用户会以为「宽度本来就存不住」）
// 两种都不报错，重开一次才能发现。

describe('改布局：存下去的那一节必须是完整的', () => {
  it('**五个键一个不少** —— 漏一个就等于把它重置成默认', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setLayout({ sidebarSize: 25 })
    expect(sent[0].layout).toEqual({
      sidebarSize: 25,
      sidebarOpen: true,
      sidebarRail: false,
      rightPanelSize: 22,
      rightPanelOpen: true
    })
  })

  it('只改宽度**不会顺手把右栏关掉**（漏字段最典型的翻车方式）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setLayout({ sidebarSize: 20 })
    expect(sent[0].layout.rightPanelOpen).toBe(true)
  })

  it('**收起右栏不会把拖好的宽度打回默认**', async () => {
    // 这条是给用户看的那个承诺：宽度是拖出来的，不该被一次开合抹掉。
    const sent = stubMiai(
      publicConfig({
        layout: {
          sidebarSize: 27,
          sidebarOpen: true,
          sidebarRail: false,
          rightPanelSize: 30,
          rightPanelOpen: true
        }
      })
    )
    const s = useSettingsStore()
    await s.load()

    await s.setLayout({ rightPanelOpen: false })
    expect(sent[0].layout).toEqual({
      sidebarSize: 27,
      sidebarOpen: true,
      sidebarRail: false,
      rightPanelSize: 30,
      rightPanelOpen: false
    })
  })

  it('本地状态也跟着变 —— 不然拖完手一松，界面会弹回原处', async () => {
    stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setLayout({ sidebarSize: 25, rightPanelOpen: false })
    expect(s.config.layout).toEqual({
      sidebarSize: 25,
      sidebarOpen: true,
      sidebarRail: false,
      rightPanelSize: 22,
      rightPanelOpen: false
    })
  })

  it('rail 标志走同一个入口存取（v18 三态）—— 其余四键原样带上，宽度不动', async () => {
    // ☰ 按钮的落点：App.vue 的 toggleSidebar 就是拿 sidebarTogglePatch(layout)
    // 来调 setLayout 的。这条钉住「补丁式入参 + 整份重建」这条链路对 rail 也成立 ——
    // 三个键里漏带一个（比如把 sidebarSize 落成默认）用户展开时就会发现宽度没了。
    const sent = stubMiai(
      publicConfig({
        layout: {
          sidebarSize: 27,
          sidebarOpen: true,
          sidebarRail: false,
          rightPanelSize: 30,
          rightPanelOpen: true
        }
      })
    )
    const s = useSettingsStore()
    await s.load()

    await s.setLayout({ sidebarRail: true })
    expect(sent[0].layout).toEqual({
      sidebarSize: 27,
      sidebarOpen: true,
      sidebarRail: true,
      rightPanelSize: 30,
      rightPanelOpen: true
    })
  })

  it('越界值在**进 IPC 之前**就被钳住（主进程那道是第二道，不该指望它兜底）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setLayout({ sidebarSize: 999 })
    expect(sent[0].layout.sidebarSize).toBe(SIDEBAR_MAX_SIZE)
  })

  it('改布局**同样不碰 Key**（这个文件的主线，每加一条写入口都要再验一次）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setLayout({ rightPanelOpen: false })
    expect('apiKey' in sent[0].ai).toBe(false)
  })

  it('**入参里混进了代理也能送出去** —— layout 是纯函数重建出来的新对象', async () => {
    // stubMiai 内部就是用 structuredClone 收的货，克隆不了会当场抛。
    // 这条钉住「setLayout 的入参没有把响应式对象原样带进去」。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await expect(s.setLayout({ sidebarSize: 25 })).resolves.toBeUndefined()
    expect(() => structuredClone(sent[0].layout)).not.toThrow()
  })
})

// ---------------------------------------------------------------- 壁纸设置（v10）
//
// 【这一节守什么】`setWallpaper` 是设置卡片滑杆「松手落盘」和选壁纸的唯一
// 写入口，坏法和 layout 完全同构但**多一个坑**：wallpaper 是**四层深**的
// 响应式对象（rotation/parallax/audio/power 子块里还有子块），浅展开挡不住
// 子块里的代理 —— 代理混进 ipcRenderer.invoke 的结构化克隆就是那句经典的
// 「改了设置、看着生效了、重开又变回去」，一个字都不报。所以这里的
// stubMiai（内部真用 structuredClone 收货）就是主闸门。

describe('改壁纸设置：整块完整，子块不许带代理', () => {
  it('只改一个键，其余键（含子块）原值全保住', async () => {
    const cfg = publicConfig()
    cfg.wallpaper.dim = 60
    cfg.wallpaper.selectedId = '3284636810'
    cfg.wallpaper.power.pauseOnBlur = false
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()
    await s.setWallpaper({ blur: 8 })

    const w = sent[0].wallpaper
    expect(w.blur).toBe(8)
    expect(w.dim).toBe(60)
    expect(w.selectedId).toBe('3284636810')
    expect(w.power.pauseOnBlur).toBe(false)
  })

  it('★ 入参能被 structuredClone（代理回归闸）—— 四层深，浅展开救不了它', async () => {
    // stubMiai 用的就是 ipcRenderer.invoke 同款算法：克隆不了当场抛。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await expect(s.setWallpaper({ dim: 40 })).resolves.toBeUndefined()
    expect(() => structuredClone(sent[0].wallpaper)).not.toThrow()
    // 子块必须是普通对象（Object 原型），不是 Proxy
    expect(Object.getPrototypeOf(sent[0].wallpaper.power)).toBe(Object.prototype)
  })

  it('**本地镜像也要用新值**（不然滑杆松手弹回原处）', async () => {
    stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setWallpaper({ dim: 40, flip: true })
    expect(s.config.wallpaper.dim).toBe(40)
    expect(s.config.wallpaper.flip).toBe(true)
  })

  it('越界值**进 IPC 之前**就被 normalizeWallpaper 钳住（主进程那道是第二道）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setWallpaper({ dim: 999, brightness: Number.NaN })
    expect(sent[0].wallpaper.dim).toBe(100)
    expect(sent[0].wallpaper.brightness).toBe(1)
  })

  it('改壁纸**同样不碰 Key**（这个文件的主线，每加一条写入口都要再验一次）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setWallpaper({ dim: 40 })
    expect('apiKey' in sent[0].ai).toBe(false)
  })

  it('改**别的**设置时 wallpaper 整块照带（漏带 = 主进程听现有的，本次不坏、规矩名存实亡）', async () => {
    const cfg = publicConfig()
    cfg.wallpaper.dim = 55
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent[0].wallpaper.dim).toBe(55)
  })
})

// ---------------------------------------------------------------- 隐藏壁纸（v16）

/**
 * 【这一节守什么】`toggleHiddenWallpaper` 是「隐藏」功能的唯一写入口
 * （选择弹窗与设置页池子行的眼睛按钮都调它）。它必须：
 *   · 基于**未经展示层过滤的完整现值**算（让面板拿视图里的集合来拼，
 *     会把别处刚隐藏的条目悄悄挤掉）；
 *   · 追加/删除都走整块落盘（同 setWallpaper 三条：整份写盘、子块不带代理）；
 *   · 空 id 是 no-op —— '' 表示「没选」，不是一张真实壁纸。
 */
describe('隐藏壁纸（v16）：整块落盘、幂等 toggle、空 id 不动', () => {
  it('隐藏一张：追加到末尾，其余壁纸键原值全保住', async () => {
    const cfg = publicConfig()
    cfg.wallpaper.dim = 60
    cfg.wallpaper.rotation.pool = ['3284636810', 'custom:star.png']
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()
    await s.toggleHiddenWallpaper('3284636810')

    const w = sent[0].wallpaper
    expect(w.hidden).toEqual(['3284636810'])
    expect(w.dim).toBe(60)
    expect(w.rotation.pool).toEqual(['3284636810', 'custom:star.png'])
  })

  it('再 toggle 一次 = 取消隐藏（在列表里就删，保序）且本地镜像同步', async () => {
    const cfg = publicConfig()
    cfg.wallpaper.hidden = ['a', 'b', 'c']
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()
    await s.toggleHiddenWallpaper('b')

    expect(sent[0].wallpaper.hidden).toEqual(['a', 'c'])
    expect(s.config.wallpaper.hidden).toEqual(['a', 'c'])
  })

  it('★ 空 id 是 no-op —— 一条 IPC 都不发（空串不是合法条目）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.toggleHiddenWallpaper('')
    expect(sent).toHaveLength(0)
  })

  it('★ 入参能被 structuredClone，且 hidden 是全新数组（代理回归闸）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await expect(s.toggleHiddenWallpaper('x')).resolves.toBeUndefined()
    expect(() => structuredClone(sent[0].wallpaper)).not.toThrow()
    // 落盘那份不是本地镜像那份引用（normalizeWallpaper 整树新造）
    expect(sent[0].wallpaper.hidden).not.toBe(s.config.wallpaper.hidden)
  })

  it('改**别的**设置时 hidden 照带（漏带 = 主进程听现有的，功能名存实亡）', async () => {
    const cfg = publicConfig()
    cfg.wallpaper.hidden = ['secret']
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent[0].wallpaper.hidden).toEqual(['secret'])
  })
})

// ---------------------------------------------------------------- 开屏设置（v14）
//
// 【这一节守什么】`setSplash` 是设置卡片开关/音量滑杆的唯一写入口。
// splash 比 wallpaper 浅（扁平块 + 一个池子数组），但有两个自己的坑：
//   · 池子数组是**响应式数组**——展开成 `{...cur.splash}` 时数组引用被原样
//     带过去，代理混进结构化克隆同样是那句「改了设置、重开又变回去」；
//   · enabled/sound 的 **false 是合法值**——任何「假值当没带」的写法都会让
//     用户关掉的开关自己跳回来。所以「假值往返」在本节单独钉一条。
// stubMiai（内部真用 structuredClone 收货）依然是主闸门。

describe('改开屏设置：整块完整、池子不带代理、假值往返不丢', () => {
  it('只改一个键，其余键（含池子）原值全保住', async () => {
    const cfg = publicConfig()
    cfg.splash.enabled = false
    cfg.splash.pick = 'fixed'
    cfg.splash.fixedFile = 'nd-cyberpunk.mp4'
    cfg.splash.pool = ['nd-cyberpunk.mp4', 'nd-brand.mp4']
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()
    await s.setSplash({ volume: 40 })

    const sp = sent[0].splash
    expect(sp.volume).toBe(40)
    expect(sp.enabled).toBe(false)
    expect(sp.pick).toBe('fixed')
    expect(sp.fixedFile).toBe('nd-cyberpunk.mp4')
    expect(sp.pool).toEqual(['nd-cyberpunk.mp4', 'nd-brand.mp4'])
  })

  it('★ 入参能被 structuredClone（代理回归闸）—— 池子数组也必须是全新普通数组', async () => {
    const cfg = publicConfig()
    cfg.splash.pool = ['a.mp4', 'b.mp4']
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()

    await expect(s.setSplash({ sound: true })).resolves.toBeUndefined()
    expect(() => structuredClone(sent[0].splash)).not.toThrow()
    expect(Object.getPrototypeOf(sent[0].splash)).toBe(Object.prototype)
    // 池子不是入参那份引用：normalizeSplash 整树新造，这里从防线外再确认一次
    expect(sent[0].splash.pool).not.toBe(cfg.splash.pool)
  })

  it('**假值往返**：关掉开屏/静音保存后，入参里它们仍是 false（不许被当"没带"回成 true）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setSplash({ enabled: false })
    await s.setSplash({ sound: false, volume: 0 })
    expect(sent[0].splash.enabled).toBe(false)
    expect(sent[1].splash.sound).toBe(false)
    expect(sent[1].splash.volume).toBe(0)
  })

  it('**本地镜像也要用新值**（不然开关/滑杆松手弹回原处）', async () => {
    stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setSplash({ enabled: false, volume: 30 })
    expect(s.config.splash.enabled).toBe(false)
    expect(s.config.splash.volume).toBe(30)
  })

  it('越界值**进 IPC 之前**就被 normalizeSplash 钳住（主进程那道是第二道）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setSplash({ volume: 999, pick: 'FIXED' as never })
    expect(sent[0].splash.volume).toBe(100)
    expect(sent[0].splash.pick).toBe('random')
  })

  it('改开屏**同样不碰 Key**（这个文件的主线，每加一条写入口都要再验一次）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await s.setSplash({ enabled: false })
    expect('apiKey' in sent[0].ai).toBe(false)
  })

  it('改**别的**设置时 splash 整块照带（漏带 = 主进程听现有的，本次不坏、规矩名存实亡）', async () => {
    const cfg = publicConfig()
    cfg.splash.volume = 55
    const sent = stubMiai(cfg)

    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent[0].splash.volume).toBe(55)
  })
})

// ---------------------------------------------------------------- 本地 IDE 路径
//
// 【这一节守什么】`save()` 是**逐字段拼**出来的（故意的，理由见它的注释），
// 每加一个配置字段，最容易漏的就是它。`nativeIdePaths`（v9：每语言四键）
// 的三种漏法都不报错：
//   · 改**别的**设置时漏带 → 主进程退回「保持现有」，本次不坏事，
//     但「每次必带全量值」这条规矩就名存实亡（和 theme / sfxVolume 同款用例）；
//   · 改**它自己**时漏带 → 用户点了「清除」也清不掉；
//   · 还有一条**和 apiKey 正好相反**的：它每次都必须带全量四键（哪怕值是空串）。
//     apiKey 带空串会留一个「哪天主进程改判就全量抹 Key」的后患；
//     nativeIdePaths 的空串是**用户的真实选择**（pickIdePaths 里 '' = 清空该键）——
//     少了它，清除按钮就是摆设。两条方向相反的规矩住在同一个 save() 里。
//
// 【setIdePath 为什么要单测】「打开时现检现荐」落盘走的就是它。它把
// `config.value.nativeIdePaths`（**嵌套响应式对象**）展开成新对象再送 ——
// 少展开一层的话，代理会一路混进 ipcRenderer.invoke 的结构化克隆，
// 表现为「检测到了程序、也"选了"，但配置一个字节没写进去」。

describe('本地 IDE 路径：和 apiKey 恰好相反 —— 每次都必须带上（v9 四键表）', () => {
  it('★ setIdePath 只改**一门**语言的格子，其余三键原值保住', async () => {
    // 覆盖写（只带改掉的那一键、或整表清空重来）会把另外三门语言
    // 配好的路径静默抹掉 —— 用户点一次「检测 C」，Java 那格就空了。
    const sent = stubMiai(
      publicConfig({
        nativeIdePaths: { c: '', cpp: 'D:\\old\\cpp.exe', java: 'D:\\old\\idea64.exe', python: '' }
      })
    )
    const s = useSettingsStore()
    await s.load()
    await s.setIdePath('c', 'C:\\Program Files (x86)\\Dev-Cpp\\devcpp.exe')

    expect(sent).toHaveLength(1)
    expect(sent[0].nativeIdePaths).toEqual({
      c: 'C:\\Program Files (x86)\\Dev-Cpp\\devcpp.exe',
      cpp: 'D:\\old\\cpp.exe',
      java: 'D:\\old\\idea64.exe',
      python: ''
    })
  })

  it('★ setIdePath 的入参能过 structuredClone（响应式代理不许混进去）', async () => {
    // stubMiai 内部就是用 structuredClone 收的货，克隆不了会当场抛 ——
    // 这条钉住「setIdePath 没有把 config.value.nativeIdePaths 直接塞进 patch」。
    // （顶层的 toRaw 剥不掉嵌套代理，这是真实踩过的坑，见 update() 的长注释。）
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    await expect(s.setIdePath('java', 'D:\\tools\\idea64.exe')).resolves.toBeUndefined()
    expect(() => structuredClone(sent[0].nativeIdePaths)).not.toThrow()
    expect(sent[0].nativeIdePaths.java).toBe('D:\\tools\\idea64.exe')
  })

  it('★ 清空某键 → 送出的是**空串**，不是省略键（主进程靠空串执行「清空」）', async () => {
    // 省略键在主进程那边是「没改」（pickIdePaths 的逐键 undefined 分支），
    // 空串才是「清空」。这里送错，用户点「清除」后路径会一次次自己回来，
    // 而且没有别的路能删掉它。
    const sent = stubMiai(
      publicConfig({ nativeIdePaths: { ...emptyIdePaths(), java: 'D:\\tools\\idea64.exe' } })
    )
    const s = useSettingsStore()
    await s.load()
    await s.setIdePath('java', '')

    expect('java' in sent[0].nativeIdePaths).toBe(true)
    expect(sent[0].nativeIdePaths.java).toBe('')
    expect(sent[0].nativeIdePaths.cpp, '清 java 不该动到别的键').toBe('')
  })

  it('改**别的**设置时，四键**全量**一起带上（不是 undefined、不是缺键）', async () => {
    // 缺键会被主进程的 pickIdePaths 当成「没改」保留旧值 —— 单看这一次
    // 没坏事，但界面删掉的那一格会"复活"，且和渲染层"恒带全量"的规矩对不上。
    const given = {
      c: 'D:\\tools\\devcpp.exe',
      cpp: '',
      java: 'D:\\tools\\idea64.exe',
      python: ''
    }
    const sent = stubMiai(publicConfig({ nativeIdePaths: given }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent[0].nativeIdePaths).toEqual(given)
  })

  it('★ 与 apiKey 的对照：同一份入参里，一个**必须没有**、一个**必须带着**', async () => {
    // 这两条方向相反的规矩住在同一个 save() 里，最容易被人「统一」成一种：
    // 统一成 apiKey 那样（不带）→ 清除按钮失灵；
    // 统一成本字段这样（带上）→ 每次保存都回传一个空 Key（哪天主进程
    // 把空串改判成「清空」，用户的 Key 就每次保存被抹一遍）。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: true })

    expect('apiKey' in sent[0].ai, 'apiKey 绝不能出现在入参里').toBe(false)
    expect('nativeIdePaths' in sent[0], 'nativeIdePaths 每次都必须带上').toBe(true)
  })
})

// ---------------------------------------------------------------- 不再提醒
//
// 【这一节守什么】同 theme / sfxVolume / nativeIdePaths 三节：`save()` 是
// 逐字段拼出来的，每加一个配置字段最容易漏的就是它。`nativeRunQuiet` 漏带的
// 后果尤其隐蔽：勾了「不再提醒」这一次会话内看着生效（弹窗里的 update 改了
// 内存态），**重启之后弹窗又回来了** —— 用户会以为这个勾选框是个摆设。

describe('不再提醒：nativeRunQuiet 必须真的被送出去', () => {
  it('勾上 → 入参里就是 true', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()
    await s.update({ nativeRunQuiet: true })

    expect(sent).toHaveLength(1)
    expect(sent[0].nativeRunQuiet).toBe(true)
  })

  it('设置页拨回「每次运行前询问」→ 送出**明确的 false**，不是省字段', async () => {
    // 「省略字段」的语义是「这次不改」。真省了的话，用户拨回来之后一重启
    // 又变回「不再提醒」——和 theme 切回 light 那条是同一个坑。
    const sent = stubMiai(publicConfig({ nativeRunQuiet: true }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ nativeRunQuiet: false })

    expect(sent[0].nativeRunQuiet).toBe(false)
  })

  it('改**别的**设置时，当前值也一起带上（不是 undefined）', async () => {
    const sent = stubMiai(publicConfig({ nativeRunQuiet: true }))
    const s = useSettingsStore()
    await s.load()
    await s.update({ reviewEnabled: false })

    expect(sent[0].nativeRunQuiet).toBe(true)
  })
})

// ---------------------------------------------------------------- 外部配置推送（config:external）
//
// 【这一节守什么】桌宠右键菜单「关闭大肥鱼」→ 主进程把 pet.enabled 落成 false
// → 广播 config:external → `applyExternalConfig`。它坏掉的方式都不报错：
//   · 不整份换（比如只当 patch 合并、或者干脆忘了改）→ 设置页开关还是亮的，
//     和"菜单刚把宠物关掉"的事实自相矛盾，用户要重启才被拉取纠正；
//   · 顺手回写（收到推送后又 save 一遍）→ 把主进程刚落的盘当渲染层编辑
//     写回去，两个写方拉锯，甚至把推送内容重放成一次"用户保存"。

describe('外部配置推送：整份换上、绝不回写', () => {
  it('整份换上：pet.enabled 跟着变 false，其余字段照单全收', async () => {
    stubMiai()
    const s = useSettingsStore()
    await s.load()
    expect(s.config.pet.enabled).toBe(true)

    const next = publicConfig({ reviewEnabled: false })
    next.pet = { ...next.pet, enabled: false }
    s.applyExternalConfig(next)

    expect(s.config.pet.enabled).toBe(false)
    expect(s.config.reviewEnabled).toBe(false)
  })

  it('★ 绝不回写：推送到达后一条 saveConfig 都不发（两个写方不许拉锯）', async () => {
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    s.applyExternalConfig(publicConfig())
    expect(sent).toHaveLength(0)
  })

  it('推送落地后，后续写入口拼的仍是新事实（镜像没有被写坏）', async () => {
    // 这条防的是"换上的对象形状不对"：镜像坏了的话，下一次任何保存
    //（这里是 setPet）拼出来的载荷会把 pet.enabled 恢复成 true ——
    // 菜单关掉的宠物被下一次无关保存悄悄复活。
    const sent = stubMiai()
    const s = useSettingsStore()
    await s.load()

    const next = publicConfig()
    next.pet = { ...next.pet, enabled: false }
    s.applyExternalConfig(next)

    await s.setPet({ size: 300 })
    expect(sent[0].pet.enabled).toBe(false)
    expect(sent[0].pet.size).toBe(300)
  })
})
