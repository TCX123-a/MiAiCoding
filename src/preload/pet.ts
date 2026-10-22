/**
 * 大肥鱼桌宠专属的极小 preload —— `sandbox: true` 下的单文件
 * （多文件 require 在沙箱里不可用；这里 import 的共享常量是**构建期打进
 * 同一个 bundle** 的，运行期没有额外 require。同 splash.ts 的理由与坑）。
 *
 * 只暴露六件事：拉状态 / 做动作 / 聊天 / 上报命中区 / 收指令 / 收状态广播。
 * 宠物窗是本项目里**面积最大、活得最久、永远置顶**的窗口，权限最小化对它
 * 尤其重要 —— 它的面比主窗的 miai.* 还小一圈：没有文件、没有配置、没有 runner。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  PetAction,
  PetChatMessage,
  PetChatResult,
  PetCmd,
  PetHitRect,
  PetSnapshot
} from '../shared/pet'

const miaiPet = {
  /** 拉一次状态（推送可能在页面加载完成之前就发生过了，同 wallpaperStateGet 的缝） */
  init: (): Promise<PetSnapshot | null> => ipcRenderer.invoke(IPC.petInit),
  /** 做一个动作（喂饭/摸头/换模式/存位置…）。返回**动作之后**的快照，直接换上 */
  act: (action: PetAction): Promise<PetSnapshot> => ipcRenderer.invoke(IPC.petAct, action),
  /** 聊一句天。载荷含刚敲的那条 user 消息；失败也带回一句给人看的话 */
  chat: (messages: PetChatMessage[]): Promise<PetChatResult> =>
    ipcRenderer.invoke(IPC.petChat, messages),
  /**
   * 上报「哪些屏幕区域该接鼠标」（单向 send，fire-and-forget）。
   * 宠物一边走一边报，回执对它是死重量；语义是「最新值覆盖」，迟到的回执没有用。
   */
  hit: (rects: PetHitRect[]): void => {
    ipcRenderer.send(IPC.petHit, rects)
  },
  /** 收主进程的行为指令（说一句 / 走到报错处 / 开聊天 / 光标位置）。返回退订函数 */
  onCmd: (cb: (cmd: PetCmd) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, cmd: PetCmd): void => cb(cmd)
    ipcRenderer.on(IPC.petCmd, listener)
    return () => {
      ipcRenderer.removeListener(IPC.petCmd, listener)
    }
  },
  /**
   * 收状态广播（喂饭、发奖、模式、开关都广播一条）。返回退订函数。
   * 【契约】回调只收载荷，绝不把 IpcRendererEvent 泄给页面（同 onWallpaperState）。
   */
  onState: (cb: (s: PetSnapshot) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: PetSnapshot): void => cb(s)
    ipcRenderer.on(IPC.petState, listener)
    return () => {
      ipcRenderer.removeListener(IPC.petState, listener)
    }
  }
}

contextBridge.exposeInMainWorld('miaiPet', miaiPet)
export type MiaiPetApi = typeof miaiPet
