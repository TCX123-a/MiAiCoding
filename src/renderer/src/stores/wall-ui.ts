/**
 * 壁纸 UI 通透度 store：两个百分比（面板不透明度 / 画布遮罩）+ 一个面板底色
 * 覆盖色 × 两个主题（2026-10-07 加取色器后不再只是「两个百分比」）。
 *
 * 【为什么落在 localStorage，而不是 config.json】
 * 同 stores/zoom.ts 那份论证：加 config 字段要动 types / migrate / merge 三处
 * 再补迁移，最坏风险是学习进度静默清零，而这只几个界面偏好。且存 localStorage
 * 意味着它**不穿服务器同步那条线** —— 本次修复的红线就是「不碰同步模块」。
 * 钥匙 `miai:wall-ui:v1` 自带版本号；加 panelColor 字段不需要升版本
 * （旧数据 normalize 后补 null、旧版本读新字段会忽略，双向兼容）。
 *
 * 【为什么每一次读写都包着 try/catch】
 * 打包后渲染进程是 `file://` 起源，Chromium 对它的 localStorage 支持是
 * 「通常能用、但没有任何东西保证」。这里**不允许**因为几个界面偏好把应用卡在
 * 启动上：拿不到就地降级成「只在本进程有效」。这是刻意的取舍，不是漏了错误处理。
 *
 * 【为什么 patch 是整个对象换新，不是就地改】
 * ① normalizeWallUi 整树新造，写回和来源不共享子对象（同 zoom 的纪律）；
 * ② 对象换新后 main.ts 那条 watch 不需要 deep 也能被触发；
 * ③ 值没变直接 return —— 滑杆拖动时每帧喊一次，没必要每帧写一遍盘。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  normalizeWallUi,
  type WallGlassConfig,
  type WallUiConfig,
  type WallUiPerTheme
} from '../../../shared/wall-ui'
import type { MiThemeName } from '../../../shared/types'

/** 存储键自带版本号，理由见文件头 */
const STORAGE_KEY = 'miai:wall-ui:v1'

function readStored(): WallUiConfig {
  try {
    return normalizeWallUi(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    // JSON.parse 抛错（存着半截垃圾）和 localStorage 不可用走同一条路：出厂默认。
    return normalizeWallUi(null)
  }
}

function writeStored(config: WallUiConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 存不下就算了，见文件头。**故意不 console.warn**：用户看不到控制台，
    // 而每次拖滑块都刷一条警告只会把真问题淹掉（同 zoom store）。
  }
}

export const useWallUiStore = defineStore('wallUi', () => {
  const config = ref<WallUiConfig>(readStored())

  /**
   * 改**某一个主题**的那一份。三个入口（面板不透明度滑杆、画布遮罩滑杆、
   * 面板底色取色器）都走这里，于是「钳位/净化 + 写盘 + 没变不写」只写了一处，
   * 没有入口会漏。
   *
   * ⚠️ 下面那个「值没变直接 return」的相等判断**必须把三个字段全比到**：
   * 曾经它只比 panelAlpha 与 veil 两个 —— 那时确实只有这两个字段；加了
   * panelColor 之后若忘了把它补进来，只改颜色（另两项没变）会被这条判断
   * 静默吞掉：界面看着变了（内存里 config 换了新对象）？不 —— return 在了
   * config.value = merged 之前，连内存都没换，表现是「选了色、什么都没发生」。
   * 这是那种不报错、不见日志的坏法，所以三个字段排排坐，一个都不能少。
   */
  function patch(theme: MiThemeName, part: Partial<WallUiPerTheme>): void {
    const merged = normalizeWallUi({ ...config.value, [theme]: { ...config.value[theme], ...part } })
    const before = config.value[theme]
    const after = merged[theme]
    if (
      after.panelAlpha === before.panelAlpha &&
      after.veil === before.veil &&
      after.panelColor === before.panelColor
    )
      return
    config.value = merged
    writeStored(merged)
  }

  /**
   * 设置**当前主题**的面板底色覆盖（2026-10-07 取色器）。传 null = 清除覆盖，
   * 回到主题自带色。命名与 patch 同一套风格；净化/写盘全在 patch 里，不另开路径。
   */
  function setPanelColor(theme: MiThemeName, color: string | null): void {
    patch(theme, { panelColor: color })
  }

  /**
   * 改**液态玻璃**那一组（2026-10-08）。不分主题 —— 见 shared/wall-ui.ts 里
   * WallGlassConfig 头注释（几何与动力学和明暗无关，硬拆两份会让「白天调好的
   * 手感切到夜里就变」）。
   *
   * ⚠️ 这里的相等判断**必须把六个字段全比到**（同上面 patch 那段教训）：
   * 少比一个，只改那一个字段时会被静默吞掉 —— 表现是「拖了滑杆、什么都没发生」。
   * 前五个是数字、最后一个是布尔，逐个写出来，不用 Object.keys 之类绕圈子的写法
   * （将来加字段时漏掉的概率反而更高）。
   */
  function patchGlass(part: Partial<WallGlassConfig>): void {
    const merged = normalizeWallUi({ ...config.value, glass: { ...config.value.glass, ...part } })
    const before = config.value.glass
    const after = merged.glass
    if (
      after.refract === before.refract &&
      after.strength === before.strength &&
      after.ring === before.ring &&
      after.blur === before.blur &&
      after.flow === before.flow &&
      after.shadow === before.shadow
    )
      return
    config.value = merged
    writeStored(merged)
  }

  return { config, patch, setPanelColor, patchGlass }
})
