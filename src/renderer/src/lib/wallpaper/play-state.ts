/**
 * 手动暂停 —— 会话态，**不落盘**（与 config 里那些「偏好」不同）。
 *
 * 【为什么是模块级单例】两个消费方要看到同一个值：壁纸层（据此真的停视频 /
 * 停视差）和设置页的当前壁纸卡（按钮文案「暂停 / 播放」）。放进组件里的话，
 * 设置页得自己再存一份，两边就会漂。
 *
 * 【为什么不持久化】「暂停」是对眼前这张壁纸的临时动作（省电 / 专心写代码），
 * 不是一条要跟到下次开机的偏好。持久化它的话，用户某天暂停过，从此每次开
 * 应用壁纸都静止 —— 而他没有再按过任何按钮，只会觉得「壁纸坏了」。
 * 换壁纸 / 关掉再开启壁纸时自动解除（见 resetManualPause 的调用点），
 * 语义保持「暂停只作用在它被按下的那一张上」。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：**字符串一律英文**，中文只出现在注释里。
 */
import { ref } from 'vue'

/** true = 用户手动按了暂停（叠加在 derivePause 的原生原因之外） */
const manualPaused = ref(false)

export const wallpaperPlayState = { manualPaused }

export function setManualPause(v: boolean): void {
  manualPaused.value = !!v
}

export function toggleManualPause(): void {
  manualPaused.value = !manualPaused.value
}

/** 换壁纸 / 关壁纸时把「手动暂停」解除（调用点在壁纸层的 watcher 里） */
export function resetManualPause(): void {
  manualPaused.value = false
}
