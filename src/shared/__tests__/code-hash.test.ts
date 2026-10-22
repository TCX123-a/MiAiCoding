/**
 * 代码指纹（shared/code-hash）的纯逻辑闸门。
 *
 * 【为什么值得单独钉】它是"跑通自己代码发大白饭"的**去重键**：渲染层（判定
 * "用户自己写的"后算指纹）与主进程（原生环境观察器对源文件算指纹）必须
 * 算出同一个串 —— 差一个字符，同一段代码就会被发两碗饭，而这件事在界面上
 * 完全看不出来（大白饭只是悄悄多了一碗）。
 *
 * 【归一化的边界就是承诺】只认两种"不算改过"：CRLF ↔ LF、**末尾**的空白
 * 与换行。行内多一个空格、多一行注释都必须是另一个指纹 —— 那些是"用户改过"
 * 的证据，抹平会把"改了一下再跑"折进"原样又跑一遍"，奖就发错了边。
 *
 * 【等长才考哈希】串长不同时，`长度36:哈希` 里的长度段天然分家；想验证哈希
 * 本身在干活，得挑**等长**的不同内容（下面标了"等长"的几条都是）。
 * 等长的两条若只在**最后一个字符**上不同，FNV-1a 的最后一步（先异或再乘
 * 奇数）保证结果必不相同 —— 这几条是数学保证，不是碰运气。
 */
import { describe, expect, it } from 'vitest'
import { codeFingerprint } from '../code-hash'

/** 输出形状：`长度(36进制):FNV(十六进制)`（pet.ts 的 RUN_FP_RE 是同一条） */
const FP_RE = /^[0-9a-z]{1,10}:[0-9a-f]{1,8}$/

describe('codeFingerprint：确定性', () => {
  it('同一段代码两次调用恒等（纯函数：不含时刻、不含随机）', () => {
    const code = 'const a = 1\nprint(a)'
    expect(codeFingerprint(code)).toBe(codeFingerprint(code))
    // 认的是**内容**不是来源：拼出来的串与字面量同串同指纹
    expect(codeFingerprint(['const a = 1', 'print(a)'].join('\n'))).toBe(codeFingerprint(code))
  })

  it('空串合法且稳定；全空白 = 空代码（末尾空白本来就无意义）', () => {
    expect(codeFingerprint('')).toBe(codeFingerprint(''))
    expect(codeFingerprint('')).toMatch(FP_RE)
    expect(codeFingerprint('   \n\t\n')).toBe(codeFingerprint(''))
  })
})

describe('codeFingerprint：归一化的边界（CRLF / 末尾空白）', () => {
  it('CRLF 与 LF 版相等（编辑器的换行风格不算"改了代码"）', () => {
    expect(codeFingerprint('a\r\nb\r\nc')).toBe(codeFingerprint('a\nb\nc'))
    expect(codeFingerprint('const x = 1;\r\n')).toBe(codeFingerprint('const x = 1;\n'))
  })

  it('末尾多换行 / 尾随空格 / 混合空白都相等（只 trimEnd）', () => {
    const base = 'line1\nline2'
    expect(codeFingerprint(base + '\n')).toBe(codeFingerprint(base))
    expect(codeFingerprint(base + '\n\n\n')).toBe(codeFingerprint(base))
    expect(codeFingerprint(base + '   ')).toBe(codeFingerprint(base))
    expect(codeFingerprint(base + ' \t\n ')).toBe(codeFingerprint(base))
    expect(codeFingerprint(base + '\r\n')).toBe(codeFingerprint(base)) // 先折 CRLF 再 trim
  })

  it('行首空白不算"末尾"：它是另一个指纹（归一化不是 trim()）', () => {
    // 长度段让"长度不同"必然分家，这条钉的是"行首空格没被顺手抹掉"
    expect(codeFingerprint('  a')).not.toBe(codeFingerprint('a'))
  })
})

describe('codeFingerprint：改过就得变（去重不许把不同代码混成一件）', () => {
  it('改一个字符 / 多一行注释 / 行内多一个空格 → 指纹都变', () => {
    expect(codeFingerprint('print(1)')).not.toBe(codeFingerprint('print(2)')) // 等长（8），只差末字符
    expect(codeFingerprint('a')).not.toBe(codeFingerprint('b')) // 等长（1）
    expect(codeFingerprint('print(1)')).not.toBe(codeFingerprint('print(1)\n// hi')) // 多一行注释
    expect(codeFingerprint('a = 1')).not.toBe(codeFingerprint('a  = 1')) // 行内多一个空格
  })

  it('长度段把"长度不同但哈希撞车"也隔开：36 → 36 进制 "10"', () => {
    expect(codeFingerprint('a')).not.toBe(codeFingerprint('ab'))
    expect(codeFingerprint('x'.repeat(36)).split(':')[0]).toBe('10')
    expect(codeFingerprint('abcd').split(':')[0]).toBe('4')
  })
})

describe('codeFingerprint：中文与输出形状', () => {
  it('中文内容稳定（两次调用相等），且与等长 ASCII 不同', () => {
    expect(codeFingerprint('你好')).toBe(codeFingerprint('你好'))
    // 等长（都是 2 个 UTF-16 单元）、只差末字符 —— FNV 保证分家
    expect(codeFingerprint('x你')).not.toBe(codeFingerprint('xa'))
    expect(codeFingerprint('打印(1)')).toBe(codeFingerprint('打印(1)'))
  })

  it('输出永远匹配 `长度(36进制):FNV(十六进制)` —— pet.ts 的 RUN_FP_RE 收的就是它', () => {
    const samples = [
      '', // 空串
      'a',
      'const x = 1\n', // 归一化后会变空尾巴
      '你好，世界',
      'x'.repeat(1000),
      'x'.repeat(200000), // 注释里写的代码上限量级：长度段仍 ≤ 10 位
      '\n\n\n',
      ' \t '
    ]
    for (const s of samples) {
      expect(codeFingerprint(s), `样本不该出格：${JSON.stringify(s)}`).toMatch(FP_RE)
    }
  })
})
