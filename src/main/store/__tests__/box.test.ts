/**
 * StoreBox 与盒装存储（src/main/store/box.ts + stores.ts）
 *
 * 【这个文件在守什么】
 *   1. **epoch 屏障**：一次保存请求（IPC 往返）可能在切盒**之后**才到达主进程。
 *      拿旧戳的写必须被拒（StaleEpochError），而且**一个字节都不写**。
 *      这条防的是「A 账号界面里攒的保存写进 B 账号的盒」—— 数据没错、位置错了，
 *      没有任何地方会报错的那种事故。
 *   2. **穿越拒且状态不变**：`switchTo('../..')` 抛了之后盒必须还在原地。
 *      半途改状态的话，「拒了一个坏 id」会顺带把当前账号踢成半个别的盒。
 *   3. **客人盒 = 数据目录本身**：老档案物理不搬家（收编红线最便宜的落实）。
 *   4. **rev 过期即拒**（P10.3 起消费）：同盒内拿旧 rev 的写抛 StaleRevError、
 *      一个字节不写 —— 旧快照覆盖新数据是「同步引擎刚并进来的数据被吞掉」
 *      的路径；rev 不因切盒清零（它标的是本进程第几次写）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UserProfile } from '../../../shared/types'
import { createStoreBox, StaleEpochError, StaleRevError } from '../box'
import { createStores } from '../stores'

const UUID = '3f2a6c14-9d5b-4e7a-8c01-2b3d4e5f6a70'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-box-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function guestFile(): string {
  return join(dir, 'profile.json')
}
function accountFile(id: string): string {
  return join(dir, 'accounts', id, 'profile.json')
}
function readTag(path: string): unknown {
  return (JSON.parse(readFileSync(path, 'utf-8')) as { tag?: unknown }).tag
}

/** 落盘的东西只需要能 JSON 往返 —— 形状校验不在这层（那是各 merge 文件的活） */
const data = (tag: string): UserProfile => ({ tag }) as unknown as UserProfile

// ---------------------------------------------------------------- 目录路由

describe('createStoreBox：目录路由', () => {
  it('初始是客人盒：目录 = baseDir 本身，accountId null，epoch 0', () => {
    const box = createStoreBox(join('fake', 'base'))
    expect(box.currentAccountId()).toBeNull()
    expect(box.currentDir()).toBe(join('fake', 'base'))
    expect(box.epoch()).toBe(0)
  })

  it('切到账号 → accounts/<id>/；切回 null → baseDir；epoch 每次 +1', () => {
    const box = createStoreBox(join('fake', 'base'))
    box.switchTo(UUID)
    expect(box.currentAccountId()).toBe(UUID)
    expect(box.currentDir()).toBe(join('fake', 'base', 'accounts', UUID))
    expect(box.epoch()).toBe(1)
    box.switchTo(null)
    expect(box.currentDir()).toBe(join('fake', 'base'))
    expect(box.epoch()).toBe(2)
  })

  it('★ 切到**同一个账号**也 +1（重登让在途旧请求作废，保守方向）', () => {
    // 「变了才加」会漏掉一个真实场景：重登同一个账号后，在途的旧保存
    // 依据的同步状态（令牌轮换、干涸协议重跑）可能已经作废
    const box = createStoreBox(join('fake', 'base'))
    box.switchTo(UUID)
    const before = box.epoch()
    box.switchTo(UUID)
    expect(box.epoch()).toBe(before + 1)
  })

  it('大小写归一：大写 UUID 落进小写目录（同一个账号不许有两套档案）', () => {
    const box = createStoreBox(join('fake', 'base'))
    box.switchTo(UUID.toUpperCase())
    expect(box.currentAccountId()).toBe(UUID)
    expect(box.currentDir()).toBe(join('fake', 'base', 'accounts', UUID))
  })
})

describe('createStoreBox：穿越与坏 id', () => {
  it('★ switchTo 拒绝穿越 id，且**状态一点不动**（含 epoch）；拒过之后照常能切', () => {
    const box = createStoreBox(join('fake', 'base'))
    expect(() => box.switchTo('../../evil')).toThrow(TypeError)
    expect(box.currentAccountId()).toBeNull()
    expect(box.currentDir()).toBe(join('fake', 'base'))
    expect(box.epoch()).toBe(0) // 被拒的那次不许留下任何痕迹
    expect(() => box.switchTo(42 as unknown as string)).toThrow(TypeError)
    expect(box.epoch()).toBe(0)
    // 失败没留半个状态：紧接着一次合法切换一切正常
    box.switchTo(UUID)
    expect(box.epoch()).toBe(1)
    expect(box.currentDir()).toBe(join('fake', 'base', 'accounts', UUID))
  })
})

// ---------------------------------------------------------------- 错误类

describe('StaleEpochError：身份可辨认', () => {
  it('名字与消息点名两个 epoch（排查时看得出撞的是哪一版）', () => {
    // 做成具名类而不是普通 Error，是为了让 handler 能把它和「磁盘写失败」
    // 分开处置 —— 混成一类的话，在途请求撞上切换会被当成 IO 故障重试，
    // 而重试只会一次次撞在同一条屏障上
    const err = new StaleEpochError(3, 5)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('StaleEpochError')
    expect(err.message).toBe('stale epoch: write was stamped 3, box is now at 5')
  })
})

describe('StaleRevError：身份可辨认', () => {
  it('名字与消息点名两个 rev（同盒之内的旧版本写）', () => {
    const err = new StaleRevError(0, 2)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('StaleRevError')
    expect(err.message).toBe('stale rev: write was based on rev 0, file is now at rev 2')
  })
})

// ---------------------------------------------------------------- 条件写

describe('BoxedStore：epoch 屏障落到文件上', () => {
  it('★ 旧 epoch 的写被拒，且**一个字节都不写**（账号目录连文件都不出现）', () => {
    const stores = createStores(dir)
    stores.profile.write(data('guest'))
    const stale = stores.profile.stamp() // {epoch:0, rev:1} —— 切盒前那一刻的戳
    stores.box.switchTo(UUID)
    expect(() => stores.profile.write(data('accident'), stale)).toThrow(StaleEpochError)
    // 拒 = 真的没写：账号盒里没文件，客人盒里的内容原样
    expect(existsSync(accountFile(UUID))).toBe(false)
    expect(readTag(guestFile())).toBe('guest')
  })

  it('戳对得上 → 写进当前的盒；切回客人盒读到的还是各自盒里的内容', () => {
    const stores = createStores(dir)
    stores.profile.write(data('guest'))
    stores.box.switchTo(UUID)
    expect(stores.profile.dir()).toBe(join(dir, 'accounts', UUID))
    stores.profile.write(data('account'), stores.profile.stamp())
    expect(readTag(accountFile(UUID))).toBe('account')
    stores.box.switchTo(null)
    expect(stores.profile.dir()).toBe(dir)
    expect((stores.profile.read() as unknown as { tag?: unknown }).tag).toBe('guest')
    expect(readTag(guestFile())).toBe('guest') // 账号盒那次写没漏进客人盒
  })

  it('不带戳的写（现有调用方的路径）落到当前盒，不受屏障影响', () => {
    const stores = createStores(dir)
    stores.box.switchTo(UUID)
    stores.profile.write(data('nostamp'))
    expect(readTag(accountFile(UUID))).toBe('nostamp')
    expect(existsSync(guestFile())).toBe(false)
  })

  it('★ rev 过期即拒（P10.3 消费）：旧 rev 的写抛 StaleRevError 且一个字节不写；换当前戳就成', () => {
    const stores = createStores(dir)
    expect(stores.profile.stamp()).toEqual({ epoch: 0, rev: 0 })
    stores.profile.write(data('a'))
    expect(stores.profile.stamp()).toEqual({ epoch: 0, rev: 1 })
    stores.box.switchTo(UUID)
    stores.profile.write(data('b'), stores.profile.stamp())
    expect(stores.profile.stamp()).toEqual({ epoch: 1, rev: 2 })
    stores.box.switchTo(null)
    expect(stores.profile.stamp()).toEqual({ epoch: 2, rev: 2 })
    // 旧 rev（0）的写：拒 —— 它依据的版本已经被两次写甩掉了
    expect(() => stores.profile.write(data('c'), { epoch: 2, rev: 0 })).toThrow(StaleRevError)
    expect(readTag(guestFile())).toBe('a') // 一个字节都没写
    expect(stores.profile.stamp()).toEqual({ epoch: 2, rev: 2 }) // 被拒的写不计数
    // 同样的写，戳换成当前的：成
    stores.profile.write(data('c'), stores.profile.stamp())
    expect(readTag(guestFile())).toBe('c')
    expect(stores.profile.stamp()).toEqual({ epoch: 2, rev: 3 })
  })
})
