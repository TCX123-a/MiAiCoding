/**
 * AI 侧栏对话的**渲染层状态**（P1，docs/27 §6.2 / §9.1）。
 *
 * 【它只存两样东西：消息列表 + "这一句在飞"】Key、上下文原文、提示词都不在这里：
 *   · **Key** 从头到尾没进过渲染进程（主进程只给 `hasKey: boolean`）；
 *   · **上下文**每次发送时**现取**（编辑器里此刻的代码 / 此刻的选区）——
 *     存一份快照就一定会和屏幕上那份不同步，而不同步的代价是"它答的是上一版代码"，
 *     用户完全看不出来；
 *   · **提示词**在主进程拼（`main/ai/chat.ts` + `shared/copy.ts`）。
 *
 * 【流式增量为什么要批量刷】每个 token 一次 Vue 更新 = 一秒几十次重渲染，
 * 长回答时整页会掉帧（编辑器滚动都跟着卡）。这里把增量攒在 `pendingText` 里，
 * 一帧拼一次（`requestAnimationFrame`，node 下退化成 setTimeout）。
 *
 * 【为什么订阅在 store 里挂一次，而不是组件 onMounted 挂】
 * 组件会因为收起/展开、切页反复卸载重建；每挂一次就多一串幽灵监听器
 * （每个都在对着已销毁的闭包写状态）。store 活得比组件久，挂一次、退订一次。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AiChatContext,
  AiChatMessage,
  AiChatStartInput,
  AiFailReason
} from '../../../shared/types'
import { AI_FAIL } from '../lib/copy'
import { toIpc } from '../lib/ipc-safe'

/**
 * 看门狗时长：主进程首字闸是 20s，这里多给 5s 余量。
 * 到点还没收到任何增量 = 事件丢了（IPC 断了），兜底收场而不是永远"正在输入"。
 */
const WATCHDOG_MS = 25_000

/** 一帧刷一次；没有 rAF 的环境（node 单测 / 极端情况）退化成 16ms 定时器 */
function schedule(fn: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn)
  return setTimeout(fn, 16) as unknown as number
}

export const useAiChatStore = defineStore('aiChat', () => {
  /** 会话消息（user / assistant 交替；assistant 那条在流式期间是"正在长的那条"） */
  const messages = ref<AiChatMessage[]>([])
  /** 正在等/收这一句 */
  const streaming = ref(false)
  /** 在飞那一条的 id。**只有它的事件才算数** —— 迟到的旧事件不许改当前这条 */
  const requestId = ref<string | null>(null)
  /** 输入框草稿（放 store 里是因为切换页面回来不该丢字） */
  const draft = ref('')
  /** 最后一条失败的人话（AI_FAIL 翻出来的）。成功时清空 */
  const failText = ref<string | null>(null)
  /**
   * 失败的技术细节（HTTP 码、异常 message）。**不是给用户看的文案**，
   * 但必须能看见 —— "点了没反应/说不清为什么"这一整类问题，全靠这一行定位。
   * 界面上挂在一行小灰字里（`排查用：`），不弹窗、不打断。
   */
  const failDetail = ref<string | null>(null)

  /** 看门狗计时器（见 armWatchdog） */
  let watchTimer: ReturnType<typeof setTimeout> | null = null

  /** 历史读过了没有（只读一次；clear 之后不要再被"重新读"覆盖） */
  let loaded = false
  /** 订阅只挂一次（见文件头） */
  let attached = false
  let offDelta: (() => void) | null = null
  let offDone: (() => void) | null = null

  /** 攒着还没刷进界面的增量 */
  let pendingText = ''
  let frame: number | null = null

  const hasMessages = computed(() => messages.value.some((m) => m.content.trim() !== ''))

  /** 把攒的增量并进最后一条 assistant 消息 */
  function flush(): void {
    frame = null
    if (pendingText === '') return
    const last = messages.value[messages.value.length - 1]
    if (!last || last.role !== 'assistant') {
      // 结构上不该发生（发送时一定先 push 占位）；真发生了就丢弃，
      // 而不是凭空造一条"没人问的回答"
      pendingText = ''
      return
    }
    last.content += pendingText
    pendingText = ''
  }

  function scheduleFlush(): void {
    if (frame !== null) return
    frame = schedule(flush)
  }

  /** 取消已排的那一帧（收尾时必须先刷干净，否则最后几个字会丢） */
  function flushNow(): void {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    flush()
  }

  /**
   * 挂上两条推送订阅。**幂等**：重复调用不会挂第二份。
   *
   * 【契约照抄 onWallpaperState】回调只收载荷、返回退订函数；
   * 退订在 `detach()`（应用退出/热重载时调，正常使用中不调）。
   */
  function attach(): void {
    if (attached) return
    attached = true
    offDelta = window.miai.onAiChatDelta((p) => {
      if (p.requestId !== requestId.value) return
      pendingText += p.delta
      scheduleFlush()
    })
    offDone = window.miai.onAiChatDone((p) => {
      if (p.requestId !== requestId.value) return
      // 收尾前一定先把攒的刷进去：最后几个字通常就压在这一帧里
      flushNow()
      clearWatchdog()
      streaming.value = false
      requestId.value = null
      if (p.ok) {
        failText.value = null
        failDetail.value = null
        return
      }
      const reason: AiFailReason = p.reason ?? 'bad-response'
      failText.value = AI_FAIL[reason]
      failDetail.value = p.detail ?? null
      // 一个字都没收到时，那条空占位不该留在屏幕上（一个空气泡等于"它说完了但什么都没说"）
      const last = messages.value[messages.value.length - 1]
      if (last && last.role === 'assistant' && last.content.trim() === '') messages.value.pop()
    })
  }

  function detach(): void {
    offDelta?.()
    offDone?.()
    offDelta = null
    offDone = null
    attached = false
  }

  /** 读一次历史（跨重启）。失败当作"没有历史"—— 历史读不回来不该拦住聊天 */
  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    try {
      const view = await window.miai.getChatHistory()
      // 竞态：读完之前用户可能已经发了一句（极快的手速 / 慢磁盘）——
      // 那种情况下以内存这份为准，别拿磁盘把刚发的那句顶掉
      if (messages.value.length === 0) messages.value = view.messages
    } catch {
      /* 读不回来就当没有：不是错误（同 AI 那套"失败即值"的精神） */
    }
  }

  /**
   * 发一句。
   *
   * 【顺序为什么是"先 push 再发"】用户按下发送的那一瞬间，界面上就该出现他说的话
   * 和一条"正在长"的回答；等 IPC 回来再画会让界面有一帧像没反应。
   *
   * 【`accepted: false` 怎么办】把刚 push 的两条撤回、草稿还给用户、显示一句人话。
   * 撤回而不是留着，是因为主进程那边**一个包都没发**（限流/占线）——
   * 屏幕上留一条"你问过了"是在骗人。
   */
  async function send(context: AiChatContext): Promise<void> {
    if (streaming.value) return
    const text = draft.value.trim()
    if (text === '') return

    attach()
    failText.value = null
    failDetail.value = null
    messages.value.push({ role: 'user', content: text })
    messages.value.push({ role: 'assistant', content: '' })

    /*
     * 【必须 toIpc，否则一个请求都发不出去】
     * `messages.value` 是 Vue 的响应式数组，里面的对象是 **Proxy**。
     * IPC 的入参要过结构化克隆，而 `structuredClone(proxy)` 直接抛
     * `DataCloneError: [object Array] could not be cloned` ——
     * 表现就是"点了发送什么都没发生"（2026-10-25 实测）。
     * 这正是 `lib/ipc-safe.ts` 的 `toIpc`（structuredClone + toRaw）存在的理由，
     * 出题那条链早就这么干了（challenge.ts 的 `toIpc(topics)`），这里照抄。
     *
     * 只带**最近 20 条**：主进程只取 10 条进提示词，多发纯属搬运；
     * 聊久了整份发过去还会撞上主进程的 200 条入参上限。
     */
    let history: AiChatMessage[]
    try {
      // 见上面那段注释：不 toIpc 就必然 DataCloneError。放在 try 里是为了
      // 万一哪天消息里混进了不可克隆的东西，界面给一句"本鱼这边"，而不是静默死掉。
      const plain = toIpc(messages.value)
      history = plain
        .slice(0, -1)
        .filter((m) => m.content.trim() !== '')
        .slice(-20)
    } catch (e) {
      messages.value.splice(-2)
      draft.value = text
      streaming.value = false
      reportFailure('bad-response', e)
      return
    }

    streaming.value = true
    draft.value = ''

    /*
     * requestId **由渲染层先生成**（P1 补丁）。
     *
     * 【为什么不让主进程生成】主进程生成的话，回话要绕一圈 IPC 才回到这里，
     * 而增量事件可能比"回话"先到 —— 那时 `requestId.value` 还是 null，
     * 事件会被当成"别人的"丢掉；连 `done` 也一起丢，界面就永远停在"正在输入"。
     * 自己先生成，事件一到就能对上号，这一整类竞态不存在。
     * 附带好处：回话还没回来时用户点「叫停」也掐得准（id 已知）。
     */
    const rid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
    requestId.value = rid

    const input: AiChatStartInput = { requestId: rid, messages: history, context }
    let res
    try {
      res = await window.miai.aiChatStart(input)
    } catch (e) {
      // 能到这里的只有"我们自己传错了形状"（形状不对主进程抛）或 IPC 本身出事
      rollback(text)
      failText.value = AI_FAIL['bad-response']
      failDetail.value = e instanceof Error ? e.message : String(e)
      return
    }

    if (!res.accepted) {
      rollback(text)
      failText.value = AI_FAIL[res.reason ?? 'bad-response']
      return
    }
    // 主进程会原样沿用这个 id；万一它给了别的（防御），以回话为准
    if (res.requestId && res.requestId !== rid) requestId.value = res.requestId
    armWatchdog(requestId.value)
  }

  /**
   * 记一次失败（人话 + 技术细节）。
   *
   * 【为什么要有这个出口】原来失败只写 `failText`，细节全丢；而"点了没反应"
   * 这种报障，靠人话永远查不出来（`DataCloneError` 和"余额不足"都是"回的话看不懂"）。
   * 细节单独存一行给排查用（界面上是灰色小字），用户截一张图就够定位。
   */
  function reportFailure(reason: AiFailReason, detail?: unknown): void {
    failText.value = AI_FAIL[reason]
    failDetail.value =
      detail === undefined || detail === null
        ? null
        : detail instanceof Error
          ? detail.message
          : String(detail)
  }

  /**
   * 发送没成：把刚 push 的两条撤回、草稿还给用户、状态复位。
   *
   * 【`text` 必须由调用方传进来，不能在这里从 messages 里捞】调用顺序是
   * "先 splice 再读数组"，捞到的永远是空 —— 用户刚敲的那句话就没了。
   * 这是 2026-10-25 被 `ai-chat-payload.test.ts` 当场抓到的（限流档丢稿）。
   */
  function rollback(text: string): void {
    messages.value.splice(-2)
    draft.value = text
    streaming.value = false
    requestId.value = null
    clearWatchdog()
  }

  /**
   * 看门狗：接受了请求却**一直没有增量**时兜底收场。
   *
   * 主进程侧有首字 20s 闸，正常情况会自己发 `done`（reason=timeout）。
   * 走到这里说明连 `done` 都没到（IPC 断了 / 事件被丢）—— 那就别再让界面
   * 永远"正在输入"：取消、复位、给一句人话。25s = 主进程 20s 闸 + 余量。
   */
  function armWatchdog(id: string | null): void {
    clearWatchdog()
    if (id === null) return
    watchTimer = setTimeout(() => {
      watchTimer = null
      if (requestId.value !== id) return
      void window.miai.aiCancel(id).catch(() => {})
      flushNow()
      streaming.value = false
      requestId.value = null
      failText.value = AI_FAIL['timeout']
      failDetail.value = 'no delta within 25s'
    }, WATCHDOG_MS)
  }

  function clearWatchdog(): void {
    if (watchTimer !== null) {
      clearTimeout(watchTimer)
      watchTimer = null
    }
  }

  /** 叫停这一句。带 requestId —— 不带会连出题那条一起掐（docs/27 §12.2） */
  async function cancel(): Promise<void> {
    const id = requestId.value
    if (id === null) return
    try {
      await window.miai.aiCancel(id)
    } catch {
      /* 取消失败不该拦着用户：他再点一次发送会顶掉这一条（主进程侧有 busy 闸） */
    }
  }

  /** 清空对话（连磁盘一起）。`chat.json` 归主进程，所以必须过一次 IPC */
  async function clear(): Promise<void> {
    failText.value = null
    failDetail.value = null
    clearWatchdog()
    pendingText = ''
    messages.value = []
    loaded = true
    try {
      await window.miai.clearChat()
    } catch {
      /* 清盘失败：界面已经清了，下次启动可能"复活"——但比拦着不让清好 */
    }
  }

  /** 示例问题 / 快捷入口：直接当成一次发送 */
  async function ask(question: string, context: AiChatContext): Promise<void> {
    if (streaming.value) return
    draft.value = question
    await send(context)
  }

  return {
    messages,
    streaming,
    requestId,
    draft,
    failText,
    failDetail,
    hasMessages,
    attach,
    detach,
    load,
    send,
    cancel,
    clear,
    ask,
    reportFailure
  }
})
