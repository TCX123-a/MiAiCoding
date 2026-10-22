<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useContentStore } from '../stores/content'
import { useSettingsStore } from '../stores/settings'
import {
  useReviewRunner,
  useReviewPool,
  REVIEW_MIN_SIZE,
  REVIEW_MAX_SIZE,
  normalizeReviewSize
} from '../lib/review-practice'
import { toast } from '../components/base/toast'
import MiButton from '../components/base/MiButton.vue'
import MiMascot from '../components/base/MiMascot.vue'
import { PANEL, REVIEW, TITLE, TOAST } from '../lib/copy'

/**
 * 每日复习（学习闭环 §7）：从学过的课里抽几道练，**每天第一次做完发一张奖励图**
 * （2026-10-17 起不看分数；全对另有桌宠大白饭）。
 *
 * 【这一页只有一件事：把「开卷」说清楚】题量（5~20，记忆上次选择）、
 * 池子里有多少课、然后一个按钮。组卷的规则一条都不在这儿
 * （在 shared/review-paper.ts，纯函数有单测）—— 这里只负责把用户的选择交给
 * `useReviewRunner`，以及把三种"开不了卷"的原因分开说。
 *
 * 【为什么三种"开不了"要分开】
 *   ① 开关关着   —— 用户自己关的，指路设置页（不是故障）
 *   ② 档案没读完 —— 等几十毫秒就好，**不能**当成"没有课"（挑战页踩过这个坑，
 *                   见 stores/progress.ts 里 `loaded` 的注释）
 *   ③ 真的没课   —— 去学一课（带路，不是干说一句"空"）
 * 合成一句"暂无内容"的话，②会在冷启动时先跳一下③再自己改口 ——
 * 那比转圈还难看。
 */
const router = useRouter()
const content = useContentStore()
const settings = useSettingsStore()
const pool = useReviewPool()
const runner = useReviewRunner()

/*
 * 题量记忆：存 localStorage，键**自带版本号**（照 stores/zoom.ts 的规矩）——
 * 它只是界面偏好，丢了顶多回到 5 道，不值得为它动 config.json 的迁移
 * （那条路上写错一处，最坏是用户的学习进度被静默清零，风险完全不成比例）。
 *
 * 读写都钳：写的是字符串、读回来的可能是手改过或写坏的数 ——
 * 钳位函数只有 shared/review-paper.ts 那一份（normalizeReviewSize）。
 */
const SIZE_KEY = 'miai:review-size:v1'

function readSize(): number {
  try {
    return normalizeReviewSize(window.localStorage.getItem(SIZE_KEY))
  } catch {
    return REVIEW_MIN_SIZE
  }
}

const size = ref(readSize())

function setSize(n: number): void {
  size.value = normalizeReviewSize(n)
  try {
    window.localStorage.setItem(SIZE_KEY, String(size.value))
  } catch {
    // 存不下就只在本进程有效，照 zoom store 的取舍：界面偏好不值得打断任何流程
  }
}

/** 正在开卷（`start()` 里可能要先读练习史）。防连点开出两局 */
const starting = ref(false)

async function start(): Promise<void> {
  if (starting.value) return
  starting.value = true
  try {
    const n = await runner.start(size.value)
    // n === 0：学过课但一道题都没组出来（内容缺口），如实说；
    // n === -1 理论上到不了这里（按钮只在档案读完、池子非空时出现），到了也不报 ——
    // 界面自己会变成等待态，凭空弹一句"没课"反而是假话。
    if (n > 0) toast(TOAST.reviewStarted(n), 'success')
    else if (n === 0) toast(REVIEW.EMPTY_POOL, 'warn')
  } finally {
    starting.value = false
  }
}

/**
 * 空状态里那个「去学第一课」按钮指向哪一课。
 *
 * 和挑战页同款：找**第一门能学的课**（状态 open），不是写死课号 ——
 * 写死的话，内容调整或用户已经学完那一课之后，按钮会指向一个
 * 点开什么都没发生的位置。
 */
const firstLearnable = computed(() => {
  const l = content.bundle.lessons.find((x) => content.statusOf(x.id) === 'open')
  return l ? { id: l.id, title: l.title } : null
})

function goLearn(): void {
  if (firstLearnable.value) router.push(`/lesson/${firstLearnable.value.id}`)
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ TITLE.REVIEW }}</h1>
    <p class="page-intro">{{ REVIEW.INTRO }}</p>

    <!-- ① 设置里关掉了：指路设置页（这是用户自己关的，不是故障） -->
    <div v-if="!settings.config.reviewEnabled" class="card center">
      <MiMascot pose="think" size="m" />
      <p class="muted">{{ REVIEW.DISABLED }}</p>
    </div>

    <!-- ② 档案/练习史还没读完：先等，别下结论 -->
    <div v-else-if="pool === null" class="card center">
      <MiMascot pose="busy" size="m" />
      <p class="muted">{{ REVIEW.LOADING }}</p>
    </div>

    <!-- ③ 学过 0 课：带路（去学第一课），不是干说一句"空" -->
    <div v-else-if="pool === 0" class="card center">
      <MiMascot pose="think" size="l" />
      <div class="empty-title">{{ REVIEW.NO_LESSON }}</div>
      <MiButton v-if="firstLearnable" variant="primary" @click="goLearn">
        {{ REVIEW.GO_LEARN }}
      </MiButton>
    </div>

    <!-- ④ 可以开卷：题量 + 池子 + 开始 -->
    <div v-else class="card center">
      <MiMascot pose="expect" size="m" />
      <div class="size-row">
        <span class="size-label">{{ REVIEW.SIZE_LABEL }}</span>
        <button
          class="step-btn"
          :disabled="size <= REVIEW_MIN_SIZE"
          :aria-label="REVIEW.SIZE_DOWN + '（−）'"
          @click="setSize(size - 1)"
        >
          −
        </button>
        <span class="size-num">{{ size }}</span>
        <button
          class="step-btn"
          :disabled="size >= REVIEW_MAX_SIZE"
          :aria-label="REVIEW.SIZE_UP + '（＋）'"
          @click="setSize(size + 1)"
        >
          ＋
        </button>
      </div>
      <p class="muted">{{ PANEL.reviewDesc(pool) }}</p>
      <MiButton variant="primary" :disabled="starting" @click="start">
        {{ REVIEW.START }}
      </MiButton>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
}
.page-title {
  font-family: var(--mi-font-title);
  font-size: 20px;
  margin-bottom: 8px;
}
.page-intro {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
  margin-bottom: 16px;
}
/* 和挑战页同一套卡片长相（同一件事在项目里只该有一种样子） */
.card {
  padding: 32px 24px;
  /* glass 令牌：壁纸关时逐字节同 --mi-card；开时按 --mi-panel-alpha 稀释 */
  background: var(--mi-card-glass);
  border-radius: var(--mi-radius);
  box-shadow: var(--mi-shadow);
}
.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.empty-title {
  font-family: var(--mi-font-title);
  font-size: 17px;
  margin-top: 6px;
}
.muted {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.9;
  max-width: 460px;
}
.size-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}
.size-label {
  font-size: 13px;
  color: var(--mi-text-2);
}
.size-num {
  min-width: 28px;
  font-size: 17px;
  font-weight: 700;
  font-family: var(--mi-font-title);
}
.step-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--mi-border);
  border-radius: 50%;
  background: var(--mi-bg);
  color: var(--mi-text);
  font-size: 14px;
  line-height: 1;
  cursor: var(--mi-cursor, pointer);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.step-btn:hover:not(:disabled) {
  background: var(--mi-blue-light);
}
.step-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
