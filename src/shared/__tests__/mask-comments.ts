/**
 * 测试用的源码预处理：把注释剥掉。**给闸门共用，不是给生产代码用的。**
 *
 * 【为什么它得是共用的】
 * 这个仓库的闸门大多是「读源码文本 + 正则匹配」，而本仓库的注释里
 * 为了讲清规则，写了**大量和代码长得一模一样的示例**。不剥注释的话，
 * 每一条闸门都会被自己的说明文字绊倒，而且报出来的错还指向错误的方向
 * （说「你把通道名写死了」，其实那只是注释里的一句说明）。
 *
 * 这个函数原本长在 copy.test.ts 里。AI 接线闸门（ipc-wiring.test.ts）
 * 也踩了同一个坑之后，与其复制一份等着两边漂移，不如让它只有一个定义。
 */

/**
 * 把注释（块 / 行 / HTML）替换成等长空格，**保留换行**。
 *
 * 为什么要「等长空格」而不是直接删掉：删掉会让后面所有字符往前挪，
 * 算出来的行号全错。替换成空格则偏移量分毫不变，行号天然准确。
 * 为什么必须去注释：本仓库的注释里为了讲清规则写了大量中文示例
 * （比如 copy.ts 头部、本文件），不剥掉会把注释当代码报出来。
 */
export function maskComments(src: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  const state = { block: false, html: false }

  const maskLine = (line: string): string => {
    let out = ''
    let i = 0
    while (i < line.length) {
      if (state.block) {
        const e = line.indexOf('*/', i)
        if (e === -1) return out + blank(line.slice(i))
        out += blank(line.slice(i, e + 2))
        i = e + 2
        state.block = false
        continue
      }
      if (state.html) {
        const e = line.indexOf('-->', i)
        if (e === -1) return out + blank(line.slice(i))
        out += blank(line.slice(i, e + 3))
        i = e + 3
        state.html = false
        continue
      }
      const b = line.indexOf('/*', i)
      const h = line.indexOf('<!--', i)
      const lRaw = line.indexOf('//', i)
      // `lesson://` `https://` 里的 // 前面是冒号，不算注释起始
      const l = lRaw > 0 && line[lRaw - 1] === ':' ? -1 : lRaw

      const cands: [number, string][] = []
      if (b !== -1) cands.push([b, 'block'])
      if (h !== -1) cands.push([h, 'html'])
      if (l !== -1) cands.push([l, 'line'])
      if (cands.length === 0) return out + line.slice(i)

      cands.sort((x, y) => x[0] - y[0])
      const [pos, kind] = cands[0]
      out += line.slice(i, pos)
      if (kind === 'line') return out + blank(line.slice(pos))
      if (kind === 'block') {
        state.block = true
        i = pos + 2
      } else {
        state.html = true
        i = pos + 4
      }
    }
    return out
  }

  return src.split('\n').map(maskLine).join('\n')
}
