/**
 * 本地 IDE 的「画像」表 —— 每个程序该按什么编码写文件、适合打开哪些语言，
 * 全项目**唯一真源**（2026-10-01 随 config v9 建立）。
 *
 * 【为什么要有这张表】主人验收时实测：C/C++ 用 Dev-C++ 打开正常、Java/Python
 * 在上面乱码；换成 VS Code 又反过来。病灶是**编码按语言定死**（c/cpp 写 GBK、
 * java/python 写 UTF-8），而不同程序按不同编码读文件 —— 任何一个固定 IDE
 * 都会乱一半。从这一版起：① 写盘编码跟随**打开它的那个程序**；
 * ② 每门语言各自推荐最合适的程序（见 IDE_PRIORITY）。
 *
 * 【这张表被谁读】
 *   · 主进程写盘前定编码（main/runner/native-ide.ts 的 encodingForIdePath）；
 *   · 配置 v8→v9 迁移（shared/config-migrate.ts）——旧单值按产品名分发；
 *   · 渲染进程「打开时按语言推荐」的排序（renderer/src/lib/ide-detect.ts）。
 * 三处读同一份表，改一行三处一起变 —— 这是把编码收敛到一张表的全部价值。
 *
 * 【为什么 exe 名表搬来 shared（原来在 main/runner/detect-ide.ts）】
 * v9 迁移在 shared 侧也要认「exe 名 → 产品名」；shared 不能依赖 main。
 * 所以 IDE_EXE_NAMES 与 ideNameOf 搬到这里，detect-ide.ts 反向 import。
 *
 * ⚠️ 本文件在 `src/` 下、被 copy.test 的文案闸门扫：**字符串一律英文
 *    （产品名保持 ASCII 原文）**，中文只出现在注释里。
 */
import type { IdeCandidate, LangOfCode } from './types'

/**
 * 认得的 IDE 本体：exe 文件名（小写）→ 产品名。
 *
 * 【为什么用白名单而不是「.exe 都算」】快捷方式扫描会翻出开始菜单里
 * 上百个 .lnk（Office、网易云、卸载器……），不设白名单就会把整台机器
 * 装过的每个程序都列进「你的 IDE」里。白名单同时兼作三个层的统一判据：
 * ① 按 basename 认常见路径；② 按 target 的 basename 认快捷方式；
 * ③ 按 key 名认 App Paths（App Paths 的 key 名就是 exe 名）。
 *
 * 收录标准 = 「学校里真会拿来教 C/C++/Java/Python 的编辑器或 IDE」。
 * 显示名保持产品原文（ASCII），文案纪律见 copy.test.ts。
 */
export const IDE_EXE_NAMES: Record<string, string> = {
  'devcpp.exe': 'Dev-C++',
  'code.exe': 'Visual Studio Code',
  'vscodium.exe': 'VSCodium',
  'cursor.exe': 'Cursor',
  'thonny.exe': 'Thonny',
  'pycharm.exe': 'PyCharm',
  'pycharm64.exe': 'PyCharm',
  'idea64.exe': 'IntelliJ IDEA',
  'clion64.exe': 'CLion',
  'eclipse.exe': 'Eclipse',
  'devenv.exe': 'Visual Studio'
}

/**
 * 取路径的最后一段。**刻意不 import node:path** —— 本文件会被渲染进程
 * 打进 bundle，那边没有 node 内置模块。我们只需要「最后一段」这一个语义，
 * 顺手也兜住 `\` 与 `/` 混写的路径。
 */
function fileNameOf(p: string): string {
  const m = /[^\\/]+$/.exec(p)
  return m ? m[0] : p
}

/** 认一个 exe 路径是不是白名单里的 IDE；是 → 返回产品名 */
export function ideNameOf(exePath: string): string | undefined {
  return IDE_EXE_NAMES[fileNameOf(exePath).toLowerCase()]
}

/**
 * 写盘编码。`gbk` = 按系统 ANSI（中文 Windows 上的 GBK/MS936）读无 BOM 文件的
 * 那一族；`utf8` = 默认按 UTF-8 读的那一族。（带 BOM 的花样不掺和：我们的
 * 文件从不写 BOM，两边行为都稳定。）
 */
export type IdeEncoding = 'gbk' | 'utf8'

export interface IdeProfile {
  encoding: IdeEncoding
  langs: readonly LangOfCode[]
}

/**
 * 每个产品的画像。**收录依据写在条目旁**，没实测依据的（Eclipse）标注清楚 ——
 * 存疑了就改这一行，三处读它的人全跟着变。
 */
export const IDE_PRODUCTS: Record<string, IdeProfile> = {
  // 主人实测（2026-10-01，本机 TDM-GCC 4.9.2 版）：按系统 ANSI 读源文件，
  // UTF-8 无 BOM 的中文在它编辑器里是「浣犲ソ」型乱码。
  'Dev-C++': { encoding: 'gbk', langs: ['c', 'cpp'] },
  // VS Code 系默认 UTF-8（也认 BOM），无乱码实测。
  'Visual Studio Code': { encoding: 'utf8', langs: ['c', 'cpp', 'java', 'python'] },
  'VSCodium': { encoding: 'utf8', langs: ['c', 'cpp', 'java', 'python'] },
  'Cursor': { encoding: 'utf8', langs: ['c', 'cpp', 'java', 'python'] },
  // JetBrains 系与 Python 系工具默认 UTF-8。
  'Thonny': { encoding: 'utf8', langs: ['python'] },
  'PyCharm': { encoding: 'utf8', langs: ['python'] },
  'IntelliJ IDEA': { encoding: 'utf8', langs: ['java'] },
  'CLion': { encoding: 'utf8', langs: ['c', 'cpp'] },
  // ⚠️ 全表最没实测依据的一条：Eclipse 工作区编码跟随系统区域
  // （中文 Windows 默认 MS936≈GBK），但用户在首选项里改过就不作数。
  // 真踩到就改这一行。
  'Eclipse': { encoding: 'gbk', langs: ['java'] },
  // 完整版 Visual Studio：无 BOM 的文件按系统 ANSI 读，GBK 才不乱码。
  'Visual Studio': { encoding: 'gbk', langs: ['c', 'cpp'] }
}

/**
 * 「通用编辑器」：什么语言都能打开。正因为它通用，v8→v9 迁移对它们
 * **不锁槽位**（清空成「自动」）—— 旧版那个单值只是一枚"没有语言信息"的
 * 选择，让它退位给按语言推荐；而推荐表里它们永远在列（装什么用什么），
 * 轮到该用它们的时候自然会被选中，行为不会丢。
 */
export const UNIVERSAL_IDE_PRODUCTS: readonly string[] = [
  'Visual Studio Code',
  'VSCodium',
  'Cursor'
]

/** c 与 cpp 共用一份优先序（两门语言的生态是同一个） */
const C_PRIORITY: readonly string[] = [
  'Dev-C++',
  'CLion',
  'Visual Studio',
  'Visual Studio Code',
  'VSCodium',
  'Cursor'
]

/**
 * 每门语言的推荐优先级：**越靠前越推荐**。
 *
 * 【排序口径】专用工具（编译器-IDE 一体）排在通用编辑器前面 ——
 * 这正是主人要的「按语言推荐相应编译器」；但通用编辑器永远在列，
 * 机器上装着什么就用什么，不会推空。
 */
export const IDE_PRIORITY: Record<LangOfCode, readonly string[]> = {
  c: C_PRIORITY,
  cpp: C_PRIORITY,
  java: ['IntelliJ IDEA', 'Eclipse', 'Visual Studio Code', 'VSCodium', 'Cursor'],
  python: ['PyCharm', 'Thonny', 'Visual Studio Code', 'VSCodium', 'Cursor']
}

/** 这个产品适合打开这门语言吗（在它的推荐表里就算） */
export function isSuitable(product: string, lang: LangOfCode): boolean {
  return IDE_PRIORITY[lang].includes(product)
}

/** 优先级位置（越小越推荐）；不在表里 → Infinity（"不适合"，排到最后） */
export function rankOf(lang: LangOfCode, product: string): number {
  const i = IDE_PRIORITY[lang].indexOf(product)
  return i === -1 ? Number.POSITIVE_INFINITY : i
}

/**
 * 把候选分成「适合这门语言的（按优先级排）」与「其余的（保原序）」。
 *
 * 【为什么保原序】`others` 只在「一个合适的都没有」时才被摆出来 ——
 * 那种局面下我们没有任何排序依据，照探测结果的顺序（known → shortcut →
 * registry）摆着就好（同 detect-ide 里 dedupe 的「先到的层赢」）。
 * `Array.prototype.sort` 自 ES2019 起保证稳定，同 rank（同一产品装了两份）
 * 也会保住原序 —— 那正是「平手」判定的前提。
 */
export function orderCandidates(
  lang: LangOfCode,
  candidates: readonly IdeCandidate[]
): { suitable: IdeCandidate[]; others: IdeCandidate[] } {
  const suitable: IdeCandidate[] = []
  const others: IdeCandidate[] = []
  for (const c of candidates) (isSuitable(c.name, lang) ? suitable : others).push(c)
  suitable.sort((a, b) => rankOf(lang, a.name) - rankOf(lang, b.name))
  return { suitable, others }
}

/** 产品的写盘编码；认不出的产品 → undefined（由调用方走按语言回退） */
export function encodingOfProduct(product: string | undefined): IdeEncoding | undefined {
  return product ? IDE_PRODUCTS[product]?.encoding : undefined
}

/**
 * 没有产品画像时的回退编码 = v9 之前的按语言规则（c/cpp→gbk，其余 utf8）。
 * 用在两处：路径指向白名单外的程序（用户自己挑的 exe）；导出时该语言
 * 还没配程序。选了这条就**和升级前的行为逐字节一致**，不比现在差。
 */
export function defaultEncodingOf(lang: LangOfCode): IdeEncoding {
  return lang === 'c' || lang === 'cpp' ? 'gbk' : 'utf8'
}
