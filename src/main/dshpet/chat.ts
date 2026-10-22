/**
 * 大肥鱼桌宠 · 聊天的编排层（src/main/dshpet/chat.ts，2026-10-06 晚）
 *
 * 【这条链是怎么长出来的】dsh-pet 引擎原生自带「对话」菜单 + 输入弹窗：
 * 渲染端 POST 桥的 /chat?pet=main（body = {text:'…'}），宿主应答
 * {ok:true}（弹窗安静关闭）或 {ok:false, reason, message?}（弹窗内红字）。
 * 官方宿主把 /chat 接在 DSH 的云端会话上；咪爱版接在 v1 的聊天链路上 ——
 * 护栏（饿扁 / 10s 冷却 / 日 120 次 / 日 6 万 token）、记忆块、失败分档卖萌话术
 * 全部复用 shared 层纯函数与 copy.ts 的 PET 段，一个字的语义都不新造。
 *
 * 【为什么单独一个文件、全部依赖注入】编排（清洗→护栏→断网→调模型→记账→
 * 台词）是纯逻辑，deepseek 调用与状态读写都是注入的——单测塞假货就能把每条
 * 分支跑一遍，零 mock、零联网（全项目同款惯例，见 ai/deepseek.ts 头注释）。
 *
 * 【失败为什么也回 ok:true】dsh-pet 的失败通道是"弹窗里一行红字 + 弹窗不关"，
 * 而 v1 的聊天哲学是「失败分档全是卖萌的抱怨」（PET.CHAT_FAIL，从第一天起
 * 就不让护栏变成官方通知口吻）。两条只有一条能当出口：全部失败都走
 * say 气泡抱怨 + ok:true（弹窗安静关闭，体验与 v1 完全一致；失败不吃额度
 * 也不进冷却——见 brain.chatCommit 只在成功时被调）。唯一例外 bad-request：
 * 那意味着桥协议本身坏了（调用方写错），藏进气泡会掩盖真 bug，如实回红字。
 *
 * 【零中文纪律】本文件在 src/ 下、被文案闸门扫：注释随便写，字符串字面量
 * 里一个中文都不许有（台词走 PET.CHAT_*，tag 一律 ASCII）。
 */
import { PET } from '../../shared/copy'
import {
  PET_CHAT_MAX_MESSAGES,
  PET_CHAT_REPLY_TOKENS,
  approxPetTokens,
  sanitizePetChat,
  type PetChatGate,
  type PetChatMessage
} from '../../shared/pet'
import type { AiResult } from '../../shared/types'

/** 桥应答（与 dsh-pet shared/chat.ts 的收件形状对齐；renderer 只认这三个键） */
export type PetChatReply = { ok: true } | { ok: false; reason: string; message?: string }

export interface PetChatServiceDeps {
  /** 护栏读口（brain.chatGate；纯读） */
  gate: () => PetChatGate
  /** 护栏记账（brain.chatCommit；**只有成功聊成才调**） */
  commit: (usedTokens: number) => void
  /** 记忆块（brain.chatMemoryBlock；空串 = 不附） */
  memoryBlock: () => string
  /** 台词出口（host.sayText；与碎碎念共用同一只气泡叶子） */
  say: (text: string, tag: string) => void
  /** 断网即时降级（Chromium 连通性探测，口径同 v1：说没网时请求几乎必然失败） */
  isOnline: () => boolean
  /**
   * 真正调模型（host 注入 ai/deepseek 的 chatPet 薄壳）。
   * 契约：**不抛异常**——所有失败以 AiResult 返回（deepseek.postChat 的全捕获保证）。
   */
  chat: (input: { messages: PetChatMessage[]; memory: string }) => Promise<AiResult<string>>
  log?: (line: string) => void
}

export interface PetChatService {
  /** 处理一条用户消息（入参 = 桥 body 里的 text 值，未清洗） */
  handle(rawText: unknown): Promise<PetChatReply>
  /** 探针/诊断口子：当前内存历史条数（含 assistant） */
  historyLength(): number
}

export function createPetChatService(deps: PetChatServiceDeps): PetChatService {
  const log = deps.log ?? ((): void => {})

  /**
   * 对话历史（内存，窗口生命周期内）。dsh-pet 的输入弹窗每次只发一句，
   * 上下文由宿主拼 —— 与 v1 的渲染端「每次发全量历史」等价，只是持有方换了。
   * 【为什么不落盘】逐句闲聊的历史对"陪伴"没有跨会话价值，而跨天的信息
   * （上次聊天隔了多久）已经由记忆块（pet.json 的 memory.lastChatAt）负责；
   * 少一个落盘点 = 少一类「文件写坏了怎么办」。
   */
  const history: PetChatMessage[] = []

  async function handle(rawText: unknown): Promise<PetChatReply> {
    // 清洗：桥 body 里不是非空字符串就是协议坏了（2e3 上限渲染端已限，
    // 超长交给 sanitizePetChat 截到 PET_CHAT_MAX_CHARS，v1 同款）
    if (typeof rawText !== 'string') return { ok: false, reason: 'bad-request' }
    const text = rawText.trim()
    if (text === '') return { ok: false, reason: 'bad-request' }

    // 四道护栏（判定口径 = shared/pet.ts 的 petChatGate，v1 三道的顺序零改动，
    // hungry 插最前 —— 它是"零 API 承诺"的一环：饿扁时必须拦在**出网之前**，
    // 落到网络请求那一步就已经在烧 token 的钱了）
    const gate = deps.gate()
    if (gate === 'hungry') {
      deps.say(PET.CHAT_HUNGRY, 'chat-gate')
      return { ok: true }
    }
    if (gate === 'cooldown') {
      deps.say(PET.CHAT_BUSY, 'chat-gate')
      return { ok: true }
    }
    if (gate === 'daily') {
      deps.say(PET.CHAT_DAILY_LIMIT, 'chat-gate')
      return { ok: true }
    }
    if (gate === 'tokens') {
      deps.say(PET.CHAT_TOKEN_LIMIT, 'chat-gate')
      return { ok: true }
    }

    // 断网即时降级：连请求都不发（发出去的代价是 30s 超时干等，v1 口径）
    if (!deps.isOnline()) {
      deps.say(PET.CHAT_FAIL['offline'], 'chat-fail')
      return { ok: true }
    }

    // 拼上下文：历史 + 这一句，整体过 v1 的清洗器（截长、丢老、末条必须 user）
    const messages = sanitizePetChat([...history, { role: 'user', content: text }])
    if (messages === null) {
      // 内存历史只有本文件在写、形状自证合法；走到这里说明代码坏了，别吞
      log('chat history failed sanitize (internal bug)')
      return { ok: false, reason: 'bad-request' }
    }

    const res = await deps.chat({ messages, memory: deps.memoryBlock() })
    if (res.ok) {
      history.push({ role: 'user', content: text })
      history.push({ role: 'assistant', content: res.data })
      if (history.length > PET_CHAT_MAX_MESSAGES) {
        history.splice(0, history.length - PET_CHAT_MAX_MESSAGES)
      }
      // 记账口径 = v1（约算，不求跟账单一致）：送进去的全部内容 + 回复上限的固定开销
      const used = messages.reduce((n, m) => n + approxPetTokens(m.content), 0) + PET_CHAT_REPLY_TOKENS
      deps.commit(used)
      deps.say(res.data, 'chat')
      return { ok: true }
    }

    // 失败分档 → 卖萌抱怨（PET.CHAT_FAIL 的键与 AiFailReason 同集，typecheck 保真）
    deps.say(PET.CHAT_FAIL[res.reason], 'chat-fail')
    return { ok: true }
  }

  return {
    handle,
    historyLength: () => history.length
  }
}
