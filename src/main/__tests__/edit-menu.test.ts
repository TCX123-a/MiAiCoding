/**
 * 主窗右键编辑菜单（v7 模块六，2026-10-31）。
 *
 * 这里钉的是**判定表**，不是 Electron 的菜单渲染：
 *   · 可编辑区必须给全 cut/copy/paste（这三项有一个漏了，用户就以为功能坏了）；
 *   · editFlags 明确 false 的项要灰，缺字段时**不许默认灰**（否则能用的项点不动）；
 *   · 非编辑区只在有选中文字时给「复制」，且绝不能出现剪切/粘贴
 *     （对着一段正文右键点「粘贴」什么也不会发生，只会让人以为应用坏了）；
 *   · 没选字的非编辑区返回空模板 —— 调用方据此不弹菜单。
 */
import { describe, expect, it } from 'vitest'
import { EDIT_MENU } from '../../shared/copy'
import { buildEditMenuTemplate, type ContextMenuParamsLike } from '../edit-menu'

/** 把模板压成「角色/分隔线」序列，方便一眼看出结构 */
const shape = (t: ReturnType<typeof buildEditMenuTemplate>): string[] =>
  t.map((i) => (i.type === 'separator' ? 'separator' : String(i.role)))

const editable = (over: Partial<ContextMenuParamsLike> = {}): ContextMenuParamsLike => ({
  isEditable: true,
  selectionText: '',
  ...over
})

describe('buildEditMenuTemplate：可编辑区', () => {
  it('完整的编辑菜单，顺序固定（撤销/重做｜剪切/复制/粘贴｜全选）', () => {
    const t = buildEditMenuTemplate(editable())
    expect(shape(t)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll'
    ])
  })

  it('显示文字全部走 EDIT_MENU（不是 role 自动填的那套）', () => {
    const t = buildEditMenuTemplate(editable())
    const labels = t.filter((i) => i.type !== 'separator').map((i) => i.label)
    expect(labels).toEqual([
      EDIT_MENU.UNDO,
      EDIT_MENU.REDO,
      EDIT_MENU.CUT,
      EDIT_MENU.COPY,
      EDIT_MENU.PASTE,
      EDIT_MENU.SELECT_ALL
    ])
  })

  it('editFlags 明确 false 的项置灰，true 的项可用', () => {
    const t = buildEditMenuTemplate(
      editable({
        editFlags: {
          canUndo: false,
          canRedo: true,
          canCut: false,
          canCopy: true,
          canPaste: false,
          canSelectAll: true
        }
      })
    )
    const byRole = new Map(t.filter((i) => i.role).map((i) => [String(i.role), i.enabled]))
    expect(byRole.get('undo')).toBe(false)
    expect(byRole.get('redo')).toBe(true)
    expect(byRole.get('cut')).toBe(false)
    expect(byRole.get('copy')).toBe(true)
    expect(byRole.get('paste')).toBe(false)
    expect(byRole.get('selectAll')).toBe(true)
  })

  it('★ 缺 editFlags 时不许把任何项默认灰掉（能用的项必须点得动）', () => {
    for (const item of buildEditMenuTemplate(editable())) {
      if (item.type === 'separator') continue
      expect(item.enabled, `${String(item.role)} 被默认禁用了`).not.toBe(false)
    }
  })
})

describe('buildEditMenuTemplate：非编辑区', () => {
  it('选中了一段文字 → 只给「复制」', () => {
    const t = buildEditMenuTemplate({ isEditable: false, selectionText: 'System.out.println' })
    expect(shape(t)).toEqual(['copy'])
    expect(t[0].label).toBe(EDIT_MENU.COPY)
    expect(t[0].enabled).toBe(true)
  })

  it('★ 非编辑区永远不出现剪切/粘贴（点不动的项 = 让人以为应用坏了）', () => {
    const t = buildEditMenuTemplate({ isEditable: false, selectionText: '一段正文' })
    const roles = shape(t)
    expect(roles).not.toContain('cut')
    expect(roles).not.toContain('paste')
    expect(roles).not.toContain('selectAll')
  })

  it('没选字 / 只选中空白 → 空模板（调用方不弹菜单）', () => {
    expect(buildEditMenuTemplate({ isEditable: false, selectionText: '' })).toEqual([])
    expect(buildEditMenuTemplate({ isEditable: false, selectionText: '   \r\n\t ' })).toEqual([])
  })
})
