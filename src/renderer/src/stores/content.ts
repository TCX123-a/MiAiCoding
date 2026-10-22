/**
 * 内容 store：content-bundle 数据的唯一入口 + 侧栏选择状态。
 * bundle 是构建期产物（改内容后先 npm run build:content），渲染进程直接 import，天然离线。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ContentBundle, Lang, Lesson, OutlineLesson, OutlineModule, Stage } from '../../../shared/types'
import bundleJson from '../generated/content-bundle.json'
import { computeUnlocked } from '../../../shared/unlock'
import { nextWrittenAfter } from '../../../shared/lesson-nav'
import { buildQuestionIndex } from '../../../shared/question-index'
import { useProgressStore } from './progress'

const bundle = bundleJson as unknown as ContentBundle

export const useContentStore = defineStore('content', () => {
  // ---- 数据
  /**
   * 有正文的课。⚠️ `bundle.lessons` **只装「已经写了正文的课」**，别拿它当「课的全集」用。
   *
   * 【这里原先写死了节数，结果漂了两次：5 节 → 36 节 → 41 节】
   * 每写完一批内容这个数就变一次，而**没有任何闸门会去读注释** —— 所以现在不写数字了，
   * 只说「只装哪一类」。要数当前节数请看 `bundle.lessons.length`，别抄进注释。
   */
  const lessonIndex = new Map<string, Lesson>()
  for (const l of bundle.lessons) lessonIndex.set(l.id, l)

  /**
   * 大纲全表：194 节，**包括还没写正文的那些**。
   *
   * 【为什么非要有这张表 —— 2026-09-14 踩的坑】
   * 判断「这个课号存不存在」原先用的是上面那张 `lessonIndex`（当时只装得下 5 节），
   * 于是还没写正文的那些空壳课全被判成「课号不对」，详情页显示
   * 「没有找到这一课喵～ 可能是链接里的课号不对」—— **可它明明在大纲里**。
   * 更糟的是方向也反了：它把「还没写」说成了「链接错了」，
   * 用户会顺着这句话去检查链接，而链接一点问题都没有。
   *
   * 顺带把 `titleOf` / `statusOf` 各自 flatMap 一遍的那两次同样扫描也收进来 ——
   * 同一份名单扫三遍，改一处漏两处是迟早的事。
   */
  const outlineIndex = new Map<string, OutlineLesson>()
  for (const m of bundle.outline) for (const l of m.lessons) outlineIndex.set(l.id, l)

  // ---- 侧栏选择状态
  const activeLang = ref<Lang>('common')
  const activeStage = ref<1 | 2 | 3>(1)

  const activeModule = computed<OutlineModule | undefined>(() => {
    const stage = activeLang.value === 'common' ? 0 : activeStage.value
    return bundle.outline.find((m) => m.lang === activeLang.value && m.stage === stage)
  })

  const activeLessons = computed<OutlineLesson[]>(() => activeModule.value?.lessons ?? [])

  const totalLessons = computed(() => bundle.outline.reduce((s, m) => s + m.lessons.length, 0))

  // ---- 解锁与状态
  const progress = useProgressStore()
  const unlockedIds = computed(() => {
    // 只喂 `bundle.lessons`（**有正文的那些**）—— 没有正文的课永远无法被标记已学，
    // 把它们放进解锁图会让「前置是它们」的课永久锁死。打包器已经把这类前置
    // 过滤掉了（见 scripts/content-build.mjs），两边是同一条规则的两端。
    return computeUnlocked(bundle.lessons, new Set(progress.profile.learned))
  })

  function lessonOf(id: string): Lesson | undefined {
    return lessonIndex.get(id)
  }

  /**
   * 大纲里有没有这个课号（**不管正文写没写**）。
   *
   * 判断「课号对不对」只能用它 —— 拿 `lessonOf` 判会把 189 节空壳课全冤枉成
   * 「课号不存在」（见上面 outlineIndex 那段）。
   */
  function inOutline(id: string): boolean {
    return outlineIndex.has(id)
  }

  /** 大纲课名（含未生成课） */
  function titleOf(id: string): string | undefined {
    return outlineIndex.get(id)?.title
  }

  /**
   * 课状态：draft = 内容未生成；locked = 前置未完成；open = 可学；learned = 已学
   *
   * ⚠️ 课号**根本不在大纲里**时这里同样返回 'draft'（它当然也没有正文）。
   * 要给用户看「没有这课」和「有课但还没写」两种不同的话，调用方必须再问一次
   * `inOutline()` —— 只有 statusOf 一个返回值是分不出来的。
   */
  function statusOf(id: string): 'draft' | 'locked' | 'open' | 'learned' {
    if (!outlineIndex.get(id)?.hasContent) return 'draft'
    if (progress.profile.learned.includes(id)) return 'learned'
    return unlockedIds.value.has(id) ? 'open' : 'locked'
  }

  /**
   * 已经写好正文的课有几节。
   *
   * 【为什么这个数必须有出处】194 节大纲里只有 5 节有正文，用户撞上空壳课的
   * 概率是 97% —— 提示语里不告诉他「还有 N 节能学」，他没法判断这软件到底是
   * 内容没做完还是坏了。写死数字会在下次补正文时开始撒谎，所以从 bundle 现算。
   */
  const readyCount = computed(() => bundle.lessons.length)

  /**
   * 「下一节现在就能上的课」：大纲顺序里第一节**有正文、且当前已解锁未学**的课。
   *
   * 给空壳课空状态那个「去学写好的课」按钮当目标用。没有它，用户从备课页出来
   * 只能自己退回侧栏一节节试 —— 而侧栏里 97% 的行点下去还是同一句提示。
   * 全部学完时退回「第一节有正文的课」，按钮至少不指向空。
   */
  const nextUpId = computed<string | null>(() => {
    const written = bundle.outline.flatMap((m) => m.lessons).filter((l) => l.hasContent)
    return (written.find((l) => statusOf(l.id) === 'open') ?? written[0])?.id ?? null
  })

  /**
   * 「**这一课之后**第一节有正文的课」（V2-15 / V1-24）—— 课页那颗
   * 「下一课 →」按钮的目标。判据在 `shared/lesson-nav.ts`（纯函数、有单测，
   * 那里也记着「为什么不能用上面那个 nextUpId」的现场）。
   *
   * 暴露成函数而不是 computed：它按课号取值，调用方（课详情页）自己拿
   * 当前课号调 —— 一个 computed 装不下"每个课号一个答案"这层。
   */
  function nextWrittenAfterId(id: string): string | null {
    return nextWrittenAfter(bundle.outline, id)
  }

  function selectLang(lang: Lang) {
    activeLang.value = lang
  }
  function selectStage(stage: 1 | 2 | 3) {
    activeStage.value = stage
  }

  /**
   * 运行时题目索引：全部有正文的课 × 每道题的"轻档案"（键/课号/语言/阶段/题型/难度/标签/题干）。
   *
   * 【为什么在这里、以 computed 的形式】
   * 它是 `bundle.lessons` 的纯派生物（理由与体积账见 shared/question-index.ts 抬头），
   * 而这个 store 是 bundle 的唯一入口。做成 computed 而不是模块级常量：
   * 惰性求值 —— 一次都不用的会话（比如只开设置页）一个字节都不构建；
   * 构建是毫秒级的纯函数，缓存判定交给 Vue，不需要自己记。
   *
   * 消费方（延展池、阶段卷、每日复习、搜索）一律从这里取，**不许各自再
   * buildQuestionIndex 一次** —— 同一份数据构建两遍，两份就可能有一份是旧的。
   */
  const questionIndex = computed(() => buildQuestionIndex(bundle.lessons))

  return {
    bundle,
    lessonIndex,
    activeLang,
    activeStage,
    activeModule,
    activeLessons,
    totalLessons,
    unlockedIds,
    readyCount,
    nextUpId,
    nextWrittenAfterId,
    questionIndex,
    lessonOf,
    inOutline,
    titleOf,
    statusOf,
    selectLang,
    selectStage
  }
})
