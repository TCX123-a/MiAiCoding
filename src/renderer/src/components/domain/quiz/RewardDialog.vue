<script setup lang="ts">
import { computed, ref } from 'vue'
import MiModal from '../../base/MiModal.vue'
import MiButton from '../../base/MiButton.vue'
import { toast } from '../../base/toast'
import { GALLERY } from '../../../lib/copy'
import { GALLERY_IDS, galleryRemaining } from '../../../../../shared/gallery'
import { rewardImageUrl } from '../../../lib/gallery'
import { useRewardStore } from '../../../stores/reward'

/**
 * 奖励弹窗（学习闭环 §7）：每天第一次完成复习 → 开一张新图。
 * 2026-10-17 起不看分数；全对那一轮用更热烈的标题（pending.perfect）。
 *
 * 【它是全项目唯一一个「全屏遮挡 + 庆祝」的弹窗】别处（退出确认、阶段卷确认）
 * 都是"拦一下再决定"，这里没有可决定的事 —— 两个动作都是离开：
 * 「保存图片」（带着走）和「收下」（回结果页）。
 *
 * 【挂载点在 App.vue，不在 QuizOverlay 里】看着它像是结果页的一部分，
 * 但状态（reward.pending）比会话活得久：会话一关（`quiz.close()`），
 * 遮罩连同它内部的一切就卸载了，pending 还留着 —— 下次随便开个练习，
 * 陈年的奖励弹窗会跟着冒出来。挂到 App 上，弹窗的生死只由 store 决定。
 */
const reward = useRewardStore()

/** 正在保存中（防连点弹两个保存框） */
const saving = ref(false)

const id = computed(() => reward.pending?.id ?? null)
/** 打包后是 vite 哈希名，由 lib/gallery.ts 的 glob 认出来；认不出给 null（不摆裂图） */
const url = computed(() => (id.value ? rewardImageUrl(id.value) : null))
const name = computed(() => (id.value ? (GALLERY.TITLES[id.value] ?? id.value) : ''))
/** 图鉴进度：拿主进程合并后返回的那份现算，**不另存一份计数**（计数会漂） */
const have = computed(() =>
  reward.pending ? GALLERY_IDS.length - galleryRemaining(reward.pending.rewards.gallery) : 0
)

/** 取路径最后一段（保存成功的 toast 里显示文件名，全路径太长） */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

async function save() {
  const cur = id.value
  if (!cur || saving.value) return
  saving.value = true
  try {
    const res = await window.miai.saveRewardImage(cur)
    if (res.ok) toast(GALLERY.SAVED(baseName(res.path)), 'success')
    else if (res.reason === 'cancelled') toast(GALLERY.SAVE_CANCELLED, 'info')
    else toast(GALLERY.SAVE_FAILED, 'error')
  } catch {
    // IPC 本身抛（主进程没注册 / 参数被拒）—— 对用户是同一句"没存下来"
    toast(GALLERY.SAVE_FAILED, 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <MiModal
    :visible="reward.pending != null"
    :width="420"
    :title="id ? (reward.pending?.perfect ? GALLERY.REWARD_TITLE : GALLERY.REWARD_TITLE_DAILY) : GALLERY.ALL_TITLE"
    @update:visible="reward.dismiss()"
  >
    <div class="reward-body">
      <!-- 图库里认不出这个 id（表与文件对不上）时 url 为 null：只显示文字，
           不摆一张裂图 —— 那种"半坏"比说清情况更让人困惑 -->
      <img v-if="url" class="reward-img" :src="url" :alt="name" />
      <div v-if="name" class="reward-name">{{ name }}</div>
      <div v-else class="reward-all">{{ GALLERY.ALL_COLLECTED }}</div>
      <div class="reward-progress">{{ GALLERY.PROGRESS(have, GALLERY_IDS.length) }}</div>
    </div>
    <template #footer>
      <MiButton v-if="id" variant="secondary" :disabled="saving" @click="save">
        {{ GALLERY.SAVE_IMAGE }}
      </MiButton>
      <MiButton variant="primary" @click="reward.dismiss()">{{ GALLERY.CLOSE }}</MiButton>
    </template>
  </MiModal>
</template>

<style scoped>
.reward-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.reward-img {
  width: 100%;
  max-width: 320px;
  border-radius: var(--mi-radius);
  /* 图是白底画的，压在深色主题上时给一圈描边，免得像贴了一块白纸 */
  border: 1px solid var(--mi-border);
  display: block;
}
.reward-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--mi-text);
  /* 社区图包的名字是完整表情文案（最长 50+ 字），居中对齐避免折行后左飘 */
  max-width: 100%;
  text-align: center;
  line-height: 1.5;
}
.reward-all {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
  text-align: center;
}
.reward-progress {
  font-size: 12px;
  color: var(--mi-text-3);
}
</style>
