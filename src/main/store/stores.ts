/**
 * 盒装存储（P10.1）：在 `createJsonStore` 外面套一层**跟盒走**的路由。
 *
 * 【盒内 / 盒外】六个文件**跟人走**（进盒）：profile / wrongbook / favorites /
 * practice / challenge / memo。三个文件**跟设备走**（不进盒，仍由 app.ts
 * 直接 createJsonStore）：config（含 apiKey 等设备级设置）、ai-cache
 * （本机算过的缓存，同步它没有意义）、pet.json（桌宠状态，docs/26 拍板
 * 「继续是设备显示状态」）。device.json 也不是盒内文件 —— 它是**设备的**
 * 身份证，一个设备一份，跟着盒搬家才是错的。
 *
 * 【为什么是代理层而不是改 json-store】`createJsonStore` 在**创建时**就把
 * dir/name 收进闭包 —— 这是它「目录由调用方注入、可被单测」的立身之本，
 * 不该为了盒去改它。代理层按 dir 缓存底层实例：切盒之后再切回来，
 * 拿到的是同一个实例（.bak / .tmp 的行为与今天逐字节一致）。
 *
 * 【BoxedStore 相对 JsonStore 新增的四样】`write(data, stamp?)` 的条件写
 * （校验 epoch **与 rev**，见 box.ts）、`stamp()`（给上层转发给渲染层用）、
 * `dir()`（同步引擎 P10.3 要按盒目录直接读写 .sync/state.json 等旁路文件）、
 * 以及 `Stores.queues` —— per-doc 串行写队列（本地写协议三件套之③，
 * docs/21 §8.2）：同一份文档的一切「读→改→写」都从它过。
 *
 * 【queues 为什么挂在这里】一份文档的写者不止一个（渲染层保存、主进程
 * 差量写、同步引擎合并写回），它们共同的交汇点就是这套 stores —— 队列挂在
 * Stores 上，「进同一队列」就是拿着 stores 的人自然做对的事，而不是各自
 * 记得去 import 同一条链。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import type {
  ChallengeRecord,
  FavoritesFile,
  MemoFile,
  PracticeFile,
  UserProfile,
  WrongBookFile
} from '../../shared/types'
import { createStoreBox, StaleEpochError, StaleRevError, type BoxStamp, type StoreBox } from './box'
import { createKeyedQueue, type KeyedQueue } from './doc-queue'
import { createJsonStore, type JsonStore } from './json-store'

/** 六个盒内文档（跟人走的文件）—— 写队列按它分键 */
export type StoreKey = 'profile' | 'wrongbook' | 'favorites' | 'practice' | 'challenge' | 'memo'

/**
 * 盒内文件名（createStores 与收编流程 account-flow 共用**同一份**）：
 * 收编要绕过盒直接按目录读写两侧的档案，文件名必须与这里逐字节一致 ——
 * 抄一份到别处，名字一改就是「收编读了不存在的档、静默当空处理」。
 */
export const STORE_FILES: Record<StoreKey, string> = {
  profile: 'profile.json',
  wrongbook: 'wrongbook.json',
  favorites: 'favorites.json',
  practice: 'practice.json',
  challenge: 'challenge.json',
  memo: 'memo.json'
}

/** JsonStore 的盒装版：read/write 都打到**当前盒**，write 可带条件写戳 */
export interface BoxedStore<T> extends JsonStore<T> {
  /**
   * 写当前盒。给了 `stamp` 就校验 `{epoch, rev}`（对不上抛 StaleEpochError /
   * StaleRevError，一个字节不写）；不带戳的写落到当前盒（老调用方的路径）。
   */
  write(data: T, stamp?: BoxStamp): void
  /** 当前写入代（`{epoch, rev}`）—— 随下一次写口响应交给渲染层保管 */
  stamp(): BoxStamp
  /** 当前盒里这个文件的目录（现读） */
  dir(): string
}

export interface Stores {
  box: StoreBox
  /** per-doc 串行写队列（见文件头）：同一份文档的读→改→写都排它 */
  queues: KeyedQueue<StoreKey>
  profile: BoxedStore<UserProfile>
  wrongbook: BoxedStore<WrongBookFile>
  favorites: BoxedStore<FavoritesFile>
  practice: BoxedStore<PracticeFile>
  challenge: BoxedStore<ChallengeRecord>
  memo: BoxedStore<MemoFile>
}

function boxedStore<T>(box: StoreBox, name: string): BoxedStore<T> {
  const cache = new Map<string, JsonStore<T>>()
  // rev 按**这个 BoxedStore 实例**单调（不是按盒、也不落盘）：它标示的是
  // 「本进程里这个文件的第几次写」，用来让写者察觉"我基于的版本旧了"。
  // 进程重启后从 0 重来是已知的、可接受的（干涸协议会在重登/切换时让在途
  // 写作废，不依赖跨进程记忆）。
  let rev = 0

  function storeFor(dir: string): JsonStore<T> {
    let s = cache.get(dir)
    if (!s) {
      s = createJsonStore<T>(dir, name)
      cache.set(dir, s)
    }
    return s
  }

  return {
    read: () => storeFor(box.currentDir()).read(),
    write(data: T, stamp?: BoxStamp): void {
      if (stamp !== undefined) {
        if (stamp.epoch !== box.epoch()) {
          // 屏障一：这次写是在**另一个盒**里发起的（切换发生在 IPC 往返途中）。
          // 拒掉、一个字节不写 —— 上层（P10.5 起的 handler）负责回话让渲染层重新加载。
          throw new StaleEpochError(stamp.epoch, box.epoch())
        }
        if (stamp.rev !== rev) {
          // 屏障二（P10.3 起消费）：同盒内，这次写依据的版本已被后来的写甩掉
          // —— 写下去就是拿旧快照覆盖新数据（旧 rev 的写一律拒）。
          throw new StaleRevError(stamp.rev, rev)
        }
      }
      // 校验通过后 dir 只取一次：write 是同步的，中途不可能再切盒
      storeFor(box.currentDir()).write(data)
      rev++
    },
    stamp: () => ({ epoch: box.epoch(), rev }),
    dir: () => box.currentDir()
  }
}

/**
 * 建一整套盒装存储。`baseDir` = 数据目录（storageDir()）——
 * 客人盒就是它本身，账号盒在 `<baseDir>/accounts/<accountId>/`。
 */
export function createStores(baseDir: string): Stores {
  const box = createStoreBox(baseDir)
  return {
    box,
    queues: createKeyedQueue<StoreKey>(),
    profile: boxedStore<UserProfile>(box, STORE_FILES.profile),
    wrongbook: boxedStore<WrongBookFile>(box, STORE_FILES.wrongbook),
    favorites: boxedStore<FavoritesFile>(box, STORE_FILES.favorites),
    practice: boxedStore<PracticeFile>(box, STORE_FILES.practice),
    challenge: boxedStore<ChallengeRecord>(box, STORE_FILES.challenge),
    memo: boxedStore<MemoFile>(box, STORE_FILES.memo)
  }
}
