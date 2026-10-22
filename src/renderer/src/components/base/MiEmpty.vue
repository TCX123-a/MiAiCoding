<script setup lang="ts">
/**
 * 空状态：一张大肥鱼 + 一行主文案 + 一行解释。
 *
 * 【为什么图走 pose 而不是让调用方塞个 <MiMascot> 进来】
 * 调用方现在是 `v-bind="EMPTY.XXX"`，整组文案连图一起传。
 * 如果图改成插槽，7 个调用点每处都得多写四行模板，还会出现
 * 「有的空状态有图、有的忘了加」——空状态一多就没人看得出漏了哪个。
 * 走 props 则「有文案就有图」是结构上保证的。
 */
import { EMPTY } from '../../lib/copy'
import MiMascot from './MiMascot.vue'
import type { MascotPose, MascotSize } from '../../lib/mascot'

withDefaults(
  defineProps<{
    pose?: MascotPose
    size?: MascotSize
    text?: string
    subText?: string
  }>(),
  { ...EMPTY.DEFAULT, size: 'm' }
)
</script>

<template>
  <div class="mi-empty">
    <MiMascot :pose="pose" :size="size" />
    <div class="text">{{ text }}</div>
    <div v-if="subText" class="sub">{{ subText }}</div>
    <slot />
  </div>
</template>

<style scoped>
.mi-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  text-align: center;
}
/*
 * 批⑥（2026-10-16）：空态就两行短文案，断行上点心 —— 主句两头均衡，
 * 解释句不留孤字/孤标点（pretty 只动末行，长正文不适用，这儿正合适）。
 */
.text {
  font-size: 14px;
  color: var(--mi-text-2);
  text-wrap: balance;
}
.sub {
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.8;
  text-wrap: pretty;
}
</style>
