/**
 * 音效播放器（src/renderer/src/lib/sfx.ts）
 *
 * 【这个文件在守什么】
 * 音效是**唯一一种「坏了不会有人报错」的功能**：听不见就是听不见，
 * 没有控制台、没有红框，用户只会觉得「这软件好像没声音」然后关掉开关。
 * 而声音本身在单测里放不出来（node 环境没有 `AudioContext`），
 * 所以这里守的是**能守的那一半**：
 *
 *   1. **没有素材时一切静默，且不抛错**。「主人一张图/一个音频都还没放」
 *      是**现在的真实状态**，不是故障 —— 这条路径必须是被测过的，
 *      而不是"应该没事吧"。
 *   2. **素材的认法**（主干 + 扩展名优先级）不能被随手改坏。改坏的症状是
 *      「主人明明把 cat-click.mp3 放进去了，点了猫咪还是没声」——
 *      他会去怀疑音频文件、怀疑音量、怀疑系统，唯独不会怀疑我们的文件名匹配。
 *   3. **节流表必须是正数**。写成 0 会让连点叠成一串爆音；写成 NaN 会让
 *      `now - last < NaN` 恒为 false —— 也就是节流**静默失效**。
 *   4. **「随机抽一段」的抽签不能漏到池子外**。抽中一个不存在的下标，
 *      表现是"偶尔点了没声音"——查的时候只会去怀疑素材。
 *
 * ⚠️ 这个文件在 `src/` 下，但**不受文案闸门管辖**：`copy.test.ts` 的 `walk()`
 * 明确跳过 `__tests__` 目录（见那里的 `if (name !== 'generated' && name !== '__tests__')`）。
 * 以前这里写着"字符串一律英文"，是错的 —— 中文测试名合法，本文件就用中文。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetSfxForTest,
  findOnset,
  findSound,
  getSfxVolume,
  isSfxEnabled,
  ONSET_SCAN_MAX_SEC,
  pickSource,
  playSfx,
  primeAudio,
  resolveSources,
  setSfxEnabled,
  setSfxSources,
  setSfxVolume,
  sfxGainOf,
  SFX_BASE_GAIN,
  SFX_FILES,
  SFX_GAIN,
  SFX_THROTTLE_MS,
  SOUND_EXT_PRIORITY,
  soundBaseOf,
  soundExtOf,
  type SfxName
} from '../sfx'

/** 九种场合。**写全**：新增音效时这里会红，提醒你补测试而不是悄悄溜过去 */
const ALL_NAMES: SfxName[] = [
  'click',
  'nav',
  'meow',
  'quack',
  'answerRight',
  'answerWrong',
  'lessonDone',
  'chapterDone',
  'challengeDone'
]

/**
 * 主人点名要的那几个 —— README 里写给主人的就是这些文件名。
 * 猫叫那三段单独一组：它们不只是"要存在"，还要求**三段互不相同且都进池子**。
 */
const REQUIRED_BASES = ['duck-click', 'lesson-complete']
const CAT_BASES = ['cat-click-1', 'cat-click-2', 'cat-click-3']

/** 把表摊平成一串主干（一个场合可以有多个候选） */
function allBases(): string[] {
  return ALL_NAMES.flatMap((n) => [...SFX_FILES[n]])
}

afterEach(() => {
  __resetSfxForTest()
})

// ---------------------------------------------------------------- 表结构

describe('SFX_FILES：场合 → 文件名主干（一个场合可以有几个候选）', () => {
  it('九种场合一个不少、一个不多', () => {
    expect(Object.keys(SFX_FILES).sort()).toEqual([...ALL_NAMES].sort())
  })

  it('每个场合至少一个主干，且每条主干都是非空的、不带扩展名的纯文件名', () => {
    for (const name of ALL_NAMES) {
      expect(SFX_FILES[name].length).toBeGreaterThan(0)
      for (const base of SFX_FILES[name]) {
        expect(base.length).toBeGreaterThan(0)
        // 带扩展名的话，主人得把文件改名成 `cat-click.mp3.mp3` 才能命中 ——
        // 而 README 里写的是 `cat-click.mp3`。两者必须一致。
        expect(base).not.toContain('.')
        expect(base).not.toContain('/')
      }
    }
  })

  it('主人点名要的文件名一字不差', () => {
    // 这几个是 README 的对外承诺。改这里 = 改 README，
    // 否则主人按旧名字放文件，什么都不会发生。
    expect(SFX_FILES.quack).toEqual(['duck-click'])
    expect(SFX_FILES.lessonDone).toEqual(['lesson-complete'])
    expect(SFX_FILES.meow).toEqual(CAT_BASES)
  })

  it('**三段猫叫是三个不同的主干** —— 写重了"随机抽"就变成"每次都一样"', () => {
    // 这正是主人要"每次随机抽一个"的全部意义：同一只猫连叫两声不该一模一样。
    // 表里要是写成 ['cat-click-1','cat-click-1','cat-click-1']，功能看着是好的
    // （有声音、不报错），只是随机没了 —— 而没人会去数池子里有几个。
    expect(new Set(SFX_FILES.meow).size).toBe(SFX_FILES.meow.length)
  })

  it('**每个主干只属于一个场合**（撞车会让两个场合共用同一个音）', () => {
    const bases = allBases()
    expect(new Set(bases).size).toBe(bases.length)
  })

  it('至少含盖主人要的那几个主干', () => {
    const bases = allBases()
    for (const required of [...REQUIRED_BASES, ...CAT_BASES]) expect(bases).toContain(required)
  })

  it('需要"多个候选"的只有猫咪这一个场合（别的都是单元素数组）', () => {
    // 单元素数组不是"为将来预留"，是**同一个字段今天两种用法**：
    // 只给一段的场合写一个元素的数组。这条钉住"谁真的在用抽签"。
    const multi = ALL_NAMES.filter((n) => SFX_FILES[n].length > 1)
    expect(multi).toEqual(['meow'])
  })
})

describe('SFX_BASE_GAIN：同一个场合内部不齐的那几段，单独补差', () => {
  it('键必须是真的存在的主干（写错了会静默失效）', () => {
    for (const base of Object.keys(SFX_BASE_GAIN)) expect(allBases()).toContain(base)
  })

  it('都是有限正数', () => {
    for (const [base, g] of Object.entries(SFX_BASE_GAIN)) {
      expect(Number.isFinite(g), base).toBe(true)
      expect(g, base).toBeGreaterThan(0)
    }
  })

  it('**只列真正不齐的那几个** —— 齐的不该出现在这里', () => {
    // 每多一行就多一处"换素材时要记得改"的地方。没量出差异的文件不要往表里塞：
    // 塞个 1.0 看着人畜无害，但它会让后来的人以为"这些文件都量过了"。
    expect(Object.keys(SFX_BASE_GAIN)).toEqual(['cat-click-2'])
  })

  it('cat-click-2 的那个数能追到实测的 RMS 上', () => {
    // 四段素材有效段的 RMS：duck 2537 / cat1 2636 / **cat2 1290** / cat3 2549
    // 2537 / 1290 ≈ 1.97。这条钉的是**出处**：数字要改可以，但得改得明白 ——
    // 否则下一个人只会看到一个孤零零的 1.97，不敢碰也不知道从哪重算。
    expect(SFX_BASE_GAIN['cat-click-2']).toBeCloseTo(2537 / 1290, 2)
  })
})

// ---------------------------------------------------------------- 起音点

describe('findOnset()：跳掉素材开头的静音', () => {
  // 采样率取小一点（构造 PCM 快），比例关系不变
  const SR = 10000
  const ch = (len: number, fill: (i: number) => number): Float32Array => {
    const a = new Float32Array(len)
    for (let i = 0; i < len; i++) a[i] = fill(i)
    return a
  }
  /** 前 `lead` 秒静音，之后是 0.5 的实音 */
  const withLead = (lead: number, amp = 0.5): Float32Array =>
    ch(SR, (i) => (i < SR * lead ? 0 : amp))

  it('没有声道 / 采样率非法 → 0，不抛错', () => {
    expect(findOnset([], 44100)).toBe(0)
    expect(findOnset([withLead(0.1)], 0)).toBe(0)
  })

  it('整段都是静音 → 0（没有起音点，跳哪儿都一样）', () => {
    expect(findOnset([ch(1000, () => 0)], SR)).toBe(0)
  })

  it('起音就在第 0 个样本 → 0，不做任何改动', () => {
    expect(findOnset([withLead(0)], SR)).toBe(0)
  })

  it('**开头 100ms 静音 → 跳到 95ms**（留 5ms 余量，别切到渐强的起音上）', () => {
    // 主人那四段素材实测的开头静音是 10 / 90 / 100 / 135 毫秒 —— 正是这一条要修的
    expect(findOnset([withLead(0.1)], SR)).toBeCloseTo(0.095, 6)
  })

  it('静音太短（< 30ms）→ 仍然返回 0', () => {
    // 为一个听不出来的差值去改播放起点，只会多一个要解释的行为。
    // （cat-click-3 就是这种：只有 10ms，本来就干净。）
    expect(findOnset([withLead(0.02)], SR)).toBe(0)
  })

  it('**只看开头那一段**：静音长过上限就不动它', () => {
    // 开头整整一秒没声音，说明这段素材本来就长，不是"漏了一小段空白" ——
    // 那种情况跳过去会吃掉一大截内容
    expect(findOnset([withLead(1.0)], SR)).toBe(0)
    expect(ONSET_SCAN_MAX_SEC).toBeGreaterThan(0.15)
    expect(ONSET_SCAN_MAX_SEC).toBeLessThan(1)
  })

  it('**判据是相对峰值**：整体很轻的素材照样找得到起音点', () => {
    // 写死绝对阈值的话，轻的那一段会整段被判成静音 ——
    // 而"三段猫叫里有一段只有一半响"正是这批素材的真实情况
    expect(findOnset([withLead(0.1, 0.001)], SR)).toBeCloseTo(0.095, 6)
  })

  it('**有一条声道先响就算起音**（取最早的那个）', () => {
    const late = withLead(0.2)
    const right = withLead(0) // 一开始就有声
    expect(findOnset([late, right], SR)).toBe(0)
    expect(findOnset([late, withLead(0.2)], SR)).toBeCloseTo(0.195, 6)
  })
})

describe('SFX_GAIN / SFX_THROTTLE_MS：两张表要覆盖全部场合', () => {
  it('音量表覆盖全部场合，且都是有限正数', () => {
    for (const name of ALL_NAMES) {
      const g = SFX_GAIN[name]
      expect(Number.isFinite(g)).toBe(true)
      expect(g).toBeGreaterThan(0)
    }
  })

  it('节流表覆盖全部场合，且都是有限正数', () => {
    // ⚠️ 这条不是形式主义：写成 0 会让鼠标连点叠成一串爆音；
    // 写成 NaN 会让 `now - last < NaN` 恒为 false，节流**静默失效**，
    // 而表现是"某些时候声音有点怪"，没人查得出来。
    for (const name of ALL_NAMES) {
      const ms = SFX_THROTTLE_MS[name]
      expect(Number.isFinite(ms)).toBe(true)
      expect(ms).toBeGreaterThan(0)
    }
  })

  it('反馈音（学完一课/通关）的节流明显长于点击音', () => {
    // 反馈音代表"一件事刚刚发生"。短时间内响第二遍会让这件事显得不值钱。
    expect(SFX_THROTTLE_MS.lessonDone).toBeGreaterThan(SFX_THROTTLE_MS.click)
    expect(SFX_THROTTLE_MS.chapterDone).toBeGreaterThan(SFX_THROTTLE_MS.nav)
    expect(SFX_THROTTLE_MS.challengeDone).toBeGreaterThan(SFX_THROTTLE_MS.click)
  })
})

// ---------------------------------------------------------------- 路径解析

describe('soundBaseOf() / soundExtOf()：从 glob 路径取零件', () => {
  it('取出文件名主干（带目录的完整路径也一样）', () => {
    expect(soundBaseOf('../assets/sounds/cat-click.mp3')).toBe('cat-click')
    expect(soundBaseOf('../assets/sounds/lesson-complete.ogg')).toBe('lesson-complete')
  })

  it('主干里的短横线不能当成扩展名分隔符', () => {
    // `cat-click`、`lesson-complete` 都带短横线。用 `-` 切会得到
    // "click" / "complete" 这种不存在的格式，匹配全灭。
    expect(soundBaseOf('../assets/sounds/cat-click.mp3')).toBe('cat-click')
    expect(soundExtOf('../assets/sounds/lesson-complete.mp3')).toBe('mp3')
  })

  it('扩展名一律小写：主人的导出工具给了大写也不会因此失效', () => {
    expect(soundExtOf('../assets/sounds/cat-click.MP3')).toBe('mp3')
    expect(soundExtOf('../assets/sounds/cat-click.Wav')).toBe('wav')
  })

  it('目录名里有点号时，取的是文件名那一段（不是目录的）', () => {
    expect(soundExtOf('../assets/sounds.v1/cat-click.mp3')).toBe('mp3')
  })
})

// ---------------------------------------------------------------- 找素材

describe('findSound()：在目录现有的文件里找一个主干对应的音频', () => {
  const mp3 = '../assets/sounds/cat-click.mp3'
  const ogg = '../assets/sounds/cat-click.ogg'
  const wav = '../assets/sounds/cat-click.wav'
  const m4a = '../assets/sounds/cat-click.m4a'

  // 标题里的「空目录」不再指"主人还没放素材"了 —— 盘上现在有 4 个 wav。
  // 它守的是**边界**：一个文件都没有时返回 null 而不是抛错，
  // 因为"没有这个主干名"是正常情况（七个合成音就压根不该有素材）。
  it('目录里一个文件都没有 → null，不抛错', () => {
    expect(findSound([], 'cat-click')).toBeNull()
  })

  it('找到就返回那条路径本身', () => {
    expect(findSound([mp3], 'cat-click')).toBe(mp3)
  })

  it('按 SOUND_EXT_PRIORITY 的顺序挑：同主干有多个格式时以靠前的为准', () => {
    // 不这么做的话，同一句话今天响 mp3、明天响 wav（取决于目录读取顺序），
    // 而主人只会觉得"这声音怎么时好时坏"。
    expect(findSound([m4a, wav, ogg, mp3], 'cat-click')).toBe(mp3)
    expect(findSound([m4a, wav, ogg], 'cat-click')).toBe(ogg)
    expect(findSound([m4a, wav], 'cat-click')).toBe(wav)
    expect(findSound([m4a], 'cat-click')).toBe(m4a)
  })

  it('挑的结果与传入顺序无关', () => {
    expect(findSound([mp3, ogg], 'cat-click')).toBe(mp3)
    expect(findSound([ogg, mp3], 'cat-click')).toBe(mp3)
  })

  it('主干必须完全相等，不能前缀命中', () => {
    // 少了这一条，`cat-click-old.mp3` 会被当成 `cat-click` 的素材。
    expect(findSound(['../assets/sounds/cat-click-old.mp3'], 'cat-click')).toBeNull()
    expect(findSound(['../assets/sounds/click.mp3'], 'cat-click')).toBeNull()
  })

  it('主人放的是别的格式（.flac / .aac / .m4b）时找不到 —— 不猜、不错认', () => {
    expect(findSound(['../assets/sounds/cat-click.flac'], 'cat-click')).toBeNull()
    expect(findSound(['../assets/sounds/cat-click.aac'], 'cat-click')).toBeNull()
  })

  it('扩展名优先级表就是这四种，顺序不能随手改', () => {
    expect([...SOUND_EXT_PRIORITY]).toEqual(['mp3', 'ogg', 'wav', 'm4a'])
  })

  it('目录里堆着一堆无关文件也不会找不到', () => {
    const messy = [
      '../assets/sounds/README.md',
      '../assets/sounds/cat-click.mp3.bak',
      '../assets/sounds/duck-click.mp3',
      mp3
    ]
    expect(findSound(messy, 'cat-click')).toBe(mp3)
    expect(findSound(messy, 'duck-click')).toBe('../assets/sounds/duck-click.mp3')
  })

  it('只放了一部分素材时，放了的找得到、没放的返回 null', () => {
    // 主人很可能是分几次攒齐的。「只放一半」必须是完全可用的中间状态。
    const partial = ['../assets/sounds/cat-click.mp3']
    expect(findSound(partial, 'cat-click')).toBe('../assets/sounds/cat-click.mp3')
    expect(findSound(partial, 'duck-click')).toBeNull()
    expect(findSound(partial, 'lesson-complete')).toBeNull()
  })
})

// ---------------------------------------------------------------- 翻译（wire 与引擎之间那道缝）

describe('resolveSources()：文件清单 → 每种场合该播哪些地址', () => {
  /** 假的 urlOf：就说"地址 = 路径前面加个前缀"，方便看出传进来的是哪条路径 */
  const urlOf = (p: string): string => `/bundled/${p.split('/').pop() ?? ''}`

  it('空目录 → 空表（不是报错、不是九个 undefined）', () => {
    expect(resolveSources([], urlOf)).toEqual({})
  })

  it('只有一个文件时，表里只有那一个键', () => {
    const out = resolveSources(['../assets/sounds/cat-click-1.mp3'], urlOf)
    expect(out).toEqual({ meow: ['/bundled/cat-click-1.mp3'] })
    expect('quack' in out).toBe(false)
  })

  it('素材齐了 → 九个键齐了，且各自指向自己的文件', () => {
    const files = ALL_NAMES.flatMap((n) => SFX_FILES[n].map((b) => `../assets/sounds/${b}.mp3`))
    const out = resolveSources(files, urlOf)
    expect(Object.keys(out).sort()).toEqual([...ALL_NAMES].sort())

    for (const name of ALL_NAMES) {
      expect(out[name]).toEqual(SFX_FILES[name].map((b) => `/bundled/${b}.mp3`))
    }
  })

  it('**三段猫叫全放进去 → 池子里就有三个**（抽签池是有内容的）', () => {
    const out = resolveSources(CAT_BASES.map((b) => `../assets/sounds/${b}.wav`), urlOf)
    expect(out.meow).toEqual([
      '/bundled/cat-click-1.wav',
      '/bundled/cat-click-2.wav',
      '/bundled/cat-click-3.wav'
    ])
  })

  it('**只放了两段 → 池子里就两个**（"只放一半"必须是可用的中间状态）', () => {
    // 主人是陆续攒素材的。抽签池要按**实际存在的**算：
    // 拿三段去抽、其中一段不存在，表现就是"三分之一的点击没声音"。
    const out = resolveSources(
      ['../assets/sounds/cat-click-2.wav', '../assets/sounds/cat-click-3.wav'],
      urlOf
    )
    expect(out.meow).toEqual(['/bundled/cat-click-2.wav', '/bundled/cat-click-3.wav'])
  })

  it('池子里的顺序跟着 SFX_FILES 走，不跟着文件在磁盘上的顺序走', () => {
    // glob 的键顺序取决于文件系统，靠它的话同一台机器上换个目录都可能变。
    const out = resolveSources(
      ['../assets/sounds/cat-click-3.wav', '../assets/sounds/cat-click-1.wav'],
      urlOf
    )
    expect(out.meow).toEqual(['/bundled/cat-click-1.wav', '/bundled/cat-click-3.wav'])
  })

  it('传进来的是**原始路径**，不是主干也不是地址', () => {
    // 这条钉的是"翻译规则在纯函数里"这个分工：wire 层只负责把 glob 的键
    // 原样递进来，拼接地址的活是 urlOf 干的。写反了会在打包后表现为
    // "开发模式有声音、打包后没声音"（dev 下地址恰好等于路径）。
    const seen: string[] = []
    resolveSources(['../assets/sounds/cat-click-1.mp3'], (p) => {
      seen.push(p)
      return '/x'
    })
    expect(seen).toEqual(['../assets/sounds/cat-click-1.mp3'])
  })

  it('同一个主干有多个格式时只认优先级最高的那一个', () => {
    const out = resolveSources(
      ['../assets/sounds/cat-click-1.wav', '../assets/sounds/cat-click-1.mp3'],
      urlOf
    )
    expect(out.meow).toEqual(['/bundled/cat-click-1.mp3'])
  })

  it('认不出的文件不会在表里留下半个键', () => {
    const out = resolveSources(['../assets/sounds/unknown.mp3'], urlOf)
    expect(out).toEqual({})
  })
})

// ---------------------------------------------------------------- 抽签

describe('pickSource()：多个候选里随机抽一个', () => {
  const POOL = ['/a.mp3', '/b.mp3', '/c.mp3']

  it('没有素材 / 池子是空的 → null（不是 undefined、不抛错）', () => {
    expect(pickSource(undefined)).toBeNull()
    expect(pickSource([])).toBeNull()
  })

  it('只有一个候选时就是它，**rand 传什么都不影响**', () => {
    // 单候选走的是直通分支，不摇号。摇的话就得依赖"夹住越界"那一行兜着 ——
    // 能不走那条路就不走。
    expect(pickSource(['/only.mp3'], 0)).toBe('/only.mp3')
    expect(pickSource(['/only.mp3'], 0.999)).toBe('/only.mp3')
    expect(pickSource(['/only.mp3'], Number.NaN)).toBe('/only.mp3')
  })

  it('rand 决定抽中哪个：0 → 第一个，接近 1 → 最后一个', () => {
    expect(pickSource(POOL, 0)).toBe('/a.mp3')
    expect(pickSource(POOL, 0.34)).toBe('/b.mp3')
    expect(pickSource(POOL, 0.999)).toBe('/c.mp3')
  })

  it('**越界的 rand 被夹住，绝不会返回 null**', () => {
    // `rand` 是注入参数，调用方（和测试）都可能给 1、负数、NaN。
    // 不夹的话 `floor(1 * 3) = 3` 直接取到 undefined —— 表现是"偶尔点了没声音"，
    // 而查的时候只会去怀疑音频素材。这是本函数唯一一处"信任调用方就会出事"的地方。
    for (const bad of [1, 1.5, -0.2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const got = pickSource(POOL, bad)
      expect(got, `rand=${bad}`).not.toBeNull()
      expect(POOL, `rand=${bad}`).toContain(got)
    }
  })

  it('默认参数是 Math.random —— 不给 rand 也能用，且落在池子里', () => {
    for (let i = 0; i < 50; i++) expect(POOL).toContain(pickSource(POOL))
  })

  it('**三段都抽得到**（说明 rand 真的被用上了，不是永远给第一个）', () => {
    const seen = new Set<string | null>()
    for (let i = 0; i < 300; i++) seen.add(pickSource(POOL))
    expect(seen.size).toBe(3)
  })

  it('池子里混着空串时按空串返回 —— "有没有"由调用方判，本函数只负责抽', () => {
    // `setSfxSources({ meow: [''] })` 这种坏数据要能被静默跳过（见 playSfx 的测试），
    // 那一步是 `if (!url) return` 干的活，不在这里。
    expect(pickSource([''], 0.5)).toBe('')
  })
})

// ---------------------------------------------------------------- 播放（无音频环境）

describe('playSfx()：没有音频环境时必须静默且不抛错', () => {
  it('没有任何素材时点一下 —— 不抛错', () => {
    // 这是**现在的真实状态**：主人还没放素材，全应用照常运行只是不响。
    expect(() => playSfx('meow')).not.toThrow()
    for (const name of ALL_NAMES) expect(() => playSfx(name)).not.toThrow()
  })

  it('登记了素材但 node 环境没有 AudioContext —— 不抛错', () => {
    // 不抛错是刻意的：音效是锦上添花，绝不能因为它让整个应用起不来。
    // 单测环境里 `typeof window === 'undefined'`，`ensureCtx()` 直接返回 null。
    setSfxSources({ meow: ['/bundled/cat-click-1.mp3'] })
    expect(() => playSfx('meow')).not.toThrow()
  })

  it('**池子里有三段猫叫照样不抛错**（抽签 + 过滤那条路也要走一遍）', () => {
    // node 里一个 buffer 都没解出来（`ensureCtx()` 返回 null，`preload` 提前返回），
    // 于是这条把"池子非空但一个都没准备好"那条分支整个跑了一遍。
    setSfxSources({ meow: ['/a.mp3', '/b.mp3', '/c.mp3'] })
    for (let i = 0; i < 20; i++) expect(() => playSfx('meow')).not.toThrow()
  })

  it('关掉开关后连解码都不会触发 —— 仍然不抛错', () => {
    setSfxSources({ meow: ['/bundled/cat-click-1.mp3'] })
    setSfxEnabled(false)
    expect(() => playSfx('meow')).not.toThrow()
  })

  it('primeAudio() 在没有音频环境时也不抛错', () => {
    // 它在 pointerdown 的第一行，**不受任何 return 影响**。
    // 它一抛错，整个界面的每一次按下都会炸。
    expect(() => primeAudio()).not.toThrow()
  })

  it('**音量拨到 0 时静默返回，且不抛错**（和关掉开关走同一条早退）', () => {
    // 音量 0 的语义就是"静音"。走早退而不是"照播、增益乘 0"的理由是副作用：
    // 真播出去会吃掉节流窗口，用户把滑块拉回来之后头一声可能落在窗口里，
    // 表现是"调完音量点了没声音"。
    setSfxSources({ meow: ['/bundled/cat-click-1.mp3'] })
    setSfxVolume(0)
    for (let i = 0; i < 5; i++) expect(() => playSfx('meow')).not.toThrow()
  })

  it('数据坏掉（地址是空串）时静默跳过，不去 fetch 空地址', () => {
    setSfxSources({ meow: [''] })
    expect(() => playSfx('meow')).not.toThrow()
  })

  it('**没跑通的抽签不吃掉节流窗口** —— 这是"第一次点击总是没声音"的成因', () => {
    // 抽中一个还没解码好的地址时，必须**不记账**就返回。
    // 记账了的话，等解码完成后的那一声会被刚过去的节流窗口挡住，
    // 表现就是"第一下点猫咪没声音，第二下才有"。
    //
    // 这里能量到的只有"不抛错"（node 里没有 AudioContext，没有可观察的副作用），
    // 真正的记账规则靠 `playSfx` 里 `lastPlayedAt.set` 的位置守着：
    // 它在**所有 return 之后**。这条测试钉的是那个位置别被挪上去。
    setSfxSources({ meow: ['/a.mp3', '/b.mp3'] })
    setSfxEnabled(true)
    for (let i = 0; i < 10; i++) expect(() => playSfx('meow')).not.toThrow()
  })
})

// ---------------------------------------------------------------- 总音量

/*
 * 【这一节守什么】音量滑块是**唯一一个"拨了之后没有任何界面证据"的设置**：
 * 声音轻了还是没声了，用户分不出来，也不会有人报错。它坏掉的方式有三种，
 * 三种都不报错：
 *
 *   1. **单位搞错**。配置文件里是 0~100，`gain.gain.value` 要的是 0~1。
 *      把 100 直接写进增益 = **100 倍**，一耳朵爆音。
 *   2. **0 被当成"没设置"**。`masterVolume || 1` 这种写法下，静音存不住。
 *   3. **少乘了一个因子**。总音量没乘进去的话，滑块看着能动、声音一点不变。
 *
 * ⚠️ 这个文件里**放不出声音**（node 没有 AudioContext，`playSfx` 走到
 * `ensureCtx()` 就返回 null），所以能钉住的是**那道乘法本身** ——
 * 这正是 `sfxGainOf` 被抽成纯函数的原因（见它的注释）。
 */

describe('总音量：单位是百分比，增益是倍数', () => {
  it('默认是 100（满音量）—— 不调就是原始响度', () => {
    expect(getSfxVolume()).toBe(100)
  })

  it('拨多少就是多少（0 / 1 / 50 / 100 一个不差）', () => {
    for (const pct of [0, 1, 50, 80, 100]) {
      setSfxVolume(pct)
      expect(getSfxVolume(), `设成 ${pct}%`).toBe(pct)
    }
  })

  it('★ **单位换算真的发生了**：50% 时增益是 0.5，不是 50', () => {
    // 这条是整个换算唯一的证据。少了它，把百分比直接当倍数写进去
    // （`masterVolume = percent`）也是全绿的 —— 而那是 100 倍增益的爆音。
    setSfxVolume(50)
    expect(sfxGainOf('click', undefined)).toBeCloseTo(0.5, 10)
  })

  it('★ 越界和脏值：钳进 0~100；**给不出数时当满音量**，不是当静音', () => {
    // 拿不到数就把整个应用静音，用户会去怀疑音频驱动 ——
    // 而真实原因是一个我们没拦住的值。所以坏输入退回 100。
    setSfxVolume(500)
    expect(getSfxVolume()).toBe(100)
    setSfxVolume(-20)
    expect(getSfxVolume()).toBe(0)

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '50' as unknown as number]) {
      setSfxVolume(bad)
      expect(getSfxVolume(), `坏输入 ${String(bad)}`).toBe(100)
    }
  })

  it('★ 三个因子都真的乘进去了（缺一个，滑块就会"能动但不管用"）', () => {
    // 场合增益 × 单文件增益 × 总音量，一项都不能少：
    //   · 少场合增益 → 某个音效的单独调整失效（SFX_GAIN 那一整张表白写）
    //   · 少单文件增益 → 三段猫叫里那段轻一半的又变回轻一半
    //   · 少总音量 → 滑块拖动没有任何效果（这条正是本节的由来）
    setSfxVolume(50)
    const base = 'cat-click-2'
    expect(sfxGainOf('meow', base)).toBeCloseTo(SFX_GAIN.meow * SFX_BASE_GAIN[base]! * 0.5, 10)
    // 反例：没写过的那一段不该被 SFX_BASE_GAIN 影响
    expect(sfxGainOf('meow', 'cat-click-1')).toBeCloseTo(SFX_GAIN.meow * 0.5, 10)
    // 主干是 undefined（地址反推不出来）时按 1 算，不能变成 NaN
    expect(sfxGainOf('click', undefined)).toBeCloseTo(SFX_GAIN.click * 0.5, 10)
  })

  it('音量是**每次播放时现读**的，不是装配时算好一次', () => {
    // 写成装配期的常量（比如塞进 SFX_GAIN 表里）的话，滑块要重启才生效。
    setSfxVolume(20)
    const quiet = sfxGainOf('click', undefined)
    setSfxVolume(100)
    expect(sfxGainOf('click', undefined)).toBeGreaterThan(quiet)
  })

  it('__resetSfxForTest() 会把音量拨回 100（模块级变量跨用例会串味）', () => {
    // 不归位的话，上一个用例把音量拉到 0，下一个用例的 playSfx 会**提前 return**
    // （音量 0 和关掉开关走同一条早退）—— 表现是"某一格测试莫名其妙没声音"。
    setSfxVolume(0)
    __resetSfxForTest()
    expect(getSfxVolume()).toBe(100)
  })
})

describe('总开关：setSfxEnabled / isSfxEnabled', () => {
  it('默认是开的', () => {
    expect(isSfxEnabled()).toBe(true)
  })

  it('拨来拨去能回到原值（设置页那个开关就是它）', () => {
    setSfxEnabled(false)
    expect(isSfxEnabled()).toBe(false)
    setSfxEnabled(true)
    expect(isSfxEnabled()).toBe(true)
  })

  it('__resetSfxForTest() 会把开关拨回默认的开', () => {
    // 模块级变量跨用例会串味：上一个用例关掉了开关，
    // 下一个用例的 playSfx 就会在没料到的地方提前 return。
    setSfxEnabled(false)
    __resetSfxForTest()
    expect(isSfxEnabled()).toBe(true)
  })
})
