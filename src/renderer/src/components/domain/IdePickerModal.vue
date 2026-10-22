<script setup lang="ts">
/**
 * 「检测到不止一个，用哪个？」的选择框（设置页与练习场共用）。
 *
 * 【什么时候才轮到它（v9 拍板：直接选最优）】默认口径是**直接选榜单第一**
 * （落盘 + 打开），只有两个真分不出高下的局面才会弹出来：平手（同一产品
 * 装了两份）或一个合适的都没有还得矮子里挑将军 —— 这时路径决定「打开哪个
 * 程序」，必须用户自己点头。判定在 lib/ide-detect.ts 的 planIdeChoice，
 * 这里只负责摆样子。
 *
 * 【显示什么】产品名 + 完整路径。路径必须给：装了多个版本/多个位置时，
 * 名字可能一模一样，路径才是唯一能分辨的东西。有推荐项时挂一枚「推荐」
 * 徽标；提示行按 `hint` 说清这是哪种局面（平手 / 没有专门写这门语言的）。
 *
 * ⚠️ 这个组件只负责「摆出来 + 把点击翻译成 pick」，**不碰配置** ——
 * 落盘由调用方做（两处的落盘路径不同：设置页直接填、练习场填完还要重试打开）。
 */
import MiModal from '../base/MiModal.vue'
import { RUNNER_UI } from '../../lib/copy'
import type { IdeCandidate, LangOfCode } from '../../../../shared/types'
import type { IdePickHint } from '../../lib/ide-detect'

defineProps<{
  visible: boolean
  candidates: IdeCandidate[]
  /** 这次检测是替哪门语言做的（提示行要念出语言名） */
  lang: LangOfCode
  hint: IdePickHint
  /** 该挂「推荐」徽标的那台的路径；none-suitable 档没有推荐 → null */
  recommendedPath: string | null
}>()

const emit = defineEmits<{ 'update:visible': [v: boolean]; pick: [c: IdeCandidate] }>()

/** MiModal 只在 ✕ / Esc / 点旁边时回写 false，原样转发给调用方去关 */
function onVisible(v: boolean): void {
  if (!v) emit('update:visible', false)
}

/** 选中一个：**先关框、再报结果**（反过来的话，退场那 190ms 里框还盖在最上层） */
function pick(c: IdeCandidate): void {
  emit('update:visible', false)
  emit('pick', c)
}
</script>

<template>
  <MiModal
    :visible="visible"
    :title="RUNNER_UI.IDE_PICK_TITLE"
    :width="460"
    @update:visible="onVisible"
  >
    <p class="pick-hint">
      {{ hint === 'tie' ? RUNNER_UI.IDE_PICK_HINT(lang) : RUNNER_UI.IDE_PICK_NONE_SUITABLE(lang) }}
    </p>
    <div class="pick-list">
      <button
        v-for="c in candidates"
        :key="c.path"
        type="button"
        class="pick-item"
        @click="pick(c)"
      >
        <span class="pick-name">
          {{ c.name }}
          <!-- 推荐徽标：平手局里第一台。none-suitable 档没有推荐（recommendedPath 为 null），
               整行 v-if 自然不出现 —— 那种局面下"推荐"二字是句假话。 -->
          <span v-if="c.path === recommendedPath" class="pick-badge">
            {{ RUNNER_UI.IDE_PICK_RECOMMENDED }}
          </span>
        </span>
        <span class="pick-path">{{ c.path }}</span>
      </button>
    </div>
  </MiModal>
</template>

<style scoped>
.pick-hint {
  margin: 0 0 12px;
  color: var(--mi-text-2);
  font-size: 13px;
}
.pick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/*
 * 每一项是一整块可点的卡片（不是行内文字按钮）：目标是让光标随便落在
 * 名字或路径上都算点中它。左对齐 —— 两条信息长短不齐，居中会参差。
 */
.pick-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius);
  background: var(--mi-bg);
  text-align: left;
  cursor: var(--mi-cursor, pointer);
}
.pick-item:hover {
  border-color: var(--mi-blue);
  background: var(--mi-blue-light);
}
.pick-name {
  font-weight: 600;
  color: var(--mi-text);
}
/*
 * 「推荐」徽标：只挂在平手局的第一台上（none-suitable 档没有它 —— 那种
 * 局面里没有谁配得上这三个字）。只是给两条几乎一样的候选一个默认倾向，
 * 不改变「点了谁就是谁」——按路径落盘，不按推荐落盘。
 */
.pick-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--mi-blue-light);
  color: var(--mi-blue);
  font-size: 11px;
  font-weight: 500;
  vertical-align: 1px;
}
/* 路径用小号等宽字体：它是要被"读"的字符串，不是文案 */
.pick-path {
  font-family: var(--mi-code);
  font-size: 12px;
  color: var(--mi-text-3);
  word-break: break-all;
}
</style>
