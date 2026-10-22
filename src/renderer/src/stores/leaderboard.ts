/**
 * 排行榜 store（P10.6）：榜面数据的渲染层唯一状态面。
 *
 * 【它管什么、不管什么】
 *   · 管：五个榜期的快照（题行 + me 名次卡 + 榜期键 + 下一页游标）、拉取
 *     状态、opt-in 开关动作。
 *   · 不管：什么时候展示演示数据（那是视图对未登录态的事）、积分怎么算
 *     （服务端）、榜单缓存到磁盘（v1 不做 —— 快照活在内存里，重启即空，
 *     docs/26 §8.2 的「上次拉取的快照」以一次会话为界）。
 *
 * 【为什么快照按 period 分账】§8.2 的口径是「拉取失败显示上次快照 + 截至
 * 时间」。按 period 分账才不会出现「切到周榜、失败、桌上还摊着日榜的数」——
 * 把别的榜期的数字当这一期的读数，比空榜更坏（一个看着正常的假读数）。
 *
 * 【乱序守卫（seq）】同一 period 可能在飞多轮（重试连点 / 停一会儿再进来）。
 * 每轮领一个序号，落账前对一眼，旧轮的回话晚到就丢掉 —— 没有它，
 * 「第一次超时、重试成功、第一次的回话最后才到」会把成功结果覆盖掉；
 * 换账号时把所有序号推高一格，进行中的旧账号回话同样作废。
 *
 * 【me.optedIn 是账号级的】开关翻转时把所有榜期快照的 me 一次翻齐 ——
 * 它不属于某一个榜期，只有一份真值。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */
import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { LeaderboardEntry, LeaderboardResponse } from '../../../shared/cloud/dto'
import type { LeaderboardPeriod } from '../../../shared/cloud/protocol'
import { todayKey } from '../../../shared/dates'
import { useAccountStore } from './account'

/** 一个榜期最近一次**成功**拉取的结果（失败不动它 —— 它就是 §8.2 的"上次快照"） */
export interface BoardSnapshot {
  entries: LeaderboardEntry[]
  me: LeaderboardResponse['me']
  computedAt: string | null
  periodKey: string | null
  nextCursor: string | null
  /** 这一份快照的拉取时刻（ISO）——「没连上…截至 X」标注用它，不用 computedAt */
  fetchedAt: string
}

export const useLeaderboardStore = defineStore('leaderboard', () => {
  const account = useAccountStore()

  /** 键 = period；缺席 = 这个榜期还没有快照（界面据此出空态而不是假数据） */
  const boards = ref<Partial<Record<LeaderboardPeriod, BoardSnapshot>>>({})
  /** 在飞的**整轮**拉取（按榜期）—— 重试连点不与它叠请求 */
  const loading = ref<Partial<Record<LeaderboardPeriod, boolean>>>({})
  /** 最近一轮失败。快照仍在 = 界面显示「截至」标注；无快照 = FAIL_NONE 一行说明
   *  （V2-10：原文案配的「再试一次」按钮已删；load() 起点会先复位它 —— 在飞 ≠ 失败） */
  const failed = ref<Partial<Record<LeaderboardPeriod, boolean>>>({})
  /** 在飞的「加载更多」（同一时刻至多一条 —— 按钮同时禁用） */
  const moreLoading = ref(false)
  /** opt-in 开关在飞（开关同时禁用） */
  const optInBusy = ref(false)
  /** 每个榜期的轮次序号（非响应式：纯守卫，界面不读它）。落账前对一眼 */
  const seq: Partial<Record<LeaderboardPeriod, number>> = {}

  /**
   * 拉一个榜期（首次进入 / 重试 / 切回页签）。在飞时直接返回 —— 打到同一
   * 榜期的重复触发合并进在飞那一轮（手动重试只该在失败后出现，那时没在飞）。
   */
  async function load(period: LeaderboardPeriod): Promise<void> {
    if (loading.value[period]) return
    // V2-10（2026-10-16 主人裁定删「再试一次」按钮）：新的一轮起飞先把上一轮的
    // failed 清掉 —— 否则「拉失败之后再拉」的在飞窗口里，界面还钉在上次的失败态
    // （说明行不变、也没有任何转动的东西），根本看不出重拉有没有发生。清掉之后
    // 真值就是真值：在飞 = 不是失败（界面显示「正在拉榜…」），落了账再按结果说话。
    failed.value[period] = false
    seq[period] = (seq[period] ?? 0) + 1
    const mine = seq[period]
    loading.value[period] = true
    try {
      // dateKey 传本地日：只影响回话里的 me.scoreToday（UTC 日界 ±1 的
      // 服务端校验也是按它），日榜的 periodKey 由服务端自己锚（daily 缺省
      // = 刚结束的一天 —— 见服务端 leaderboard.ts，界面照实显示 periodKey）
      const res = await window.miai.cloud.leaderboard({ period, dateKey: todayKey() })
      if (seq[period] !== mine) return // 旧轮晚到 / 已换账号：丢掉不落账
      if (res.ok) {
        boards.value[period] = {
          entries: res.data.entries,
          me: res.data.me,
          computedAt: res.data.computedAt,
          periodKey: res.data.periodKey,
          nextCursor: res.data.nextCursor,
          fetchedAt: new Date().toISOString()
        }
        failed.value[period] = false
      } else {
        failed.value[period] = true // 快照（若有）原样留着 —— 就是 §8.2 的"上次快照"
      }
    } catch (err) {
      // IPC 抛 = 主进程 handler 的形状校验拦下了坏参数（我们自己的接线 bug）。
      // 界面照"这一轮没拿到"显示；出声把 bug 留在控制台，别让它装成网络问题
      console.warn('[miai] leaderboard load failed', err)
      if (seq[period] === mine) failed.value[period] = true
    } finally {
      if (seq[period] === mine) loading.value[period] = false
    }
  }

  /**
   * 追加下一页（快照的 nextCursor）。守卫三层：没有快照/没有下一页/已有
   * 在飞 —— 再加落账时的序号对眼（整轮重拉过就丢弃，避免往旧快照上接）。
   */
  async function loadMore(period: LeaderboardPeriod): Promise<void> {
    const snap = boards.value[period]
    if (!snap || snap.nextCursor === null || moreLoading.value) return
    const cursor = snap.nextCursor
    const mine = seq[period] ?? 0
    moreLoading.value = true
    try {
      const res = await window.miai.cloud.leaderboard({ period, dateKey: todayKey(), cursor })
      const cur = boards.value[period]
      if ((seq[period] ?? 0) !== mine || !cur || cur.nextCursor !== cursor) return
      if (res.ok) {
        boards.value[period] = {
          ...cur,
          entries: [...cur.entries, ...res.data.entries],
          me: res.data.me, // me 每页都新鲜，跟随
          computedAt: res.data.computedAt,
          periodKey: res.data.periodKey,
          nextCursor: res.data.nextCursor,
          fetchedAt: new Date().toISOString()
        }
        failed.value[period] = false
      } else {
        failed.value[period] = true // 已显示的行不动；nextCursor 未变，再点一次即重试
      }
    } catch (err) {
      console.warn('[miai] leaderboard loadMore failed', err)
      if ((seq[period] ?? 0) === mine) failed.value[period] = true
    } finally {
      moreLoading.value = false
    }
  }

  /**
   * 翻转榜面曝光开关。返回是否**服务端确认**成功 —— 界面据此决定要不要
   * 弹「没改成功」。成功时按服务端回话的值（幂等写口，回什么记什么）
   * 把所有榜期快照的 me.optedIn 一次翻齐。
   */
  async function setOptIn(next: boolean): Promise<boolean> {
    if (optInBusy.value) return false
    optInBusy.value = true
    try {
      const res = await window.miai.cloud.leaderboardOptIn({ optIn: next })
      if (!res.ok) return false
      for (const key of Object.keys(boards.value) as LeaderboardPeriod[]) {
        const b = boards.value[key]
        if (b) boards.value[key] = { ...b, me: { ...b.me, optedIn: res.data.optIn } }
      }
      return true
    } catch (err) {
      console.warn('[miai] leaderboard opt-in failed', err)
      return false
    } finally {
      optInBusy.value = false
    }
  }

  /**
   * 换账号（登录/登出/换号）→ 快照全清、在飞作废。me 卡里是**账号级**读数：
   * 不清就是拿上一个人的名次端给下一个人。清完由界面按新状态重新拉。
   * （不必等 account.state 先就绪：null→有 也是"变了"，照清 —— 空清无害。）
   */
  watch(
    () => account.state?.accountId ?? null,
    (now, prev) => {
      if (now === prev) return
      boards.value = {}
      loading.value = {}
      failed.value = {}
      moreLoading.value = false
      for (const k of Object.keys(seq) as LeaderboardPeriod[]) seq[k] = (seq[k] ?? 0) + 1
    }
  )

  /**
   * 资料变了（改昵称/换头像，2026-10-22）→ 快照全清、在飞作废。
   * 榜面行里的 username/avatarHash 是服务端上一次快照 JOIN 出来的值；不清掉，
   * 用户刚改完名字回到榜面会先看到旧名字 —— 那正是这次改动要消灭的体验。
   * 清完由视图按 profileVersion 重拉（服务端下一次 JOIN 就是新资料）。
   */
  watch(
    () => account.profileVersion,
    () => {
      boards.value = {}
      loading.value = {}
      failed.value = {}
      moreLoading.value = false
      for (const k of Object.keys(seq) as LeaderboardPeriod[]) seq[k] = (seq[k] ?? 0) + 1
    }
  )

  return {
    boards,
    loading,
    failed,
    moreLoading,
    optInBusy,
    load,
    loadMore,
    setOptIn
  }
})
