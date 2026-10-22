/**
 * 练习史 store（`practice.json` 的渲染层读口）。
 *
 * 【它是谁的下游】写口**只有一个**：`stores/quiz.ts` 的 `finish()` 里那句
 * `recordPractice`（一次做完的练习落一条）。这个 store **不写** —— 它的职责是
 * 让每日复习拿得到那份历史（`shared/review-paper.ts` 的加权真源）。
 *
 * 【为什么 adopt() 要接住 finish() 的返回值，而不是回头再拉一次】
 * `finish()` 记完账后是**不等**的（`void ...recordPractice(...)`），用户完全可能
 * 在写盘落地之前就点进复习页开卷。若复习页这时自己去 `getPractice()`，
 * 拿到的可能是**上一份**历史 —— 刚做完的那一局没算进权重里，而且这个差错
 * 不会报错、只是"这次的错题这次没被照顾到"，下次开卷又好了（下次读的是新文件）。
 * 主进程的 `practice:record` 回的**就是写完之后那一整份**，把它换上，
 * 时序上就不存在"读到的比写过的旧"这条缝。
 *
 * 【为什么不做防抖保存、也不监听 beforeunload】
 * 别的 store 那么干是因为它们**在渲染层改数据**。练习史的数据是主进程写的，
 * 这里只有读 —— 抄一份保存逻辑过来只会多一条可能写坏文件的路径。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { PracticeFile, PracticeSession } from '../../../shared/types'

export const usePracticeStore = defineStore('practice', () => {
  const history = ref<PracticeSession[]>([])
  /** 读过了没有 —— 和 progress 的 `loaded` 同款：空数组和"还没读到"必须分得开 */
  const loaded = ref(false)

  async function load(): Promise<void> {
    try {
      const file = await window.miai.getPractice()
      history.value = file.history
    } catch {
      // 首次运行 / 读取失败：保持空历史。复习照样能开（权重全按"没练过"算），
      // 只是这一轮不那么"懂你"——不该因为读不到历史就不让人复习。
      history.value = []
    }
    loaded.value = true
  }

  /** 主进程刚写完的那一整份，直接换上（理由见抬头） */
  function adopt(file: PracticeFile): void {
    history.value = file.history
    loaded.value = true
  }

  return { history, loaded, load, adopt }
})
