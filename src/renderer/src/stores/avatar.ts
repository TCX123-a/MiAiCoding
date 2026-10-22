/**
 * 头像图片缓存 store（2026-10-22 用户系统批次）。
 *
 * 【它管什么】把「服务端头像 hash」变成可显示的 data URL，并在渲染层做缓存：
 *   · hash 是内容寻址的（sha256(图片字节)），同一个 hash 的图永不改变 ——
 *     缓存无需失效，换头像 = 换 hash，自然是一张新图；
 *   · 一次 IPC 批量取（主进程 `cloud:get-avatars` 并发 4、按 hash 缓存），
 *     界面上一页几十个人不会变成几十次串行往返；
 *   · 拉不到（断网/未登录/限流）**不报错、不占位**：调用方拿不到 URL 就用
 *     默认大肥鱼头像兜底（失败即值，缺一张图不该让榜面报错）。
 *
 * 【为什么要去重 + 合批】榜单页一次渲染 50 行，每行一个 UserAvatar 组件，
 * watch 各自请求同一个 hash 的情况很多（me 也在榜上）。requested 集合把
 * 「已排队/已取到」的 hash 挡住，microtask 合批把同帧的请求并成一次 IPC。
 *
 * 【重试】批量失败后，hash 进 missing 并挂一个 60s 计时器；到点把 missing
 * 清空并 bump tick —— UserAvatar 的 watchEffect 依赖 tick，会重新请求。
 * 断网恢复后头像自己回来，不需要用户重启应用。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { AVATAR_HASH_RE } from '../../../shared/cloud/protocol'

/** 失败后多久允许再试（毫秒） */
const RETRY_DELAY_MS = 60_000

export const useAvatarStore = defineStore('avatar', () => {
  /** hash → data URL（已取到的图） */
  const images = ref<Record<string, string>>({})
  /** 每次「可以重试了」自增；UserAvatar 依赖它重新发起请求 */
  const tick = ref(0)

  /** 已排队或在飞或已取到、本次会话不再重复请求的 hash */
  const requested = new Set<string>()
  /** 上一次批量里没拿到的 hash（等重试窗口） */
  const missing = new Set<string>()
  /**
   * 服务端确认永久不存在的 hash（NOT_FOUND）。内容寻址的图不会自己回来，
   * 重试只会每 60s 白打一轮账号额度 —— 记住它，本次会话不再请求。
   * 不放进 images（srcOf 仍回 null = 默认大肥鱼头像）。
   */
  const dead = new Set<string>()
  let queue: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function schedule(): void {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, 16)
  }

  async function flush(): Promise<void> {
    const batch = queue
    queue = []
    if (batch.length === 0) return
    let got: { images: Record<string, string>; dead: string[] }
    try {
      got = await window.miai.cloud.getAvatars(batch)
    } catch (err) {
      // IPC 抛 = 我们自己的接线 bug（载荷形状）或主进程崩 —— 当作这一批没拿到，
      // 控制台留证据，界面继续用默认头像（不弹错误：头像不是主流程）
      console.warn('[miai] avatar batch failed', err)
      got = { images: {}, dead: [] }
    }
    // 容错：老/坏的主进程若还回光秃秃的 Record，也按「全没拿到」处理（重试），
    // 绝不把它当 dead —— 宁可多试一轮，也不把可恢复的图判死。
    const gotImages = got !== null && typeof got === 'object' ? got.images : undefined
    const gotDead = got !== null && typeof got === 'object' && Array.isArray(got.dead) ? got.dead : []
    const deadSet = new Set(gotDead)
    for (const hash of batch) {
      const url = gotImages?.[hash]
      if (typeof url === 'string' && url.startsWith('data:image/')) {
        images.value[hash] = url
        missing.delete(hash)
        dead.delete(hash)
        requested.add(hash)
      } else if (deadSet.has(hash)) {
        // 永久 404：记死，不再重试；requested 留着 = 连排队都不用了
        dead.add(hash)
        missing.delete(hash)
        requested.add(hash)
      } else {
        // 允许以后重试：从 requested 拿掉，等 retry 窗口到了再放行
        requested.delete(hash)
        missing.add(hash)
      }
    }
    if (missing.size > 0 && retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        missing.clear()
        tick.value += 1
      }, RETRY_DELAY_MS)
    }
  }

  /**
   * 请求一批 hash 的图片。幂等：已取到/已排队的直接忽略。
   * 调用方可以在每次渲染/每次 hash 变化时无条件调用。
   */
  function request(hashes: ReadonlyArray<string | null | undefined>): void {
    let added = false
    for (const hash of hashes) {
      if (typeof hash !== 'string' || !AVATAR_HASH_RE.test(hash)) continue
      // missing：上一次没取到，重试窗口（60s）没到之前不再放行 —— 否则断网/
      // 限流时界面上每次重渲染都会再打一发，把 120 次/分钟的账号额度打光。
      if (
        images.value[hash] !== undefined ||
        requested.has(hash) ||
        missing.has(hash) ||
        dead.has(hash)
      ) {
        continue
      }
      requested.add(hash)
      queue.push(hash)
      added = true
    }
    if (added) schedule()
  }

  /** 上传成功后把本地裁好的图直接记进来 —— 本人立刻看到新头像，不等下一次往返 */
  function remember(hash: string, dataUrl: string): void {
    if (!AVATAR_HASH_RE.test(hash)) return
    images.value[hash] = dataUrl
    requested.add(hash)
    missing.delete(hash)
    dead.delete(hash)
  }

  /** 已取到的 data URL；null = 还没取到/取不到（调用方渲染默认头像） */
  function srcOf(hash: string | null | undefined): string | null {
    if (typeof hash !== 'string') return null
    return images.value[hash] ?? null
  }

  /**
   * 立刻放行所有「等重试窗口」的 hash（2026-10-22 夜间自查）。
   * 登录/注册成功后调用：登录前以未登录态拉过榜时，所有头像都被记进 missing，
   * 登录那一刻不放开的话，用户最多要盯着默认头像等 60 秒 —— 与「排行榜拉取时
   * 必须立刻显示新头像」相抵触。清 missing + bump tick，UserAvatar 会马上重发。
   */
  function retryNow(): void {
    if (missing.size === 0) return
    missing.clear()
    tick.value += 1
  }

  return { images, tick, request, remember, srcOf, retryNow }
})
