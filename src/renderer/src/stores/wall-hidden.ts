/**
 * 「显示隐藏项目」小开关 —— 壁纸隐藏功能（2026-10-06，主人点名的隐私需求）的
 * 视图侧一半。
 *
 * 【为什么落在 localStorage，不进 config.json】
 * 同 zoom.ts 的理由：它是**纯视图状态**（「我现在要不要看见被我藏起来的那些」），
 * 不是「隐藏了哪些」的事实 —— 后者才是 config（wallpaper.hidden，v16）。
 * 把视图开关也塞进 config 要动 schema/迁移/合并三处，而那条路上任何一处写错，
 * 最坏结果是用户的学习进度被静默清零；收益只是少一个 localStorage 键。
 * 键名自带版本号 `miai:wall-hidden:v1`（同 zoom 的口径）。
 *
 * 【默认 false = 藏起来】这是这个功能的全部意义：默认态下别人看屏幕看不到
 * 被隐藏的壁纸。要找回来 = 设置页把它拨开。
 *
 * 【读写全包 try/catch】打包后渲染进程是 file:// 起源，localStorage「通常能用、
 * 但没有任何东西保证」——拿不到就降级成「只在本进程有效」，绝不让一个视图
 * 开关把应用卡在启动上（同 zoom.ts）。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

/** 存储键自带版本号，理由见文件头 */
const STORAGE_KEY = 'miai:wall-hidden:v1'

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    // 存不下就算了，见文件头。故意不 warn：用户看不到控制台。
  }
}

export const useWallHiddenStore = defineStore('wall-hidden', () => {
  /** true = 把隐藏的条目也展示出来（列表与池子里以「已隐藏」标记现身） */
  const showHidden = ref(readStored())

  function setShowHidden(on: boolean): void {
    const v = !!on
    if (v === showHidden.value) return
    showHidden.value = v
    writeStored(v)
  }

  /** 切换并返回新值（给「小眼睛」类按钮用） */
  function toggleShowHidden(): boolean {
    setShowHidden(!showHidden.value)
    return showHidden.value
  }

  return { showHidden, setShowHidden, toggleShowHidden }
})
