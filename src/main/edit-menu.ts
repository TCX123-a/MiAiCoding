/**
 * 主窗右键编辑菜单（v7 模块六，2026-10-31）。
 *
 * 【它解决的是什么】编辑器里的 Ctrl+C / Ctrl+V 一直是浏览器原生行为（没坏），
 * 但**右键点不出任何东西** —— 整个应用没有一处 context-menu 处理器。
 * 用户（尤其是刚学电脑的人）习惯了右键，点了没反应会以为「复制粘贴坏了」。
 *
 * 【为什么放在主进程】渲染层要做右键菜单得自己画一层 DOM 浮层，还要处理
 * 点外面关闭、键盘导航、跟随主题、窗口缩放……；而 Electron 的原生菜单
 * 一行 popup 就够，且 cut/copy/paste/selectAll 走的是 Chromium 的编辑命令，
 * **选区与焦点都不用我们自己保存/恢复**。这两件事自己实现都容易出错。
 *
 * 【为什么是纯函数】菜单长什么样（有哪些项、哪项灰着）是可以单测的；
 * `Menu.buildFromTemplate` + `popup` 那一步才需要 Electron 运行时。
 * 把判定挤进 app.ts 的话，这一整张状态表就一条都测不了 —— 同 run-result-view 的理由。
 *
 * 【只挂在主窗】桌宠是独立窗口（pet/index.ts），那里没有可编辑区域，
 * 给它弹一个「粘贴」只会让人困惑。
 */
import type { MenuItemConstructorOptions } from 'electron'
import { EDIT_MENU } from '../shared/copy'

/** `webContents` 的 `context-menu` 事件里我们真正用到的字段（便于测试造夹具） */
export interface ContextMenuParamsLike {
  /** 右键位置是不是可编辑区域（输入框、CodeMirror 的 contenteditable…） */
  isEditable: boolean
  /** 当前选中的文字；非编辑区靠它决定「复制」出不出现 */
  selectionText: string
  /**
   * Chromium 给的编辑能力判定。**只有明确 false 才置灰**：
   * 缺字段（老版本 Electron / 测试夹具没给）时交给 role 自己判断，
   * 不能默认灰掉 —— 那会让「撤销/粘贴」在能用的时候也点不动。
   */
  editFlags?: {
    canUndo?: boolean
    canRedo?: boolean
    canCut?: boolean
    canCopy?: boolean
    canPaste?: boolean
    canSelectAll?: boolean
  }
}

/** 明确 false 才禁用；undefined/true 都交给原生 role 自己判断 */
const enabledUnlessFalse = (flag: boolean | undefined): boolean => flag !== false

const separator: MenuItemConstructorOptions = { type: 'separator' }

/**
 * 按右键位置生成菜单模板。返回空数组 = **这次不该弹菜单**
 * （非编辑区又没有选中文字）—— 调用方据此跳过 popup，
 * 而不是弹一个空菜单或只有一条灰项的菜单。
 */
export function buildEditMenuTemplate(params: ContextMenuParamsLike): MenuItemConstructorOptions[] {
  const flags = params.editFlags ?? {}

  if (params.isEditable) {
    return [
      { role: 'undo', label: EDIT_MENU.UNDO, enabled: enabledUnlessFalse(flags.canUndo) },
      { role: 'redo', label: EDIT_MENU.REDO, enabled: enabledUnlessFalse(flags.canRedo) },
      separator,
      { role: 'cut', label: EDIT_MENU.CUT, enabled: enabledUnlessFalse(flags.canCut) },
      { role: 'copy', label: EDIT_MENU.COPY, enabled: enabledUnlessFalse(flags.canCopy) },
      { role: 'paste', label: EDIT_MENU.PASTE, enabled: enabledUnlessFalse(flags.canPaste) },
      separator,
      { role: 'selectAll', label: EDIT_MENU.SELECT_ALL, enabled: enabledUnlessFalse(flags.canSelectAll) }
    ]
  }

  // 非编辑区：只有「选中了一段文字」才有可做的事。空白选区弹菜单是噪音。
  if (params.selectionText.trim().length > 0) {
    return [{ role: 'copy', label: EDIT_MENU.COPY, enabled: true }]
  }
  return []
}
