/**
 * 轻量 toast 服务（MiToast.vue 的渲染源）。
 * 用法：toast('文本喵～', 'success')
 *
 * 【可选动作（2026-09-29）】软删除这类「做了但五秒内能反悔」的操作要一枚
 * 撤销按钮 —— 第四个参数就是它。**动作只在 toast 还活着的时候有效**：
 * 计时器到点后 item 被摘掉，点不到了，撤销窗口自然关闭，
 * 不需要在动作里再判一次「是不是过期了」。
 */
import { reactive } from 'vue'

export type ToastType = 'info' | 'success' | 'error' | 'warn'

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastItem {
  id: number
  text: string
  type: ToastType
  action?: ToastAction
}

export const toasts = reactive<ToastItem[]>([])

let seq = 0

/** 立刻收起一条（有动作的 toast 点完动作就调它，不等自然过期） */
export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id)
  if (i !== -1) toasts.splice(i, 1)
}

export function toast(
  text: string,
  type: ToastType = 'info',
  duration = 2600,
  action?: ToastAction
): number {
  const id = ++seq
  toasts.push({ id, text, type, ...(action ? { action } : {}) })
  setTimeout(() => dismissToast(id), duration)
  return id
}
