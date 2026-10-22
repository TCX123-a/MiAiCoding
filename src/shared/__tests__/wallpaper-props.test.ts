/**
 * 壁纸「自带属性」解析器（shared/wallpaper-props.ts，DSH lib/we-props.js 的 TS 移植）。
 *
 * 【这个文件在守什么】全部是「上游按上千个真实属性校准出的反直觉结论」（文件头
 * 那一段），每一条都用真形数据钉住 —— 谁哪天觉得「这样写不优雅」顺手简化，
 * 这里会红：
 *   ① order 按**浮点**读、并列按**码位**（不是 localeCompare）：下面 crazy(32.5)
 *      排在 effect(32) 之后 —— 截断成整数的实现会让两者并列、'crazy' < 'effect'
 *      → 顺序翻转，这条用例就是为它设的；A_order_tie / a_order_tie 同 order 时
 *      'A'(65) 先于 'a'(97)，与声明顺序无关。
 *   ② combo 选项值**保留声明类型**：数字 / 字符串 / 布尔混用是常态（effect 的
 *      三个选项就是 'wave' / 1 / true），统一字符串化会让壁纸里的 === 全部失配。
 *   ③ 文案逐键回退 zh-chs → zh-cht → en-us（不是逐表回退）：custom 只活在
 *      zh-cht 表、wallpaper_file 只活在 en-US 表，zh-chs 表在场但没这两个键 ——
 *      逐表回退的实现会让它们掉到键名。**查表键是 text token**（差异③）：
 *      表里的按属性名写的诱饵条目就是鉴别器；作者表命中还要压过内置词表。
 *   ④ `editable === false` 整条丢弃（严格布尔，照 DSH）；字符串 'false' 是未知
 *      字段值，当没写 —— editable_ish 用它鉴别。
 *   ⑤ 覆盖合并：值必须是三元组才算覆盖，无效覆盖**视为没覆盖**（回落默认值，
 *      不是回落 null）；被丢的条目不会因覆盖复活（hidden 给了覆盖照样不在）。
 *   ⑥ WE_BUILTIN_TEXT 的规模快照（23 键全 ui_ 前缀）：新壁纸带来新键时要先查
 *      官方 locale 表再抄进来、同时把这个数改掉 —— 数字变化 = 一次主动过目。
 *   ⑦ filterKnownOverrides 用在面板写路径（WallpaperPropsPanel.writeItemProps
 *      顺手清作者已删掉的陈旧键）；**坏 project → 全滤**，所以面板调用点必须
 *      先判「读得到 project」再剪 —— 最后一条用例钉的就是这个破坏性方向。
 *   ⑧ promo 推广行标记（2026-10-07）：3308867900 真形 18 行全中；反例组零误杀
 *      （禁用词 / 内置 token / 值含关键词但 text 不含 / 长乱码键 + 非空文）；
 *      边界在 R1「img 不看名字长短」与 R2「>24 接缝」两处各钉一颗钉子。
 */

import { describe, expect, it } from 'vitest'
import {
  filterKnownOverrides,
  isPromoProp,
  parseUserPropDefs,
  WE_BUILTIN_TEXT,
  type WallpaperPropEntry
} from '../wallpaper-props'

/** 真形 project.json：general.properties + general.localization（语言名大小写不一是常态） */
const PROJECT: unknown = {
  general: {
    localization: {
      'zh-CHS': {
        effect_label: '特效',
        opt_wave: '波浪',
        'ui_browse_properties_scheme_color': '作者配色', // 作者表命中优先于内置词表
        // ⚠️ 诱饵：按**属性名**写的条目 —— 查表键是 text token（差异③），
        // 这两条不许命中（WE 自己也不认这种表）
        custom: '名字键不该命中',
        schemecolor: '名字键也不该命中'
      },
      'zh-cht': { 'My Custom Toggle': '自訂開關' },
      'en-US': { wallpaper_file_text: 'Wallpaper file' }
    },
    properties: {
      schemecolor: { type: 'color', value: '0.1 0.2 0.3', text: 'ui_browse_properties_scheme_color', order: 0 },
      custom: { type: 'bool', value: true, text: 'My Custom Toggle', order: 5 },
      // 字符串 'false'：不是 WE 编辑器的标记（那是严格布尔 false），当没写 → 留下
      editable_ish: { type: 'bool', value: true, editable: 'false', order: 8 },
      speed: { type: 'slider', value: 1, text: 'ui_editor_properties_speed', order: 10 },
      wallpaper_file: {
        type: 'file',
        value: 'textures/sky.tex',
        text: 'wallpaper_file_text',
        fileType: 'texture',
        order: 20
      },
      effect: {
        type: 'combo',
        value: 'wave',
        text: 'effect_label',
        order: 32,
        options: [
          { label: 'opt_wave', value: 'wave', condition: "scene.value !== 'ram'" },
          { label: 'opt_pulse', value: 1 },
          { label: 'ui_editor_properties_mode', value: true }, // ui_ token → 内置表
          { label: { bad: 1 }, value: 'x' }, // label 非字符串 → 滤
          { label: 'opt_nov', value: { obj: 1 } } // 值非三元组 → 滤
        ]
      },
      // order 32.5：浮点细分排序键。若被截断成 32，会与 effect(32) 并列，
      // 而 'crazy' < 'effect' → 顺序翻转（这条就是鉴别用例）
      crazy: {
        type: 'combo',
        value: 'b',
        order: 32.5,
        options: [
          { label: 'obj_first', value: { deep: 1 } }, // 首项 object 值被滤
          { label: 'ok', value: 'yes' }
        ]
      },
      grid_background: {
        type: 'color',
        value: '0.9 0.9 0.9',
        text: 'ui_browse_properties_grid_background',
        order: 40
      },
      notext: { type: 'text', order: 50 },
      htmltext: { type: 'text', text: '<b>Bold</b>&nbsp;Line<br>Two &amp; more', order: 55 },
      secheader: { type: 'text', text: 'Section Header', order: 60 },
      // 先声明 a、后声明 A：同 order 下输出必须是 A 在前（码位序，非声明序）
      a_order_tie: { type: 'bool', value: false, order: 70 },
      A_order_tie: { type: 'bool', value: true, order: 70 },
      // 全档位滑块：min 0 与 precision 0 都是「假值但合法」，不许被真值判断吞掉
      noise: { type: 'slider', value: 50, text: 'Noise', order: 100, min: 0, max: 100, step: 0.5, precision: 0 },
      // 作者标记「用户不可编辑」：整条丢弃（面板与下游都不含它）
      hidden: { type: 'color', value: '1 1 1', editable: false, order: 5 },
      // 无 type 的纯显示项（tip 家族）与 type 非字符串：都不是属性
      some_tip: { text: 'just a tip, no type' },
      bad_type: { type: 42, value: 'x' }
    }
  }
}

const EXPECTED_ORDER = [
  'schemecolor',
  'custom',
  'editable_ish',
  'speed',
  'wallpaper_file',
  'effect',
  'crazy',
  'grid_background',
  'notext',
  'htmltext',
  'secheader',
  'A_order_tie',
  'a_order_tie',
  'noise'
]

function entryOf(entries: WallpaperPropEntry[], name: string): WallpaperPropEntry {
  const e = entries.find((x) => x.name === name)
  if (!e) throw new Error('missing entry: ' + name)
  return e
}

/** 迷你 project：只关心一两个属性时的最小真形 */
function proj(properties: Record<string, unknown>): unknown {
  return { general: { properties } }
}

describe('parseUserPropDefs：排序与丢弃', () => {
  const entries = parseUserPropDefs(PROJECT, {})

  it('order 浮点升序、并列按码位；editable:false 的 hidden 整条缺席', () => {
    expect(entries.map((e) => e.name)).toEqual(EXPECTED_ORDER)
  })

  it('缺 order / 非数字 order 一律 0（并列再按码位）', () => {
    const es = parseUserPropDefs(proj({ b: { type: 'bool', order: 'abc' }, a: { type: 'bool' } }), {})
    expect(es.map((e) => e.name)).toEqual(['a', 'b'])
  })

  it('未知 type 落 other（面板按文本输入兜底）；无 type / type 非字符串的条目跳过', () => {
    const es = parseUserPropDefs(proj({ weird: { type: 'starlight', value: 'x' } }), {})
    expect(es.map((e) => [e.name, e.ptype])).toEqual([['weird', 'other']])
  })
})

describe('parseUserPropDefs：值与文案', () => {
  const entries = parseUserPropDefs(PROJECT, {})

  it('color 默认值原样带出；作者表的 token 条目命中（优先于内置词表）', () => {
    const e = entryOf(entries, 'schemecolor')
    expect(e.ptype).toBe('color')
    expect(e.value).toBe('0.1 0.2 0.3')
    expect(e.overridden).toBe(false)
    expect(e.text).toBe('作者配色') // zh-chs 表按 text token 命中；内置表会给「主题配色」，作者表先赢
  })

  it('token 在作者表里查不到 → 落官方内置词表（不再显示键名）', () => {
    expect(entryOf(entries, 'grid_background').text).toBe('网格（背景）')
    expect(entryOf(entries, 'speed').text).toBe('速度')
  })

  it('查表键是 text token、不是属性名：按属性名写的诱饵条目不命中（差异③）', () => {
    // zh-chs 表里故意放了 custom / schemecolor 两条**按属性名**写的诱饵。
    // 它们若命中，说明查表键退回了属性名 —— 那是 DSH 属性路径的形态，
    // 与 WE 官方文档不符（「properties 里的键不参与查表」）
    expect(entryOf(entries, 'custom').text).toBe('自訂開關')
    expect(entryOf(entries, 'schemecolor').text).toBe('作者配色')
  })

  it('文案逐键回退：zh-cht 表里的键（zh-chs 表在场但没它）', () => {
    expect(entryOf(entries, 'custom').text).toBe('自訂開關')
  })

  it('文案逐键回退：en-US 表里的键（第三档）', () => {
    expect(entryOf(entries, 'wallpaper_file').text).toBe('Wallpaper file')
  })

  it('选项 label 走同一条 token 查表路（zh-chs 命中 / 没有就原文 / ui_ token 落内置表）；file 的 fileType 带出', () => {
    expect(entryOf(entries, 'effect').text).toBe('特效')
    const f = entryOf(entries, 'wallpaper_file')
    expect(f.ptype).toBe('file')
    expect(f.fileType).toBe('texture')
    expect(f.value).toBe('textures/sky.tex')
  })

  it('text 类型是静态说明：没 value 的 value/default 都是 null，文案回退属性名', () => {
    const n = entryOf(entries, 'notext')
    expect(n.ptype).toBe('text')
    expect(n.value).toBeNull()
    expect(n.default).toBeNull()
    expect(n.text).toBe('notext')
  })

  it('文案去 HTML：<br> 变换行、实体解码', () => {
    expect(entryOf(entries, 'htmltext').text).toBe('Bold Line\nTwo & more')
  })

  it('滑块档位参数：min 0 与 precision 0 都是「假值但合法」，必须留住', () => {
    const n = entryOf(entries, 'noise')
    expect(n.min).toBe(0)
    expect(n.max).toBe(100)
    expect(n.step).toBe(0.5)
    expect(n.precision).toBe(0)
  })

  it('档位参数的接受口径：数字字符串收、非数字不收', () => {
    const es = parseUserPropDefs(proj({ s: { type: 'slider', min: '0.1', max: 'xyz' } }), {})
    expect(es[0].min).toBe(0.1)
    expect(es[0].max).toBeUndefined()
  })
})

describe('parseUserPropDefs：combo 选项', () => {
  const entries = parseUserPropDefs(PROJECT, {})

  it('选项值保留声明类型（字符串 / 数字 / 布尔混用），无效选项被滤', () => {
    const opts = entryOf(entries, 'effect').options
    expect(opts?.map((o) => o.value)).toEqual(['wave', 1, true])
    expect(opts?.map((o) => typeof o.value)).toEqual(['string', 'number', 'boolean'])
  })

  it('选项的 condition 原样保留（选项级显隐由面板求值，不在解析时筛）', () => {
    const opts = entryOf(entries, 'effect').options
    expect(opts?.[0].condition).toBe("scene.value !== 'ram'")
    expect(opts?.[1].condition).toBeUndefined()
  })

  it('选项 label 走同一条文案管线（token 查表 → 原文 → 内置表）', () => {
    const opts = entryOf(entries, 'effect').options
    expect(opts?.[0].label).toBe('波浪')
    expect(opts?.[1].label).toBe('opt_pulse') // 没翻译就显示原文
    expect(opts?.[2].label).toBe('模式') // label 是 ui_ token → 官方内置表
  })

  it('选项全部无效时连 options 键都不挂（不是空数组）', () => {
    const es = parseUserPropDefs(
      proj({ pick: { type: 'combo', options: [{ label: 'x' }, { value: { o: 1 } }] } }),
      {}
    )
    expect('options' in es[0]).toBe(false)
  })
})

describe('parseUserPropDefs：覆盖值合并', () => {
  it('有效覆盖替换默认值（类型照覆盖值自己走）；被丢的条目不会因覆盖复活', () => {
    const entries = parseUserPropDefs(PROJECT, {
      custom: false,
      effect: 1,
      schemecolor: '1 1 1',
      hidden: '1 1 1',
      ghost: true
    })
    const c = entryOf(entries, 'custom')
    expect(c.value).toBe(false)
    expect(c.overridden).toBe(true)
    expect(c.default).toBe(true) // default 永远是声明值，不被覆盖污染
    expect(entryOf(entries, 'effect').value).toBe(1) // number 覆盖保 number
    expect(entryOf(entries, 'schemecolor').value).toBe('1 1 1')
    expect(entries.some((e) => e.name === 'hidden')).toBe(false)
    expect(entries.some((e) => e.name === 'ghost')).toBe(false)
  })

  it('无效覆盖（对象 / null）视为没覆盖 → 回落默认值，而不是 null', () => {
    const entries = parseUserPropDefs(PROJECT, { custom: { bad: 1 }, speed: null })
    const c = entryOf(entries, 'custom')
    expect(c.overridden).toBe(false)
    expect(c.value).toBe(true)
    expect(entryOf(entries, 'speed').overridden).toBe(false)
  })

  it('overrides 不是对象（手改文件的怪值）→ 当空表', () => {
    const entries = parseUserPropDefs(PROJECT, [1, 2])
    expect(entries.length).toBe(EXPECTED_ORDER.length)
    expect(entryOf(entries, 'custom').overridden).toBe(false)
  })
})

describe('parseUserPropDefs：坏 project 不炸', () => {
  it.each([null, undefined, 42, 'str', [], {}, { general: 1 }, { general: { properties: [] } }])(
    '%o → []',
    (bad) => {
      expect(parseUserPropDefs(bad, {})).toEqual([])
    }
  )

  it('properties 里混非对象值：只数真条目', () => {
    const es = parseUserPropDefs(proj({ ok: { type: 'bool', value: true }, bad: 'notObj' }), {})
    expect(es.map((e) => e.name)).toEqual(['ok'])
  })
})

describe('filterKnownOverrides：面板写路径的净剪（先判 project 读得到，再剪）', () => {
  it('只留 project 声明过的名字，值重新过三元组净化', () => {
    expect(filterKnownOverrides(PROJECT, { custom: false, ghost: 'x', schemecolor: '1 1 1' })).toEqual({
      custom: false,
      schemecolor: '1 1 1'
    })
  })

  it('非三元组值被滤；overrides 不是对象 → 空表', () => {
    expect(filterKnownOverrides(PROJECT, { custom: { bad: 1 }, schemecolor: null })).toEqual({})
    expect(filterKnownOverrides(PROJECT, null)).toEqual({})
    expect(filterKnownOverrides(PROJECT, 'garbage')).toEqual({})
  })

  it('editable:false 的属性也算「声明过」（保守：净不剪值）', () => {
    expect(filterKnownOverrides(PROJECT, { hidden: '1 1 1' })).toEqual({ hidden: '1 1 1' })
  })

  it('⚠️ 坏 project → 全滤：调用方读不到 project 时必须走「不剪」分支', () => {
    // WallpaperPropsPanel.writeItemProps 的 `project ? 剪 : 原样` 就是为这个方向设的 ——
    // 拿 null 当「一个属性都没声明过」会把用户攒的微调一把清空
    expect(filterKnownOverrides(null, { custom: false })).toEqual({})
  })
})

describe('WE_BUILTIN_TEXT：官方词表的规模快照', () => {
  it('23 键、全 ui_ 前缀、全非空 —— 新键要先查官方 locale 表再抄进来，改这个数是主动过目', () => {
    const keys = Object.keys(WE_BUILTIN_TEXT)
    expect(keys.length).toBe(23)
    for (const k of keys) {
      expect(k.startsWith('ui_'), k).toBe(true)
      expect(WE_BUILTIN_TEXT[k].trim().length, k).toBeGreaterThan(0)
    }
  })
})

/* ------------------------------------------------------------------------- *
 * ⑧ promo：第三方推广行标记（2026-10-07）
 *
 * 【语料出处】<Steam 库>/steamapps/workshop/content/431960/3308867900/project.json
 * （泡水灵梦重制版）。本机 31 个 project.json（工坊 10 + WE 自带项目 21）全量
 * 扫描的唯一命中：113 行里 18 行，其余 30 个文件零命中（反例语料即来自它们）。
 * 夹具**必须内联**（测试机不保证有 Steam 库）；PROMO_PROPS 与反例组的语料行
 * key / type / value / text 逐字照抄（超长 URL 不截断 —— 判据就靠它们）；
 * 反例组另有六条合成探针（不取自语料），就地标注。
 *
 * 期望口径：只打标记、绝不丢行（推送链路照旧拿全量，渲染零变化）；三条规则见
 * shared/wallpaper-props.ts 的 isPromoProp；窄表不许加宽 —— 反例组把禁用词
 * （link / 点击跳转 / 链接 / url / about / qq / 群）逐个钉住。
 * ------------------------------------------------------------------------- */

/** photogz 图组（9 行）共用的自动键：真形只差结尾 WE 编号（编号与图高不一一对应） */
const photogzName = (suffix: number): string =>
  `imgsrchttpphotogzphotostoreqqcompscv12uhwit3z28ypbqqfvz5yrrgysxmvkrcqsfratqlfzr86n9euodn4nrlgp3ax9rtwtsnrhi7j6ys7cpxuv4uy0yhigma9023bydad5n5tpcicj6v5qbbohgeiaaaaaaacjxqrfviewer_4width2000height${suffix}`

/** photogz 图组共用的 img 文案（真形；height 逐行照抄） */
const photogzImg = (height: number): string =>
  `<img src="http://photogz.photo.store.qq.com/psc?/V12uhwIt3z28yp/bqQfVz5yrrGYSXMvKr.cqSF.*RaTqLFzr86N9EuoDN4nRLGP3a.X9rtw.tsnRh*i7J6Ys7CPxuV4UY0yhigma9023ByDaD5n5tpcicJ6V5Q!/b&bo=HgEIAAAAAAACJxQ!&rf=viewer_4" width="2000" height="${height}">`

/** 3308867900 的 18 行推广属性真形 */
const PROMO_PROPS: Record<string, Record<string, unknown>> = {
  // —— R1：带链接的说明行（个人主页 / 三连 / 署名）——
  b: {
    type: 'text',
    value: '',
    text: `<center><big><b>🔻我的个人主页🔻<br/><a href='https://space.bilibili.com/279406515?spm_id_from=333.1007.0.0'>夜莺Night的个人空间 (点击跳转)</a><big></p>`
  },
  night: {
    type: 'text',
    value: '',
    text: `<big><b><a href='https://space.bilibili.com/279406515?spm_id_from=333.1007.0.0'><center>动态制作：-夜莺Night<br/>`
  },
  'brahrefhttpswwwbilibilicomvideobv11t42157njspm_id_from33399900vd_source6f828cdc8aaedab90f6dc4faa46274eebv11t42157njabigp': {
    type: 'text',
    value: '',
    text: `<big>喜欢的话，可不可以求个三连呢？<br/><a href='https://www.bilibili.com/video/BV1QU411U7kK/?vd_source=6f828cdc8aaedab90f6dc4faa46274ee'>BV1QU411U7kK(点击跳转)</a><big></p>`
  },
  // —— R1/R3：二维码图（微信 / 爱发电 —— 后者还挂着 pixiv 外链）——
  'brahrefhttpssteamcommunitycomlinkfilterurlhttpswwwpixivnetusers3302692imgsrchttpmqpiccnpscv54uqdlk3nauxa4j47wn15wvmc4bjxtjruamsa53pvqwn7flk88i5tfbuq2vz4itg5qyz3iot5pa7cvulmenvk8nksauv5kscpsabc8oxjmy8wx00btxy00qni12rqrlstoxtkaymnullbobgqubaaaaaabbzirfphotolistt5width200height200': {
    type: 'bool',
    value: true,
    text: `<hr/><big><b>微信<br/><img src="http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEBsexJSlhMg7OiSbTz*Vq3QACEYkZ8E7D9iP.Od05WVwf*Zty7Ju024B0os.zP7PIbqo.3*UAdtYXXx9jjaGF1A!/b&bo=4gHXAQAAAAABBxU!&rf=viewer_4" width="200" height="200">`
  },
  'hrbigbbrahrefhttpssteamcommunitycomlinkfilterurlhttpswwwpixivnetusers3302692imgsrchttpmqpiccnpscv54uqdlk3nauxa4j47wn15wvmc4bjxtjtmeugtj9ek67v8ajmqregy1ndibimqdzu0koqhrftfh0chbachbnfvu28g8d8zcj0wn7v6om7uo0w4w3cd8n1nxuz3pxl0qdsf28wpqmnullbovak8agaaaaabbyarfphotolistt5width200height200': {
    type: 'color',
    value: '1 0 0',
    text: `<hr/><big><b>爱发电<br/><a href='https://steamcommunity.com/linkfilter/?url=https://www.pixiv.net/users/3302692'><img src="http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEGY1nD.iBiMQDzU0KoQHRFtfh0CHbAchbnfvU28G8D8ZcJ0wN.7v6oM7Uo0W4W3Cd8N1nX*Uz3PXl0QDSf28wPQ!/mnull&bo=vAK8AgAAAAABByA!&rf=photolist&t=5" width="200" height="200">`
  },
  // —— R1：署名/装饰图（bilibili 头像位图 / 分割线位图）——
  'imgsrcfilecusersasusdesktop1708838296804pngaltnightwidth200height200': {
    type: 'text',
    value: '',
    text: `<center><br/><a href='https://space.bilibili.com/279406515?spm_id_from=333.1007.0.0'><img src="http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/ruAMsa53pVQWN7FLK88i5s4Ru.FxJVLHfuEcbN9phT8I00ri*qc9y2RTZyA1aopw88nnmF1sZx37Es.pr9gP*jZUKpvD8qVn72w8522q8Q4!/mnull&bo=QAYWAwAAAAADB3E!&rf=photolist&t=5" width="200" height="100"></a><big></p>`
  },
  'imgsrcfilecusersasusdesktope782abe5bda94gifwidth100height100': {
    type: 'bool',
    value: true,
    text: `<img src="http://photogz.photo.store.qq.com/psc?/V12uhwIt3z28yp/bqQfVz5yrrGYSXMvKr.cqSF.*RaTqLFzr86N9EuoDN4nRLGP3a.X9rtw.tsnRh*i7J6Ys7CPxuV4UY0yhigma9023ByDaD5n5tpcicJ6V5Q!/b&bo=HgEIAAAAAAACJxQ!&rf=viewer_4" width="2000" height="5">`
  },
  // —— R1/R2：9 行纯图（键是 WE 自动生成的长乱码；text 去标签后为空）——
  [photogzName(1)]: { type: 'color', value: '1 0 0', text: photogzImg(1) },
  [photogzName(2)]: { type: 'color', value: '1 0 0', text: photogzImg(2) },
  [photogzName(5)]: { type: 'text', value: '', text: photogzImg(5) },
  [photogzName(51)]: { type: 'bool', value: true, text: photogzImg(2) },
  [photogzName(52)]: { type: 'color', value: '1 0 0', text: photogzImg(5) },
  [photogzName(53)]: { type: 'color', value: '1 0 0', text: photogzImg(5) },
  [photogzName(54)]: { type: 'color', value: '1 0 0', text: photogzImg(5) },
  [photogzName(55)]: { type: 'color', value: '1 0 0', text: photogzImg(5) },
  [photogzName(56)]: { type: 'color', value: '1 0 0', text: photogzImg(5) },
  // —— R3：纯文本关键词（赞助分节标题 / 支持语）——
  newproperty21: {
    type: 'text',
    value: '',
    text: '<center><h3>-🔻关于赞助🔻-<h3>'
  },
  hrb: {
    type: 'bool',
    value: true,
    text: '<hr><b>喜欢的话，可以小小支持一下吗？你们的支持就是我更新最大的动力'
  }
}

describe('promo：第三方推广行标记（3308867900 真形语料）', () => {
  const entries = parseUserPropDefs(proj(PROMO_PROPS), {})

  it('18 行全中、一个不漏（URL / a 标签 / img 图 / 关键词 / 纯图 各类形态）', () => {
    expect(entries.map((e) => e.name).sort()).toEqual(Object.keys(PROMO_PROPS).sort())
    for (const e of entries) expect(e.promo, e.name).toBe(true)
  })

  it('只打标记、绝不丢行：推送负载（pushSceneProps 同款构造）与声明值逐字段一致', () => {
    // WallpaperLayer.pushSceneProps 的负载 = 全量行里 value !== null 的 {name: value}。
    // promo 行照旧进负载（渲染零变化），promo 标记本身不会出现在负载里。
    const push: Record<string, unknown> = {}
    for (const e of entries) if (e.value !== null) push[e.name] = e.value
    const declared: Record<string, unknown> = {}
    for (const [n, d] of Object.entries(PROMO_PROPS)) declared[n] = d.value
    expect(push).toEqual(declared)
  })

  it('覆盖值照常合并到 promo 行（打标记≠冻结）：用户存量微调继续下发', () => {
    const es = parseUserPropDefs(proj(PROMO_PROPS), { hrb: false, [photogzName(56)]: '0 1 0' })
    const h = entryOf(es, 'hrb')
    expect(h.promo).toBe(true)
    expect(h.overridden).toBe(true)
    expect(h.value).toBe(false)
    const g = entryOf(es, photogzName(56))
    expect(g.promo).toBe(true)
    expect(g.value).toBe('0 1 0')
  })

  it('结构 / 关键词匹配大小写不敏感（真实数据里字母大小写混用是常态）', () => {
    const es = parseUserPropDefs(
      proj({
        shout: { type: 'text', text: 'Sponsor Me' },
        caps: { type: 'text', text: "<A HREF='HTTPS://EXAMPLE.COM'>x</A>" }
      }),
      {}
    )
    expect(entryOf(es, 'shout').promo).toBe(true)
    expect(entryOf(es, 'caps').promo).toBe(true)
  })

  it('匹配对象含 key 本身（关键词藏在净化后的自动键里也算证据）', () => {
    // text 非空（R2 不参与）：命中只能来自 key —— 真形键 'brahrefhttpswwwbilibilicom…'
    // 是 URL 被 WE 净化后的产物（'://' 与 '.' 都被剥掉了），活下来的证据是关键词
    // bilibili（R3）；这也正是 haystack 拼上 key 的用处所在
    expect(isPromoProp({ text: '说明' }, 'brahrefhttpswwwbilibilicomvideoBV1QU411U7kK')).toBe(true)
    // 反照钉边界：'http' 单独藏在键里**不算**证据（R1 只认完整的 'https?://'），'qq'
    // 也按定稿被剔出窄表（photogz 图组的自动键里全是 qqcom，它们靠自己的 <img> 文案
    // 命中 R1）—— 同型键配普通文案就该是 false；哪天窄表被加宽，这条会红
    expect(isPromoProp({ text: '说明' }, 'imgsrchttpphotogzphotostoreqqcom')).toBe(false)
  })
})

/** 反例组：一个都不许误杀 —— 每误杀一个，面板就少一行合法控件 */
const NOT_PROMO_PROPS: Record<string, Record<string, unknown>> = {
  // 普通控件（bool / color / slider / textinput，含中英文混排）
  time: { type: 'bool', value: true, text: '<big><b>🔘时间组件显示Time component display' },
  newproperty16: {
    type: 'color',
    value: '0.6823529411764706 0.0784313725490196 0.5372549019607843',
    text: '鼠标尾迹颜色Mouse Trail Color'
  },
  newproperty17: {
    type: 'slider',
    value: 5,
    min: 1,
    max: 10,
    step: 0.001,
    precision: 4,
    text: '鼠标尾迹大小'
  },
  _2: { type: 'textinput', value: '（可自定义文字）', text: '<b>自定义文字2' },
  hrbigb: { type: 'bool', value: true, text: '<hr/><big><b>🔘水波纹 water ripple' },
  // 禁用词重灾区：'Blink' 含 link；点击跳转 / 链接 / url / about / qq / 群 都不许进表
  bigbbrcharacterblinkanimation: {
    type: 'bool',
    value: true,
    text: '<big><b>🔘人物眨眼动画<br/>Character Blink Animation'
  },
  // 以下六条是**合成探针**（不取自语料）：逐个钉住禁用词名单 —— 点击跳转 / 链接 /
  // url / about / qq / 群，每个词配一条典型合法文案；哪条变红就是窄表被加宽了
  jumps: { type: 'text', text: '看右侧按钮点击跳转设置页' },
  links_hint: { type: 'text', text: '外部链接' },
  url_hint: { type: 'text', text: 'URL 地址' },
  about_hint: { type: 'text', text: 'About This' },
  qq_hint: { type: 'text', text: 'QQ 音乐' },
  group_hint: { type: 'text', text: '音频群组 Audio group' },
  // 值里含 bilibili ≠ text/key 含 —— 匹配只看 text 与 key（这条就是鉴别器）
  newproperty55: { type: 'textinput', value: 'Bilibili 抖音 ： 夜莺Night', text: '<b>自定义文字' },
  // WE 内置 token（ui_*）：官方文案键，一律豁免
  schemecolor: {
    type: 'color',
    value: '0.8235294117647058 0.5019607843137255 0.7294117647058823',
    text: 'ui_browse_properties_scheme_color'
  },
  // 长乱码 key + 非空 text：R2 只针对「去标签后为空」的行，长键本身不是判据
  'bbasicindexbfromtoptobottombrbfiltersettingsbtimefilterbrbcamerasettingsbparallaxoffsetbloombrbbackgroundsettingsbelementsinthebackgroundsuchascloudscurtaindynamicparticlesbrbcharactersettingsbeffectsforcharacterbrbcomponentsettingsbclockaudiovisualizationmediacomponentbrbbbrbbbrbbbrbbbrbbhrh4bfiltersettingsbrbh4': {
    type: 'text',
    value: '',
    text: '<font color=#ebb6c1><br><b>功能简要展示</b>:<br/><b>人物动画设置:</b> 人物飘动动画开关、人物呼吸动画开关、人物眨眼动画速度调节<br/><b>特效设置:</b> 雨水、飘雪、飞花、水波纹、水涟漪、光束、雾气、萤火<br/><b>组件设置:</b> 时间组件、音频可视化、鼠标尾迹，多种字体选择等等<<br><br></b><b>如果带不动壁纸，占用过高，可以将人物动效由精细更改至简略或关闭动效，适当关闭一些效果，同时进入wallpaper设置纹理分辨率为高性能，降低帧率。<b>'
  }
}

describe('promo：反例（不许误杀）', () => {
  const entries = parseUserPropDefs(proj(NOT_PROMO_PROPS), {})

  it('普通控件 / Blink Animation / 禁用词文本 / 内置 token / 长键非空文 / 值含 Bilibili —— 全是 false', () => {
    expect(entries.map((e) => e.name).sort()).toEqual(Object.keys(NOT_PROMO_PROPS).sort())
    for (const e of entries) expect(e.promo, e.name).toBe(false)
  })

  it('promo 是恒在场的布尔（false 不是 undefined）—— 行对象形状对既有字段零破坏', () => {
    for (const e of entries) expect(typeof e.promo).toBe('boolean')
  })
})

describe('promo：边界（空 text / 纯空格 / 短名纯图 / R2 接缝）', () => {
  it('空 text 且短名 → 不是 promo（没写文案 ≠ 广告）', () => {
    const es = parseUserPropDefs(proj({ ok: { type: 'bool', value: true } }), {})
    expect(entryOf(es, 'ok').promo).toBe(false)
  })

  it('纯空格 / 只有 <br/> 的短名行 → 不是 promo', () => {
    const es = parseUserPropDefs(
      proj({ sp: { type: 'text', text: '   ' }, br: { type: 'text', text: '<br/>' } }),
      {}
    )
    expect(entryOf(es, 'sp').promo).toBe(false)
    expect(entryOf(es, 'br').promo).toBe(false)
  })

  it('短名纯图行（含 <img，本地 file:// 无 http）→ R1 命中：img 标签不看名字长短', () => {
    const es = parseUserPropDefs(
      proj({ logo: { type: 'bool', value: true, text: '<img src="file:///C:/pic.png">' } }),
      {}
    )
    expect(entryOf(es, 'logo').promo).toBe(true)
  })

  it('R2 接缝：无字行名长 24 不中、25 中（>24 才是 WE 垃圾键的形态）', () => {
    const n24 = 'x'.repeat(24)
    const n25 = 'x'.repeat(25)
    const es = parseUserPropDefs(
      proj({ [n24]: { type: 'text', text: '<hr/>' }, [n25]: { type: 'text', text: '<hr/>' } }),
      {}
    )
    expect(entryOf(es, n24).promo).toBe(false)
    expect(entryOf(es, n25).promo).toBe(true)
  })

  it('空 text + 长名 → R2 命中（WE 自动生成的无字行：占位/代理图）', () => {
    const name = 'a'.repeat(30)
    const es = parseUserPropDefs(proj({ [name]: { type: 'bool', value: true } }), {})
    expect(entryOf(es, name).promo).toBe(true)
  })

  it('WE 内置 token 豁免：豁免**先于规则**（直接调导出函数，key 撞词也放行）', () => {
    expect(isPromoProp({ text: 'ui_browse_properties_scheme_color' }, 'schemecolor')).toBe(false)
    expect(isPromoProp({ text: 'ui_editor_properties_speed' }, 'speed')).toBe(false)
    // 前置豁免的鉴别式：key 里带 bilibili，若豁免晚于 R3 或没生效，这里会红
    expect(isPromoProp({ text: 'ui_editor_properties_speed' }, 'bilibili_speed')).toBe(false)
  })
})
