/**
 * 开屏页专属的极小 preload —— `sandbox: true` 下的单文件（多文件 require
 * 在沙箱里不可用；这里 import 的共享常量是**构建期打进同一个 bundle** 的，
 * 运行期没有额外 require）。
 *
 * 只暴露四件事：上报播放事件 / 拉播放配置 / 收渐隐指令 / 收 hold 指令。
 * 开屏页只是一个放视频的页面，不给它任何别的面 —— 权限最小化是那个
 * 窗口（透明、置顶、全屏大）唯一需要的安全属性。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { SplashPageEvent, SplashPagePayload } from '../shared/splash'

const miaiSplash = {
  /** 上报播放事件（fire-and-forget；主进程按 sender 校验来源） */
  report: (ev: SplashPageEvent): void => {
    ipcRenderer.send(IPC.splashEvent, ev)
  },
  /** 拉播放配置；来源校验不通过时主进程回 null（页面据此自报 error 收场） */
  getConfig: (): Promise<SplashPagePayload | null> => ipcRenderer.invoke(IPC.splashGet),
  /** 渐隐指令（页面收到后挂 fade-out class）。返回退订函数 */
  onFade: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.splashFade, listener)
    return () => {
      ipcRenderer.removeListener(IPC.splashFade, listener)
    }
  },
  /** 「主窗还没就绪」指令（页面把跳过提示切成「正在准备界面」）。返回退订函数 */
  onHold: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.splashHold, listener)
    return () => {
      ipcRenderer.removeListener(IPC.splashHold, listener)
    }
  }
}

contextBridge.exposeInMainWorld('miaiSplash', miaiSplash)
export type MiaiSplashApi = typeof miaiSplash
