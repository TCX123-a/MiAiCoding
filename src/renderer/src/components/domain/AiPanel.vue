<script setup lang="ts">
/**
 * AI 侧栏（P1，docs/27 §8.5）：大肥鱼助手，贴着练习场右栏。
 *
 * 【为什么是"侧栏"而不是一个新页面】
 * 主人问的问题**永远是关于他此刻屏幕上那段代码的**。把对话挪到一个独立页面，
 * 他要在两个页面之间来回看代码、抄报错、再回去问 —— 这正是"现代化 AI 编程"
 * 要消灭的那段摩擦。侧栏和编辑器同屏，看得到才能问得准。
 *
 * 【为什么外壳这么简单（不做 markdown 渲染）】
 * 模型回的是**原文**，其中可能有代码围栏、报错片段。P1 用 `pre-wrap` 原样显示：
 * 少一层解析就少一处"它明明给了代码，界面上却成了一坨"的坑。
 * 富文本渲染留给 P3（要接 highlight.js 与 MiRichText 的既有体系），
 * 本轮先把"能流式、能取消、不断线"这三件事做扎实（docs/27 §7 的验收判据）。
 *
 * 【上下文为什么要做成"可勾选"】
 * 勾上的东西会**离开这台电脑**发给 DeepSeek。默认全开是因为这是它有用的前提，
 * 但主人必须能看见、能关掉、并且读得到一句"到底发了什么"（§8.4 的知情要求）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAiChatStore } from '../../stores/aiChat'
import { useRunnerStore } from '../../stores/runner'
import { useSettingsStore } from '../../stores/settings'
import { useContentStore } from '../../stores/content'
import { toIpc } from '../../lib/ipc-safe'
import { readSelection, selectionAvailable } from '../../lib/editor-selection'
import { AI_CHAT } from '../../lib/copy'
import MiButton from '../base/MiButton.vue'
import MiModal from '../base/MiModal.vue'
import type { AiChatContext, GlossaryTerm } from '../../../../shared/types'

const ai = useAiChatStore()
const runner = useRunnerStore()
const settings = useSettingsStore()
const content = useContentStore()
const router = useRouter()

/** 三个上下文开关。**默认全开**：这是侧栏"看得见代码"的前提 */
const withCode = ref(true)
const withSelection = ref(true)
const withRun = ref(true)

/** 清空确认框 */
const askOpen = ref(false)

/** 消息列表容器（滚到底用） */
const listEl = ref<HTMLElement | null>(null)

const hasKey = computed(() => settings.config.ai.hasKey)
/*
 * @选区：走 `lib/editor-selection.ts` 的登记处。
 *
 * 【为什么不是 prop】面板挂在外壳的右栏里，而编辑器在页面内部（隔着一个
 * router-view）—— 外壳拿不到那个 ref。登记处是两者之间唯一的桥。
 *
 * `selectionAvailable` 是个响应式布尔（由 CodeMirror 的 updateListener 维护），
 * `selectionReady` 依赖它，所以用户在编辑器里一选中，那颗勾选**立刻**从
 * "（先在编辑器里选一段）"变成"选中片段"；正文仍然每次现取（不缓存快照）。
 */
const selectionReady = computed(() => selectionAvailable.value && (readSelection()?.text ?? '').trim() !== '')
const runReady = computed(() => runOutputText() !== '')

const canSend = computed(() => !ai.streaming && ai.draft.trim() !== '')

/**
 * 术语表（铁律 2）。从内容包现取，**只挑提示词用得到的四个字段** ——
 * `scanExcludes` 是扫描脚本的东西，发过去纯属占 token（同 ai-prompt 的取舍）。
 * 必须 `toIpc`（structuredClone(toRaw)）：store 里读出来的对象是 Proxy，
 * 直接过 IPC 会在结构化克隆那一步抛 DataCloneError。
 */
function termsForIpc(): GlossaryTerm[] {
  const all = toIpc(content.bundle.glossary.terms)
  return all.map((t) => ({
    key: t.key,
    originals: t.originals,
    cat: t.cat,
    example: t.example
  }))
}

/** 最近一次运行的输出（stdout 与 stderr 分开写，主进程再统一截断） */
function runOutputText(): string {
  const r = runner.lastResult
  if (!r) return ''
  const parts: string[] = []
  if (r.stdout.trim() !== '') parts.push(r.stdout.trim())
  if (r.stderr.trim() !== '') parts.push(r.stderr.trim())
  return parts.join('\n')
}

/**
 * 组这一次的上下文。**每次发送现取**，不缓存快照：
 * 缓存一份就一定会和屏幕上的代码不同步，而"它答的是上一版代码"这件事
 * 用户完全看不出来（他不会去数行号）。
 */
function buildContext(): AiChatContext {
  const ctx: AiChatContext = { terms: termsForIpc() }
  if (withCode.value && runner.code.trim() !== '') {
    ctx.code = runner.code
    ctx.lang = runner.lang
  }
  if (withSelection.value && selectionReady.value) {
    // 现取：缓存一份就会和屏幕上的选区脱节（用户看不出它答的是旧选区）
    ctx.selection = readSelection() ?? undefined
  }
  if (withRun.value) {
    const out = runOutputText()
    if (out !== '') ctx.runOutput = out
  }
  return ctx
}

function send(): void {
  if (!canSend.value) return
  /*
   * 组上下文本身也可能抛（内容包没就绪、克隆失败…）。不许让它静默 ——
   * 那正是"点了发送什么都没发生"的典型成因：异常在点击处理里被 Vue 吞进
   * 控制台，界面上一点痕迹都没有（2026-10-25 踩过一次）。
   */
  let ctx: AiChatContext
  try {
    ctx = buildContext()
  } catch (e) {
    ai.reportFailure('bad-response', e)
    return
  }
  void ai.send(ctx)
}

/** 空态那三个示例问题：点一下就直接发（复用"示例按钮"的引导思路） */
function askExample(q: string): void {
  if (ai.streaming) return
  void ai.ask(q, buildContext())
}

function cancel(): void {
  void ai.cancel()
}

function confirmClear(): void {
  askOpen.value = false
  void ai.clear()
}

function goSettings(): void {
  router.push('/settings')
}

/**
 * 滚到底。
 *
 * 【为什么盯"内容长度"而不是"消息条数"】流式期间条数不变、内容在长；
 * 只盯条数的话新长出来的字会顶到可视区外面去（用户以为它卡住了）。
 * `flush: 'post'`：等 DOM 真的更新完再量 scrollHeight，否则量到的是上一帧的高度。
 */
function scrollToBottom(): void {
  void nextTick(() => {
    const el = listEl.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  })
}

watch(
  () => [ai.messages.length, ai.messages[ai.messages.length - 1]?.content.length ?? 0, ai.streaming],
  () => scrollToBottom(),
  { flush: 'post' }
)

onMounted(() => {
  // 订阅挂一次、读一次历史即可（重复调用是幂等的，见 store）
  ai.attach()
  void ai.load()
  scrollToBottom()
})

/** 角色名与气泡方向：靠 role 一处判断，模板里不重复写 if */
function roleLabel(role: 'user' | 'assistant'): string {
  return role === 'user' ? AI_CHAT.ROLE_USER : AI_CHAT.ROLE_ASSISTANT
}

/** 清空按钮的无障碍名（它只有两个字，窄栏里读屏也说得清） */
const clearLabel = AI_CHAT.CLEAR_TITLE
</script>

<template>
  <aside class="ai-panel" :aria-label="AI_CHAT.TITLE">
    <header class="ai-head">
      <!-- 没有「收起」按钮：面板住在右栏里，收不收起由外壳那颗 ⇤/⇥ 负责 ——
           同一个动作两处入口，迟早"按了一个另一个状态没跟上" -->
      <div class="head-text">
        <div class="head-title">{{ AI_CHAT.TITLE }}</div>
        <div class="head-sub">{{ AI_CHAT.SUBTITLE }}</div>
        <!--
          当前模型 id。**为什么值得占一行**：模型自述版本不可信（实测问它
          "你是什么版本"只会答"建议查阅官方文档"），用户唯一能确认的就这条
          配置值 —— 而且它就在「设置 → AI」里可改。窄栏里靠省略号截断，
          完整内容挂在 title 上。
        -->
        <div class="head-model" :title="AI_CHAT.MODEL_TITLE(settings.config.ai.model)">
          {{ AI_CHAT.MODEL_LABEL }} {{ settings.config.ai.model }}
        </div>
      </div>
      <div class="head-acts">
        <button
          type="button"
          class="icon-btn"
          :title="ai.hasMessages ? clearLabel : AI_CHAT.CLEAR_DISABLED_HINT"
          :aria-label="clearLabel"
          :disabled="!ai.hasMessages || ai.streaming"
          @click="askOpen = true"
        >
          {{ AI_CHAT.CLEAR }}
        </button>
      </div>
    </header>

    <!-- 没配 Key：不弹窗、不拦着学，只在这里说明白（铁律 3） -->
    <div v-if="!hasKey" class="notice">
      <div class="notice-text">{{ AI_CHAT.NO_KEY_HINT }}</div>
      <MiButton size="sm" variant="secondary" @click="goSettings">{{ AI_CHAT.NO_KEY_ACTION }}</MiButton>
    </div>

    <div ref="listEl" class="ai-body">
      <!-- 空态：三个可以直接点的示例问题 -->
      <div v-if="!ai.hasMessages" class="empty">
        <div class="empty-title">{{ AI_CHAT.EMPTY_TITLE }}</div>
        <div class="empty-sub">{{ AI_CHAT.EMPTY_SUB }}</div>
        <div class="examples">
          <button
            v-for="q in AI_CHAT.EXAMPLES"
            :key="q"
            type="button"
            class="example-btn"
            :disabled="ai.streaming"
            @click="askExample(q)"
          >
            {{ q }}
          </button>
        </div>
      </div>

      <div
        v-for="(m, i) in ai.messages"
        :key="i"
        class="msg"
        :class="m.role"
      >
        <div class="who">{{ roleLabel(m.role) }}</div>
        <pre v-if="m.content !== ''" class="bubble">{{ m.content }}</pre>
        <!-- 流式刚起步、一个字还没到：画三个跳动的点，而不是一个空气泡 -->
        <div v-else-if="ai.streaming" class="bubble typing">
          <span class="dots"><i class="mi-motion-keep" /><i class="mi-motion-keep" /><i class="mi-motion-keep" /></span>
        </div>
      </div>

      <!-- 失败一律在气泡区末尾说一句人话（映射自原因码），不弹窗 -->
      <div v-if="ai.failText" class="notice fail">
        <div class="notice-text">
          <div>{{ AI_CHAT.FAIL_PREFIX }}{{ ai.failText }}</div>
          <!-- 技术细节：正常用户不用看，但"点了没反应"时必须能看见 -->
          <div v-if="ai.failDetail" class="diag">{{ AI_CHAT.DIAG_PREFIX }}{{ ai.failDetail }}</div>
        </div>
      </div>
    </div>

    <footer class="ai-foot">
      <div class="ctx-row">
        <span class="ctx-label">{{ AI_CHAT.CONTEXT_LABEL }}</span>
        <label class="ctx-chip" :title="AI_CHAT.CONTEXT_CODE_HINT">
          <input v-model="withCode" type="checkbox" />
          <span>{{ AI_CHAT.CONTEXT_CODE }}</span>
        </label>
        <label
          class="ctx-chip"
          :class="{ muted: !selectionReady }"
          :title="selectionReady ? AI_CHAT.CONTEXT_SELECTION_HINT_ON : AI_CHAT.CONTEXT_SELECTION_HINT_OFF"
        >
          <input v-model="withSelection" type="checkbox" :disabled="!selectionReady" />
          <span>{{ selectionReady ? AI_CHAT.CONTEXT_SELECTION : AI_CHAT.CONTEXT_SELECTION_EMPTY }}</span>
        </label>
        <label
          class="ctx-chip"
          :class="{ muted: !runReady }"
          :title="runReady ? AI_CHAT.CONTEXT_RUN_HINT_ON : AI_CHAT.CONTEXT_RUN_HINT_OFF"
        >
          <input v-model="withRun" type="checkbox" :disabled="!runReady" />
          <span>{{ runReady ? AI_CHAT.CONTEXT_RUN : AI_CHAT.CONTEXT_RUN_EMPTY }}</span>
        </label>
      </div>

      <textarea
        v-model="ai.draft"
        class="input"
        rows="3"
        :placeholder="ai.streaming ? AI_CHAT.BUSY_HINT : AI_CHAT.PLACEHOLDER"
        @keydown.enter.exact.prevent="send"
      />

      <div class="send-row">
        <span class="privacy">{{ AI_CHAT.CONTEXT_PRIVACY }}</span>
        <MiButton
          v-if="!ai.streaming"
          size="sm"
          :disabled="!canSend"
          :title="canSend ? '' : AI_CHAT.SEND_DISABLED_HINT"
          @click="send"
        >
          {{ AI_CHAT.SEND }}
        </MiButton>
        <MiButton v-else size="sm" variant="secondary" :title="AI_CHAT.CANCEL_TITLE" @click="cancel">
          {{ AI_CHAT.CANCEL }}
        </MiButton>
      </div>
    </footer>

    <MiModal v-model:visible="askOpen" :title="AI_CHAT.CLEAR_CONFIRM_TITLE" :width="380">
      <p class="ask-text">{{ AI_CHAT.CLEAR_CONFIRM_BODY }}</p>
      <template #footer>
        <MiButton variant="ghost" @click="askOpen = false">{{ AI_CHAT.CLEAR_CANCEL }}</MiButton>
        <MiButton variant="danger" @click="confirmClear">{{ AI_CHAT.CLEAR_OK }}</MiButton>
      </template>
    </MiModal>
  </aside>
</template>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /*
   * 宽度由**容器**决定，不写死 340：它现在住在右栏里（右栏宽度是用户拖出来的，
   * 默认 22% ≈ 264px）。写死 340 会在窄右栏里横向溢出，而 overflow:hidden
   * 会把右边的按钮切掉 —— 那种坏法（"清空按钮点不到"）最难查。
   */
  width: 100%;
  min-width: 0;
  background: var(--mi-bg);
  overflow: hidden;
}

.ai-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--mi-border);
  background: var(--mi-blue-light);
}
.head-text {
  flex: 1;
  min-width: 0;
}
.head-title {
  font-family: var(--mi-font-title);
  font-size: 14px;
  color: var(--mi-text);
  /* 右栏默认只有 264px：标题不许把右边的「清空」挤出可视区 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--mi-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head-model {
  margin-top: 1px;
  font-size: 10.5px;
  color: var(--mi-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head-acts {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.icon-btn {
  border: none;
  background: transparent;
  color: var(--mi-text-2);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--mi-radius-sm);
}
.icon-btn:hover:not(:disabled) {
  background: var(--mi-bg);
  color: var(--mi-text);
}
/*
 * 禁用态**不用 opacity**：那是「整块连文字一起变淡」，撞在 docs/04 的
 * 「文字永远实心」硬底线上（`wall-glass.test.ts` 的 opacity 快照闸门守着这条）。
 * 换色是同一个视觉语义，且颜色本身是为可读性选的 —— 与 Sidebar 锁定课那次的
 * 修法同向（opacity:0.6 → color:var(--mi-text-3)）。
 */
.icon-btn:disabled {
  color: var(--mi-text-3);
  cursor: not-allowed;
}

.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--mi-text-2);
  background: var(--mi-blue-light);
  border-bottom: 1px solid var(--mi-border);
}
.notice.fail {
  margin: 8px 12px;
  border-radius: var(--mi-radius-sm);
  border: 1px solid var(--mi-border);
  background: var(--mi-warn-light, var(--mi-blue-light));
  color: var(--mi-text);
}
.notice-text {
  flex: 1;
  min-width: 0;
}
/* 排查用那一行：小、灰、可换行（错误信息里常有长串） */
.diag {
  margin-top: 2px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--mi-text-3);
  word-break: break-all;
}

.ai-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty {
  margin: auto 0;
  text-align: center;
  color: var(--mi-text-2);
}
.empty-title {
  font-size: 13px;
  color: var(--mi-text);
  margin-bottom: 6px;
}
.empty-sub {
  font-size: 12px;
  line-height: 1.7;
  margin-bottom: 12px;
}
.examples {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.example-btn {
  border: 1px dashed var(--mi-border);
  background: transparent;
  color: var(--mi-text);
  font-size: 12px;
  line-height: 1.6;
  padding: 8px 10px;
  border-radius: var(--mi-radius-sm);
  cursor: pointer;
  text-align: left;
}
.example-btn:hover:not(:disabled) {
  border-color: var(--mi-blue-deep);
  background: var(--mi-blue-light);
}
/* 同 .icon-btn:disabled：换色而不是降透明度（文字不许变淡） */
.example-btn:disabled {
  color: var(--mi-text-3);
  border-color: var(--mi-border);
  cursor: not-allowed;
}

.msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
}
.msg.user {
  align-items: flex-end;
}
.who {
  font-size: 11px;
  color: var(--mi-text-2);
}
.bubble {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--mi-radius-sm);
  font-size: 12.5px;
  line-height: 1.75;
  /* 模型原文原样保留：换行、缩进、代码围栏都不动 */
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  background: var(--mi-blue-light);
  color: var(--mi-text);
  max-width: 100%;
  overflow-x: auto;
}
.msg.user .bubble {
  background: var(--mi-blue-deep);
  color: #fff;
}
.bubble.typing {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
}
.dots {
  display: inline-flex;
  gap: 4px;
}
.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  /* 用次级文字色而不是 opacity：那会让点跟着背景一起变淡（硬底线：文字实心） */
  background: var(--mi-text-2);
  animation: ai-bounce 1s infinite ease-in-out;
}
.dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.dots i:nth-child(3) {
  animation-delay: 0.3s;
}
/* 只动 transform，不动 opacity：跳动感来自位移与缩放，与可见性无关 */
@keyframes ai-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0) scale(1);
  }
  40% {
    transform: translateY(-3px) scale(1.25);
  }
}

.ai-foot {
  flex-shrink: 0;
  border-top: 1px solid var(--mi-border);
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ctx-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--mi-text-2);
}
.ctx-label {
  flex-shrink: 0;
}
.ctx-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}
.ctx-chip.muted {
  /* 同前两处：换色，不降透明度 —— 这行字是"为什么勾不了"的唯一解释 */
  color: var(--mi-text-3);
}
.ctx-chip input {
  margin: 0;
}
.input {
  width: 100%;
  resize: vertical;
  min-height: 58px;
  max-height: 160px;
  padding: 8px 10px;
  font-size: 12.5px;
  line-height: 1.7;
  font-family: inherit;
  color: var(--mi-text);
  background: var(--mi-bg);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
}
.input:focus {
  outline: none;
  border-color: var(--mi-blue-deep);
}
.send-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.privacy {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--mi-text-2);
}
.ask-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--mi-text);
}
</style>
