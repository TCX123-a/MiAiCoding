/**
 * JSON 原子写存储（M3-04）：tmp + rename 原子写 + .bak 双副本。
 * 读取：主文件损坏自动回退 .bak（并抢救回主文件）；两者皆无返回 null，由调用方用默认值兜底。
 * 纯 Node 实现（不依赖 electron），目录由调用方注入 —— 可被 Vitest 直接测。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface JsonStore<T> {
  read(): T | null
  write(data: T): void
}

function tryRead<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null // 不存在 / JSON 损坏
  }
}

export function createJsonStore<T>(dir: string, name: string): JsonStore<T> {
  const file = join(dir, name)
  const bak = file + '.bak'
  const tmp = file + '.tmp'

  function read(): T | null {
    const fromMain = tryRead<T>(file)
    if (fromMain !== null) return fromMain
    const fromBak = tryRead<T>(bak)
    if (fromBak !== null) {
      // 主文件损坏：把备份抢救回主文件（内容随下次 write 落盘）
      try {
        copyFileSync(bak, file)
      } catch {
        /* 抢救失败不阻塞读取 */
      }
      return fromBak
    }
    return null
  }

  function write(data: T): void {
    mkdirSync(dir, { recursive: true })
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    if (existsSync(file)) {
      try {
        copyFileSync(file, bak) // 先备份旧主文件，再原子替换
      } catch {
        /* 备份失败不阻塞写入 */
      }
    }
    renameSync(tmp, file)
  }

  return { read, write }
}
