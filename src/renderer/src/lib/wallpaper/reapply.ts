/**
 * 「重新应用」请求 —— 设置页「壁纸属性」面板顶部按钮 → 壁纸层的手动同步通道。
 *
 * 【为什么是模块级单例】按钮在设置页组件树里，执行者（WallpaperLayer）在 App
 * 根部，两者互不可见；借一个只加不减的计数器当信号（同 play-state 的单例先例）。
 *
 * 【为什么是「请求」不是「结果」】按钮只负责说「我要重新应用」；真正做的事
 * （把全量属性重推给正在跑的场景实例；没有实例就重挂一次）由壁纸层按现场决定，
 * 成败也由它自己 toast —— 面板不猜结果（猜了就会撒谎）。最近一次的结果记在
 * 壁纸层的 snapshotStats.reapply 里，探针可回读。
 *
 * ⚠️ 本文件在 src/ 下、被文案闸门扫：字符串一律英文，中文只进注释。
 */
import { ref } from 'vue'

/** 只加不减；消费方 watch 数值变化，不解释数值本身 */
const reapplyTick = ref(0)

export const wallpaperReapply = { tick: reapplyTick }

export function requestWallpaperReapply(): void {
  reapplyTick.value += 1
}
