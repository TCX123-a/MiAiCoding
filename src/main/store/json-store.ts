/**
 * JSON 原子写存储（M3-04）：tmp + fsync + rename 原子写 + .bak 双副本。
 *
 * 读取分四种结果，**不再把所有异常揉成 null**：
 *   · ok       —— 正常解析
 *   · missing  —— 文件确实不存在（ENOENT），可以回退 .bak / 交给默认值
 *   · corrupt  —— 文件在、但 JSON 解析失败：先留一份 `.corrupt-<时间戳>` 副本，
 *                 再回退 .bak；坏档不再被下一次保存无声覆盖
 *   · io       —— 读失败但不是「不存在」（EACCES/EBUSY/EISDIR…）：
 *                 这是瞬时故障，**绝不能**拿旧 .bak 顶替最新档，也不能回写。
 *                 只记日志并返回 null，让这一次读取失败保持失败。
 *
 * 旧实现 `catch { return null }` 把 io 和 corrupt 都当成「没有档」：
 * 锁文件/杀软扫描时读到 null → 应用当成新档 → 下一次保存把好档覆盖掉。
 * 这条路径正是「学习记录莫名其妙清零」最像的根因。
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from 'fs'
import { join } from 'path'

export interface JsonStore<T> {
  read(): T | null
  write(data: T): void
}

type ReadOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'io'; message: string }

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    return code ? `${code}: ${err.message}` : err.message
  }
  return String(err)
}

function readOutcome<T>(path: string): ReadOutcome<T> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'io', message: describe(err) }
  }
  try {
    return { kind: 'ok', value: JSON.parse(raw) as T }
  } catch {
    return { kind: 'corrupt' }
  }
}

/** 把坏档留一份带时间戳的副本；副本写不出去也不能挡住读取 */
function quarantine(path: string): void {
  try {
    const dest = `${path}.corrupt-${Date.now()}`
    copyFileSync(path, dest)
    // Console logs stay ASCII: the copy gate scans all of src/ for Chinese
    // literals (comments are masked; log strings are not).
    console.error(`[json-store] cannot parse ${path}; kept a copy at ${dest}`)
  } catch (err) {
    console.error(`[json-store] cannot parse ${path}; quarantine copy failed: ${describe(err)}`)
  }
}

/**
 * 把 source 复制成 target；**大小不一致就认为复制失败**（磁盘满时
 * copyFileSync 可能留下半截文件），并删掉残留，绝不拿半截备份顶替旧备份。
 */
function copyExact(source: string, target: string): boolean {
  const tmp = target + '.tmp'
  try {
    copyFileSync(source, tmp)
    const sourceSize = statSync(source).size
    const copiedSize = statSync(tmp).size
    if (sourceSize !== copiedSize) {
      rmSync(tmp, { force: true })
      console.error(`[json-store] backup size mismatch (${sourceSize} -> ${copiedSize}); discarded this backup`)
      return false
    }
    renameSync(tmp, target)
    return true
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 清理失败不掩盖原始错误 */
    }
    console.error(`[json-store] backup ${target} failed: ${describe(err)}`)
    return false
  }
}

export function createJsonStore<T>(dir: string, name: string): JsonStore<T> {
  const file = join(dir, name)
  const bak = file + '.bak'
  const tmp = file + '.tmp'

  function read(): T | null {
    const fromMain = readOutcome<T>(file)
    if (fromMain.kind === 'ok') return fromMain.value

    // 瞬时读失败：不碰主档、不回退旧备份、不返回「新档」语义的空值之外的东西。
    // 返回 null 仍是现有调用方的契约（默认值兜底），但坏档与旧档都原样保留。
    if (fromMain.kind === 'io') {
      console.error(`[json-store] read ${file} failed (keeping original, not falling back to backup): ${fromMain.message}`)
      return null
    }
    if (fromMain.kind === 'corrupt') quarantine(file)

    const fromBak = readOutcome<T>(bak)
    if (fromBak.kind === 'ok') {
      // 主档损坏/缺失：把备份抢救回主档（内容随下次 write 落盘）。
      // 用 copyExact —— 抢救本身也不能留下半截主档。
      if (!copyExact(bak, file)) {
        console.error(`[json-store] failed to restore ${bak} into the main file; returning backup contents from memory only`)
      }
      return fromBak.value
    }
    if (fromBak.kind === 'corrupt') quarantine(bak)
    if (fromBak.kind === 'io') {
      console.error(`[json-store] reading backup ${bak} failed: ${fromBak.message}`)
    }
    return null
  }

  function write(data: T): void {
    mkdirSync(dir, { recursive: true })

    // tmp 先落盘 + fsync，再 rename：rename 只保证「名字切换」原子，
    // 不保证掉电后内容真的在盘上。fsync 这一下是给断电场景的。
    const text = JSON.stringify(data, null, 2)
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, text, 0, 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }

    // 旧主档 → .bak。备份复制失败时**保留旧 .bak**，不拿半截文件顶替。
    if (existsSync(file)) copyExact(file, bak)

    renameSync(tmp, file)
  }

  return { read, write }
}
