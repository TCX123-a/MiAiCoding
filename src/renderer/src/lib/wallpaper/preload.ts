/**
 * 「预热这张场景壁纸」的意图总线 —— 选择壁纸弹窗（悬停）→ 壁纸层（执行）的
 * 请求通道（2026-10-07 深夜，Bug1「切换卡顿」修复的接线层）。
 *
 * 【为什么是模块级单例】悬停发生在弹窗组件树里，执行者（WallpaperLayer）在
 * App 根部，两者互不可见；借一个 ref 当信号（同 reapply.ts / play-state 的先例）。
 *
 * 【为什么是「意图」不是「命令」】弹窗只负责说「用户在这条上停留了」；挂不挂
 * （门控：正在换片 / 已暂停 / 壁纸关着 / 就是当前活动项都不挂）、挂什么形态
 * （非活动槽、--pending 隐身、首帧后暂停）、什么时候收尸，全由壁纸层按现场
 * 决定 —— 弹窗不猜结果。跑起来之后的现场状态记在 WallpaperLayer 的
 * snapshotStats.preload 里，探针可回读。
 *
 * 生命周期约定（两侧共同维护，改动前先读墙纸层「场景预热」节）：
 *  · request(item)：悬停停留过 dwell 后调用；连续请求以最后一次为准（单热身槽）。
 *  · drop()：弹窗关闭**且这次关闭不是「选中了预热条目」**时调用；「选中」引起
 *    的关闭不 drop —— 那条热身要留给换片流水线原地转正（弹窗侧按选中 id 与
 *    意图 id 比对后决定，见 WallpaperPickerModal 的 onPick）。
 *
 * ⚠️ 本文件在 src/ 下、被文案闸门扫：字符串一律英文，中文只进注释。
 */
import { ref } from 'vue'
import type { WallpaperItem } from '../../../../shared/wallpaper'

export interface WallpaperPreloadIntent {
  item: WallpaperItem
  /** 请求时刻（Date.now()），仅排查用 */
  at: number
}

/** 最新一次意图；null = 没有意图（壁纸层收到 null 会把热身实例一起收掉） */
const intent = ref<WallpaperPreloadIntent | null>(null)

export const wallpaperPreload = {
  intent,
  /** 请求预热（幂等：同一条目已在热身时壁纸层不会再挂一份） */
  request(item: WallpaperItem): void {
    intent.value = { item, at: Date.now() }
  },
  /** 撤销意图（关弹窗 / 选中了别的条目） */
  drop(): void {
    intent.value = null
  }
}
