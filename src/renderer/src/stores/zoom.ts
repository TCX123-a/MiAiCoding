/**
 * 缩放 store：一个百分比，正文和代码共用同一个值。
 *
 * 【为什么落在 localStorage，而不是 config.json】
 * 铁律 6 说「改 AppConfig 结构必须 bump version + 写迁移」。往 config.json 里
 * 加一个 zoom 字段，就要动 types.ts / config-migrate.ts / config-merge.ts
 * 三处再补一份迁移，而那条路上任何一处写错，最坏的结果是**用户的学习进度被
 * 静默清零**。缩放只是个界面偏好，丢了顶多回到 100% —— 风险和收益完全不成比例。
 * 所以它单独存，用 `miai:zoom:v1` 这个**自带版本号**的钥匙：将来真要改存储格式，
 * 换成 v2 就行，不用去猜一个裸键里躺的是哪个年代的写法。
 *
 * 【为什么每一次读写都包着 try/catch】
 * 打包后渲染进程是 `file://` 起源，Chromium 对它的 localStorage 支持是
 * 「通常能用、但没有任何东西保证」。这里**不允许**因为一个界面偏好把整个应用
 * 卡在启动上：拿不到就地降级成「只在本进程有效」—— 功能照常，只是关掉软件后
 * 不记得上次调到了多少。这是刻意的取舍，不是漏了错误处理。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { normalizeZoom, stepZoom, zoomScale, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../../../shared/zoom'

/** 存储键自带版本号，理由见文件头 */
const STORAGE_KEY = 'miai:zoom:v1'

function readStored(): number {
  try {
    return normalizeZoom(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return ZOOM_DEFAULT
  }
}

function writeStored(percent: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(percent))
  } catch {
    // 存不下就算了，见文件头那段。这里**故意不 console.warn**：
    // 用户看不到控制台，而每次拖滑块都刷一条警告只会把真问题淹掉。
  }
}

export const useZoomStore = defineStore('zoom', () => {
  /** 用户看到的百分比（50 ~ 200 的整数） */
  const percent = ref(readStored())

  /** 同一个值的另一种写法：给 CSS 用的无单位倍数（0.5 ~ 2） */
  const scale = computed(() => zoomScale(percent.value))

  /** 落在下限上 —— 用来把「缩小」按钮置灰 */
  const atMin = computed(() => percent.value <= ZOOM_MIN)

  /** 落在上限上 —— 用来把「放大」按钮置灰 */
  const atMax = computed(() => percent.value >= ZOOM_MAX)

  /**
   * 设成某个百分比。所有入口（按钮、滑块、复位）都走这里，
   * 于是「钳位」只写了一处，不会有哪个入口漏掉。
   * 值没变就直接返回：滑块拖动时每一帧都会喊一次，没必要每次都写一遍硬盘。
   */
  function set(next: number): void {
    const v = normalizeZoom(next)
    if (v === percent.value) return
    percent.value = v
    writeStored(v)
  }

  return {
    percent,
    scale,
    atMin,
    atMax,
    set,
    bigger: () => set(stepZoom(percent.value, 1)),
    smaller: () => set(stepZoom(percent.value, -1)),
    reset: () => set(ZOOM_DEFAULT)
  }
})
