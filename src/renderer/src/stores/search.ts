/**
 * 搜索 store：查询词（200ms 防抖）+ 结果集 + 面板开关。
 * 数据源是 bundle.searchIndex（打包期构建的全文索引），全内存检索。
 *
 * 【学习闭环 §9】题目命中（`questionHits`）也在这里 —— 它和课程结果**共用
 * 同一个防抖后的查询词**：两路结果必须同时到达。各自防抖的话，
 * 用户会看到"课程说 3 条、题目说 5 道"来自两个不同时刻的输入。
 * 面板的入口行、↑↓ 巡回清单、开卷动作读的都是这一份 ——
 * 「界面说几道」和「开出去几道」在数据层就是同一个数。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { SEARCH_QUIZ_MAX, searchEntries, searchQuestions } from '../../../shared/search'
import { useContentStore } from './content'
import type { ContentBundle } from '../../../shared/types'
import bundleJson from '../generated/content-bundle.json'

const bundle = bundleJson as unknown as ContentBundle
const DEBOUNCE_MS = 200

export const useSearchStore = defineStore('search', () => {
  const content = useContentStore()
  const open = ref(false)
  const rawQuery = ref('')
  const debouncedQuery = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  const query = computed({
    get: () => rawQuery.value,
    set: (v: string) => {
      rawQuery.value = v
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        debouncedQuery.value = v
      }, DEBOUNCE_MS)
    }
  })

  const results = computed(() => searchEntries(bundle.searchIndex, debouncedQuery.value, 30))

  /**
   * 防抖窗口还在跑：原始词已经变了，结果集还停在**上一个词**上
   * （2026-10-17 夜间批）。
   *
   * 【为什么要有这个读数】面板的空态原来是拿 `query`（原始词）判的，而结果集
   * 吃的是 `debouncedQuery` —— 从空查询开始搜的头 200ms 里，原始词非空、两组
   * 结果却都还是 []，"没有找到相关的小鱼干喵～"必然先跳出来一次，再被结果
   * 顶掉。空态是关于结果的结论，判据必须和结果同源：窗口没跑完就是"还没有
   * 结论"，界面据此什么都不说（跑完且真没有，才轮得到空态）。
   */
  const pending = computed(() => rawQuery.value !== debouncedQuery.value)

  /**
   * 题目命中（挑战题已滤掉，见 shared/search.ts）。
   *
   * 索引走 content store 的 computed（全应用唯一那份，别在这里再 build 一次 ——
   * 同一份数据构建两遍，两份就可能有一份是旧的）。
   */
  const questionHits = computed(() =>
    searchQuestions(content.questionIndex, debouncedQuery.value, SEARCH_QUIZ_MAX)
  )

  function openPanel(q = '') {
    query.value = q
    open.value = true
  }
  function closePanel() {
    open.value = false
  }

  return { open, query, pending, results, questionHits, openPanel, closePanel }
})
