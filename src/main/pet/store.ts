/**
 * pet.json 的读写漏斗（2026-10-06，大肥鱼桌宠）。
 *
 * 【为什么要单独一个文件，不直接在控制器里 read/write】和 readConfig() 同一个
 * 理由：**给这份文件一个唯一的读口**。桌宠状态每次读出来都必须过
 * normalizePetState（磁盘上是手改过的 JSON、缺字段的老文件、断电写坏的半截），
 * 读口一散，总有一条路径会把脏数据原样信以为真 —— 那种 bug 不报错，
 * 只是桌宠的饱食度突然变成 NaN 或者位置瞬移到屏幕外。
 *
 * 【写失败不抛】save() 被心跳定时器调用：那里抛出去就是一个 uncaught
 * exception（定时器回调没人接），为了"盘满/没权限"把整个应用带崩不值。
 * 落盘失败如实记一行日志，内存里那份状态照常用 —— 下次改动会再试。
 */
import { createJsonStore } from '../store/json-store'
import { normalizePetState, type PetState } from '../../shared/pet'

export interface PetStore {
  /** 读 + 清洗。文件不存在 / 坏掉都会拿到一份合法的默认状态（created 告诉调用方） */
  load(nowIso: string): { state: PetState; created: boolean }
  /** 落盘。失败返回 false（已记日志），调用方无需处理 */
  save(state: PetState): boolean
}

export function createPetStore(dir: string): PetStore {
  const store = createJsonStore<PetState>(dir, 'pet.json')
  return {
    load(nowIso: string): { state: PetState; created: boolean } {
      const raw = store.read()
      return { state: normalizePetState(raw, nowIso), created: raw === null }
    },
    save(state: PetState): boolean {
      try {
        store.write(state)
        return true
      } catch (err) {
        console.error('[pet] save pet.json failed:', err)
        return false
      }
    }
  }
}
