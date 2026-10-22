import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  MASCOT_POSES,
  MASCOT_POSE_TONE,
  MASCOT_SIZES,
  MASCOT_SIZE_PX,
  PLACEHOLDER_CHARS,
  PLACEHOLDER_PADDING,
  RUN_MASCOT_POSE,
  mascotBaseOf,
  mascotKeysFor,
  needsPortrait,
  pickVariantIndex,
  placeholderFontPx,
  seedFromKey,
  showsPlaceholderText,
  variantBase,
  variantsOf,
  type MascotSize
} from '../mascot'
import { MASCOT } from '../copy'
import { maskComments } from '../../../../shared/__tests__/mask-comments'

/**
 * 形象规格的闸门。
 *
 * 【为什么值得单独一个测试文件】
 * 这里算的是**画面上直接看得见的东西**：字号会不会把虚线框撑破、32px 档会不会糊成一坨。
 * 这些错在浏览器里一眼就能发现，但那时候已经上线了——
 * 而这个模块是纯函数，机器跑一遍只要几毫秒，成本几乎为零。
 *
 * 【两条闸门的性质不同】
 *   ① 「框够不够大」是**内部一致性**：字号算错了，这里立刻红。
 *   ② 「档位是不是 32/48/80/112/160」是**外部一致性**：真源在 docs/13，
 *      所以直接把那份 markdown 读进来对表——而不是在测试里再抄一遍数字。
 *      抄一遍只能证明「我抄得对」，读文档才能证明「代码和规格没走散」。
 */

/** 测试文件在 src/renderer/src/lib/__tests__，往上 5 层是仓库根 */
const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const SPEC = readFileSync(join(ROOT, 'docs', '13-图片资产需求清单.md'), 'utf8')

/**
 * 截出某一节的内容。
 *
 * 为什么要按节截：文档里有一堆长得差不多的表格，全文裸匹配会把别节的
 * 「`xs` `s` `m`」之类当成姿态 key 抓进来（第一版就是这么挂的）。
 * 按标题切段之后，正则只需要在这个小节里正确即可。
 */
function section(start: string, end: string): string {
  const a = SPEC.indexOf(start)
  const b = SPEC.indexOf(end)
  if (a === -1 || b === -1 || b <= a) throw new Error(`docs/13 里找不到小节：${start} … ${end}`)
  return SPEC.slice(a, b)
}

/** 从 docs/13 §2.1 的档位表里把边长抠出来 */
function specSizes(): Record<string, number> {
  const out: Record<string, number> = {}
  const s = section('### 2.1', '### 2.2')
  for (const m of s.matchAll(/^\|\s*\*\*(XS|S|M|L|XL)\*\*\s*\|\s*(\d+)\s*px/gim)) {
    out[m[1].toLowerCase()] = Number(m[2])
  }
  return out
}

/** 从 docs/13 §3 的姿态表里把 key 抠出来（去重：同一姿态可能被别的表再提一次） */
function specPoses(): string[] {
  const s = section('## 3.', '## 4.')
  const out = new Set<string>()
  for (const m of s.matchAll(/^\|\s*`([a-z]+)`\s*\|/gm)) out.add(m[1])
  return [...out]
}

describe('尺寸档与 docs/13 §2.1 对表', () => {
  const spec = specSizes()

  it('文档里确实解析出了 5 档（不是正则失效导致的假绿）', () => {
    // 没有这条，正则一旦匹配不到就返回空表，下面的循环一次都不跑 —— 测试「通过」但什么都没查
    expect(Object.keys(spec).sort()).toEqual(['l', 'm', 's', 'xl', 'xs'])
  })

  it('每一档的边长与文档一致', () => {
    for (const size of MASCOT_SIZES) {
      expect(MASCOT_SIZE_PX[size], `${size} 档边长与 docs/13 §2.1 对不上`).toBe(spec[size])
    }
  })

  it('档位从小到大严格递增（顺序错了，档位就失去「大中小」的含义）', () => {
    const vals = MASCOT_SIZES.map((s) => MASCOT_SIZE_PX[s])
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1])
  })
})

describe('姿态 key 与 docs/13 §3 对表', () => {
  it('代码里的 10 个姿态与文档表格逐字一致', () => {
    expect([...MASCOT_POSES].sort()).toEqual(specPoses().sort())
  })

  it('姿态 key 只含小写字母（它就是出图的文件名，大小写错了组件查不到图）', () => {
    for (const p of MASCOT_POSES) expect(p, p).toMatch(/^[a-z]+$/)
  })
})

describe('占位框放不放得下那行字', () => {
  it('占位文案的字数与 PLACEHOLDER_CHARS 对得上', () => {
    // 这条是**给下面那条算式的保险**：改了文案却没改字数常量，
    // 算式照旧通过，但真实文字会悄悄溢出虚线框 —— 只有这条能拦住。
    expect(MASCOT.PLACEHOLDER.length, '改了 MASCOT.PLACEHOLDER 就要同步改 PLACEHOLDER_CHARS').toBe(
      PLACEHOLDER_CHARS
    )
  })

  it('凡是显示文字的档位，一行文字加内边距都塞得进框里', () => {
    for (const size of MASCOT_SIZES) {
      if (!showsPlaceholderText(size)) continue
      const need = PLACEHOLDER_CHARS * placeholderFontPx(size) + 2 * PLACEHOLDER_PADDING
      expect(need, `${size} 档：文字需要 ${need}px，框只有 ${MASCOT_SIZE_PX[size]}px`).toBeLessThanOrEqual(
        MASCOT_SIZE_PX[size]
      )
    }
  })

  it('字号既不为 0 也不过小（小于 10px 用户根本看不清那行提示）', () => {
    for (const size of MASCOT_SIZES) expect(placeholderFontPx(size), size).toBeGreaterThanOrEqual(10)
  })

  it('小档位不显示文字，中大档位显示', () => {
    const showing = MASCOT_SIZES.filter(showsPlaceholderText)
    expect(showing).toEqual(['m', 'l', 'xl'])
  })

  it('小档位确实放不下：把文字硬塞进去必然溢出（证明「不显示」不是偷懒）', () => {
    for (const size of MASCOT_SIZES.filter((s) => !showsPlaceholderText(s))) {
      const need = PLACEHOLDER_CHARS * placeholderFontPx(size) + 2 * PLACEHOLDER_PADDING
      expect(need, `${size} 档居然塞得下，那就不该藏文字`).toBeGreaterThan(MASCOT_SIZE_PX[size])
    }
  })
})

describe('读屏文案', () => {
  it('开口音里带上了姿态与尺寸，不是一句空话', () => {
    const aria = MASCOT.aria('welcome', 's')
    expect(aria).toContain('welcome')
    expect(aria).toContain('48')
  })

  it('每一档的开口音都不为空', () => {
    for (const size of MASCOT_SIZES as readonly MascotSize[]) {
      expect(MASCOT.aria('yay', size).length, size).toBeGreaterThan(4)
    }
  })
})

// ──────────────────────────────────────────────────────── 情绪与图池（M5-05）

describe('情绪色调', () => {
  it('十个姿态一个不落都有色调（漏一个，那个姿态的占位框就退成灰色）', () => {
    for (const p of MASCOT_POSES) expect(MASCOT_POSE_TONE[p], p).toBeTruthy()
  })

  it('色调取值只有约定的四种', () => {
    const allowed = ['neutral', 'busy', 'good', 'care']
    for (const p of MASCOT_POSES) expect(allowed, p).toContain(MASCOT_POSE_TONE[p])
  })
})

describe('运行状态 → 姿态', () => {
  const STATES = ['running', 'ok', 'fail'] as const

  it('三种状态各有姿态，且互不相同（三个状态同一张脸就等于没做）', () => {
    const poses = STATES.map((s) => RUN_MASCOT_POSE[s])
    expect(new Set(poses).size, `三个状态都指向了同一张：${poses.join(',')}`).toBe(3)
    for (const p of poses) expect(MASCOT_POSES, `RUN_MASCOT_POSE 指向了不存在的姿态 ${p}`).toContain(p)
  })

  it('三种状态用的都是已有的姿态，没有多出来要出图的 key', () => {
    // 这三张（busy / yay / soothe）docs/13 §3 里本来就有，见 RUN_MASCOT_POSE 的注释。
    // 谁要是往这儿塞一个 §3 表里没有的新 key，出图清单就对不上了。
    for (const s of STATES) expect(specPoses(), `姿态表里没有 ${RUN_MASCOT_POSE[s]}`).toContain(RUN_MASCOT_POSE[s])
  })

  /**
   * 这条是这一组里最有价值的：把「姿态」和「色调」两个表**交叉验证**。
   * 光看 RUN_MASCOT_POSE 是看不出错的——把 running 改成 `proud` 语法完全合法，
   * 但那会在「正在跑」的时候摆出一条绿色的、庆祝用的鱼。占位框的颜色来自
   * MASCOT_POSE_TONE，所以只有把两张表对起来，这种错才会红。
   */
  it('姿态的色调必须和状态对得上（跑着却是绿框＝正在庆祝的样子）', () => {
    const want = { running: 'busy', ok: 'good', fail: 'care' } as const
    for (const s of STATES) {
      const pose = RUN_MASCOT_POSE[s]
      expect(MASCOT_POSE_TONE[pose], `${s} 用了 ${pose}，它的色调是另一回事`).toBe(want[s])
    }
  })
})

describe('图池抽签', () => {
  it('同一个 seed 永远给同一张（这条就是「图不能抖」的全部保障）', () => {
    // 输出区每次重渲染都会重新求值一次 pickVariantIndex。要是它内部用
    // Math.random()，用户看到的不是「每次换一张」而是图在疯狂闪。
    for (let seed = 0; seed < 20; seed++) {
      const first = pickVariantIndex(3, seed)
      for (let i = 0; i < 50; i++) expect(pickVariantIndex(3, seed), `seed=${seed}`).toBe(first)
    }
  })

  it('seed 每加一就换一张，三张轮着来', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => pickVariantIndex(3, s))).toEqual([0, 1, 2, 0, 1, 2])
  })

  it('结果永远落在 [0, count) 里（越界就是拿 undefined 去查图，界面直接空一块）', () => {
    for (const count of [1, 2, 3, 7]) {
      for (const seed of [-100, -1, 0, 1, 5, 999, 12345]) {
        const i = pickVariantIndex(count, seed)
        expect(i, `count=${count} seed=${seed}`).toBeGreaterThanOrEqual(0)
        expect(i, `count=${count} seed=${seed}`).toBeLessThan(count)
      }
    }
  })

  it('一张图都没有时也不越界（目录为空是当前正常状态，不是异常路径）', () => {
    expect(pickVariantIndex(0, 5)).toBe(0)
  })
})

describe('图片文件名', () => {
  it('编号从 01 起、一律两位（出图的人不用记「第一张要特殊」这条规矩）', () => {
    expect(variantBase('yay', 0)).toBe('yay_01')
    expect(variantBase('yay', 1)).toBe('yay_02')
    expect(variantBase('yay', 9)).toBe('yay_10')
    // 超过 99 张也不截断：补零只补不切
    expect(variantBase('yay', 99)).toBe('yay_100')
  })

  it('从 glob 给的路径里取主干', () => {
    expect(mascotBaseOf('../../assets/mascot/yay_01.png')).toBe('yay_01')
    expect(mascotBaseOf('../../assets/mascot/soothe_03.png')).toBe('soothe_03')
    // 大写后缀也认（Windows 上资源名大小写很随意）
    expect(mascotBaseOf('../../assets/mascot/yay_01.PNG')).toBe('yay_01')
  })

  it('只挑出这个 key 自己的图', () => {
    const all = ['yay_01', 'yay_02', 'yay_03', 'soothe_01', 'soothe_02', 'busy_01', 'welcome_01']
    expect(variantsOf('yay', all)).toEqual(['yay_01', 'yay_02', 'yay_03'])
    expect(variantsOf('soothe', all)).toEqual(['soothe_01', 'soothe_02'])
    expect(variantsOf('busy', all)).toEqual(['busy_01'])
    expect(variantsOf('proud', all)).toEqual([])
  })

  it('不会把名字相近的认成自己人', () => {
    // 少了正则两头的 ^ $，`busy` 会去匹配 `busybody`，
    // `yay` 会去匹配 `yay_02x` —— 图池里混进别的图，抽出来驴唇不对马嘴
    const all = ['busybody', 'yay_02x', 'yayx', 'soothe_', 'yay_02', 'busy_01']
    expect(variantsOf('yay', all)).toEqual(['yay_02'])
    expect(variantsOf('soothe', all)).toEqual([])
    expect(variantsOf('busy', all)).toEqual(['busy_01'])
  })

  it('不带编号的写法也认（用户丢一张 `busy.png` 进去，界面不能纹丝不动）', () => {
    // 零编程经验的用户很有可能就这么放第一张。不认的话，他得到的是
    // 「这软件坏了」，而不是「文件名少了两个字符」—— 这条路径必须通
    expect(variantsOf('busy', ['busy'])).toEqual(['busy'])
    expect(variantsOf('busy', ['busy', 'busy_02'])).toEqual(['busy', 'busy_02'])
  })

  it('两种写法同时存在时，顺序仍然唯一（不能这次排 A 下次排 B）', () => {
    // `busy` 和 `busy_01` 都算「第 1 张」，光按编号排是个平局，
    // 平局不定序 = 同一个 seed 两次抽到不同的图
    const a = variantsOf('busy', ['busy_01', 'busy', 'busy_02'])
    const b = variantsOf('busy', ['busy', 'busy_02', 'busy_01'])
    expect(a).toEqual(b)
    expect(a).toEqual(['busy', 'busy_01', 'busy_02'])
  })

  it('必须按数字排，不能按字符串排', () => {
    // 字符串序下 'yay_10' < 'yay_02'，于是「第 2 张」是哪张会取决于
    // 图库碰巧有没有第 10 张 —— 同一个 seed 在两台机器上抽出不同的图
    const all = ['yay_02', 'yay_10', 'yay_01', 'yay_03']
    expect(variantsOf('yay', all)).toEqual(['yay_01', 'yay_02', 'yay_03', 'yay_10'])
  })
})

/**
 * 三种情况 —— 空目录 / 一张图 / 多张图。
 *
 * 【为什么单独一组】这三种是「图片陆续到位」这个过程中**必然会经历**的三个阶段，
 * 而且都不是异常路径：图一张都没有是当前正常状态，只有一张是出了第一张的第二天。
 * 三个都得对，中间任何一个错都会表现成「界面空一块」或者「图在闪」。
 */
describe('三种情况：空目录 / 一张 / 多张', () => {
  it('① 一张都没有：图池是空的，抽签也不越界（界面走占位框，不崩）', () => {
    const pool = variantsOf('busy', [])
    expect(pool).toEqual([])
    for (const seed of [0, 1, 7, 9999]) expect(pickVariantIndex(pool.length, seed)).toBe(0)
  })

  it('② 只有一张：图池就是它，随便什么 seed 都抽到它（不会转到空位）', () => {
    const pool = variantsOf('busy', ['busy_01'])
    expect(pool).toEqual(['busy_01'])
    expect([0, 1, 2, 99].map((s) => pickVariantIndex(pool.length, s))).toEqual([0, 0, 0, 0])
  })

  it('③ 多张：乱序丢进来也排得对，而且每一张都轮得到', () => {
    const pool = variantsOf('busy', ['busy_03', 'busy_01', 'busy_02'])
    expect(pool).toEqual(['busy_01', 'busy_02', 'busy_03'])
    const hit = new Set([0, 1, 2, 3, 4, 5].map((s) => pickVariantIndex(pool.length, s)))
    expect([...hit].sort()).toEqual([0, 1, 2])
  })

  it('别的姿态的图不会混进来（所以「只放一张 busy」只影响运行中那一格）', () => {
    const all = ['busy_01', 'yay_01', 'yay_02', 'welcome_01']
    expect(variantsOf('busy', all)).toEqual(['busy_01'])
    expect(variantsOf('yay', all)).toEqual(['yay_01', 'yay_02'])
    expect(variantsOf('milestone', all)).toEqual([])
  })
})

/**
 * 半身版 —— 小档位（xs/s）必须用半身/头像构图，理由见 docs/13 §2.2：
 * 全身图缩到 32px 只剩一个蓝点，认不出是谁。
 */
describe('小档位优先用半身版', () => {
  it('分界线画在 s 与 m 之间（m 档起全身图还看得清）', () => {
    expect(needsPortrait('xs')).toBe(true)
    expect(needsPortrait('s')).toBe(true)
    expect(needsPortrait('m')).toBe(false)
    expect(needsPortrait('l')).toBe(false)
    expect(needsPortrait('xl')).toBe(false)
  })

  it('小档位先找 -head，再退回全身；大档位根本不找 -head', () => {
    expect(mascotKeysFor('welcome', 's')).toEqual(['welcome-head', 'welcome'])
    expect(mascotKeysFor('welcome', 'xs')).toEqual(['welcome-head', 'welcome'])
    expect(mascotKeysFor('welcome', 'l')).toEqual(['welcome'])
  })

  it('半身版自己也能有图池（`welcome-head_01`、`welcome-head_02`）', () => {
    const all = ['welcome-head_01', 'welcome-head_02', 'welcome_01', 'welcome_02']
    expect(variantsOf('welcome-head', all)).toEqual(['welcome-head_01', 'welcome-head_02'])
    expect(variantsOf('welcome', all)).toEqual(['welcome_01', 'welcome_02'])
  })

  it('把全身版的名字当成半身版去找，是找不到的（两者互不串台）', () => {
    // 少了这条，`welcome-head` 的正则一旦放宽就会把 `welcome_01` 也收进来，
    // 于是 48px 的侧栏 Logo 显示一张缩成一点的全身图
    expect(variantsOf('welcome-head', ['welcome_01'])).toEqual([])
  })
})

describe('从日期键之类的字符串算种子', () => {
  it('同一个字符串永远给同一个数（这一格才不会闪）', () => {
    for (let i = 0; i < 50; i++) expect(seedFromKey('2026-09-13')).toBe(seedFromKey('2026-09-13'))
  })

  it('日期键带连字符也不会算成 NaN（写成 Number(key) 就在这里挂）', () => {
    expect(Number.isNaN(seedFromKey('2026-09-13'))).toBe(false)
    expect(Number.isFinite(seedFromKey('2026-09-13'))).toBe(true)
  })

  it('连着几天给出不同的种子（否则「每天换一张脸」是假的）', () => {
    const days = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']
    const seeds = new Set(days.map(seedFromKey))
    expect(seeds.size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------- V1-39 默认种子

/**
 * V1-39（主人裁定「是 bug 要修」）：MiMascot 不传 seed 时恒定用第 1 张 ——
 * 145 张素材里绝大多数永远见不到光。修法=默认种子换成「当天日键」，
 * 当天内稳定、过零点由 day-clock 的 today ref 翻新。
 *
 * 【为什么是静态锚点】node 环境渲染不了 Vue 单文件组件（见 pet-guide.test.ts
 * 同款理由）：这里证明的是「视图引用的是当天种子这条表达式」，
 * 不证明浏览器里排出来的样子 —— 视觉验收归批⑦收尾探针。
 */
describe('MiMascot 默认种子（V1-39）：不传 seed = 按当天轮换，不是恒定第 1 张', () => {
  const RAW = readFileSync(join(__dirname, '..', '..', 'components', 'base', 'MiMascot.vue'), 'utf8')
  const MASKED = maskComments(RAW)

  it('脚本段引用 day-clock 的 today 与 seedFromKey；默认值里没有写死的种子', () => {
    expect(MASKED).toContain('props.seed ?? seedFromKey(today.value)')
    expect(MASKED).toContain("from '../../lib/day-clock'")
    // 默认 props 不许再把 seed 钉回常数（旧写法 `{ size: 'm', seed: 0 }`）
    expect(MASKED).not.toContain('seed: 0')
  })

  it('尺子自证：把表达式改回写死 0，同一条判据必须抓住', () => {
    const bad = MASKED.replace('props.seed ?? seedFromKey(today.value)', '0')
    expect(bad).not.toBe(MASKED)
    expect(bad).not.toContain('props.seed ?? seedFromKey(today.value)')
  })
})
