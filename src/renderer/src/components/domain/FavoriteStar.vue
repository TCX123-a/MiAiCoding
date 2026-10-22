<script setup lang="ts">
/**
 * 题目上的那颗 ⭐ —— **三个入口共用同一个组件**。
 *
 * 【为什么抽成组件，而不是三处各写一遍】
 * 三个入口（练习遮罩的题干行、每日挑战回顾的每一行、错题本的行内动作）
 * 做的事**完全一样**：拿当前这道题的全局键去收藏 store 翻一次状态。
 * 各写一遍的话，三处的差别会慢慢长出来 —— 最典型的是"AI 题必须带本体"
 * 这条：漏了的那一处**当次能用**（星星亮起来、toast 也弹了），
 * 重启之后那一条收藏在主进程读口被当成坏条目丢掉，
 * 而用户看到的是"我收藏的那道 AI 题自己没了"。
 *
 * 【为什么把"当前这道题"整个传进来，而不是只传个键】
 * 收藏一个 AI 题要**连题面一起存**（它不在任何一课里，光有键找不回来）。
 * 组件不自己去别处翻题：调用点手上正好有那道题，传进来最准。
 * 内置题传了也只是给判定用一下，store 会把多余的本体剥掉。
 *
 * 【`source` 是"从哪儿收的"】收藏页的来源筛选靠它（'lesson'、'challenge'……）。
 * 它是选填的：拿不准时**宁可留空**，别编一个 —— 编错了筛出来的是假结果。
 */
import { computed, onMounted, ref } from 'vue'
import { useFavoritesStore } from '../../stores/favorites'
import { ACTION } from '../../lib/copy'
import type { Question } from '../../../../shared/types'

const props = defineProps<{
  /** 全局键（收藏的身份，和错题本同一套） */
  qKey: string
  /** 题目本体。**AI 题必传**（见上） */
  question: Question | null
  /** 从哪儿收的（模式名） */
  source?: string
}>()

const fav = useFavoritesStore()
const on = computed(() => fav.isFav(props.qKey))
const title = computed(() =>
  on.value ? ACTION.QUESTION_FAV_REMOVE_TITLE : ACTION.QUESTION_FAV_ADD_TITLE
)

/**
 * 首次相遇的脉冲（V1-52 ②，2026-10-16）。
 *
 * 【为什么需要它】这颗星是全应用攒系统的**唯一入口**，但它出场的样子是
 * 题干旁一枚灰色小 ☆ —— 真档实测 learned=28、收藏=0：用户做完了整套题
 * 都没注意到它可以点。第一次把它放到场上时让它亮两下，之后永不再来。
 *
 * 【为什么按"第一次渲染"记账，而不是"第一次点击"】提示要教的正是"这里
 * 有东西可点"——等用户点了才提示等于没提示。所以第一次渲染就落记录。
 *
 * 【存储不可用时静默放弃】隐私模式/被清空时 localStorage 会抛：这时**不提示**
 * 也不写记录（写不进去）——"每次开题库都闪两下"比"老用户永远看不到提示"烦得多，
 * 二选一选安静的。
 */
const HINT_SEEN_KEY = 'miai:star-hint:v1'
const hinting = ref(false)

onMounted(() => {
  try {
    if (localStorage.getItem(HINT_SEEN_KEY) === null) {
      hinting.value = true
      localStorage.setItem(HINT_SEEN_KEY, '1')
    }
  } catch {
    /* 见上：存储不可用 = 放弃提示，不写记录 */
  }
})

function toggle(): void {
  fav.toggle(props.qKey, props.question, props.source)
}
</script>

<template>
  <!--
    `data-sfx="none"`（V1-41）：这颗星**自己不走委托层的通用 click**，
    它的声音由 store 按动作播 —— 收是「嘎」（quack）、撤是「咔」（click，
    2026-10-01 主人拍板的两动作两种声音）。不写 none 的话：
    收 = 通用 click + store 的 quack 两声叠放，撤 = click + click 被同名
    节流吞成一声 —— 加一声、减一声，听感不对称。
  -->
  <button
    class="fav-star"
    :class="{ on, hint: hinting }"
    type="button"
    data-sfx="none"
    :title="title"
    :aria-label="title"
    :aria-pressed="on"
    @click="toggle"
  >
    {{ on ? ACTION.QUESTION_FAV_REMOVE : ACTION.QUESTION_FAV_ADD }}
  </button>
</template>

<style scoped>
.fav-star {
  padding: 0 4px;
  border: none;
  border-radius: var(--mi-radius-sm);
  background: transparent;
  /* 星星要够大才点得准：它是这一行里唯一的图标动作 */
  font-size: 16px;
  line-height: 1.4;
  color: var(--mi-text-3);
  cursor: var(--mi-cursor, pointer);
}
.fav-star:hover {
  background: var(--mi-zebra);
}
/* 收着的时候用暖色：⭐ 和 ☆ 本来就分得开，配色再帮一把 */
.fav-star.on {
  color: var(--mi-warn-deep);
}
/*
 * 首次相遇的脉冲（V1-52 ②）：微微一胀 + 亮成暖色，两次就停。
 * 延迟 0.6s 是为了让题目面板先落稳 —— 面板还在动的时候脉冲会被当成过渡的一部分。
 * 减弱动效下由 motion.css 总闸压成 1ms（装饰动画，按那份文件的既定口径就该如此）。
 */
.fav-star.hint {
  animation: fav-star-hint 1.5s var(--mi-ease-out) 0.6s 2;
}
@keyframes fav-star-hint {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.5);
    color: var(--mi-warn-deep);
  }
}
</style>
