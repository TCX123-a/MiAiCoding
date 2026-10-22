<script setup lang="ts">
defineProps<{
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'gray' | 'purple'
  size?: 'sm' | 'md'
}>()
</script>

<template>
  <span class="mi-tag" :class="[color ?? 'blue', size ?? 'sm']"><slot /></span>
</template>

<style scoped>
.mi-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
.sm {
  padding: 3px 10px;
}
.md {
  padding: 5px 14px;
  font-size: 13px;
}
.blue {
  background: var(--mi-blue-light);
  color: var(--mi-text);
}
/*
 * 这三个标签的绿/红/黄，原来**是自己另写的一套色**（#2e8b57 / #c0504d / #9a7b2d），
 * 和 --mi-success/error/warn 那套毫无关系 —— 于是同一个「绿」在软件里有两种，
 * 而且这三个都卡在 4.2 上下，全都不达标（主人要的「全局达标」正好兜住它们）。
 * 现在并进功能色：**底用浅档、字用深档**，和软件里别处的绿红黄是同一个绿红黄。
 * 底色的 rgba 也换成 color-mix(var(--mi-success) ...)，免得令牌改了这个不跟着改。
 */
.green {
  background: color-mix(in srgb, var(--mi-success) 20%, transparent);
  color: var(--mi-success-deep);
}
.red {
  background: color-mix(in srgb, var(--mi-error) 20%, transparent);
  color: var(--mi-error-deep);
}
.yellow {
  background: color-mix(in srgb, var(--mi-warn) 30%, transparent);
  color: var(--mi-warn-deep);
}
.gray {
  /* 原先是写死的 #eef2f6。改用 --mi-zebra —— 它就是「比纸面略深一点的普通底色」
     那一支，浅色 #f4f8fd（和 #eef2f6 差一丝，肉眼分不出）、深色 #151c25。 */
  background: var(--mi-zebra);
  color: var(--mi-text-2);
}
/* 阶段标签（入门/进阶/精通）用它。
   补这四行的原因：LessonDetailView 一直在传 color="purple"，但 MiTag 只认
   blue/green/red/yellow/gray——运行时不会报错，只是渲染成一个没有底色、
   没有文字颜色的裸标签，挂在每一节课的标题旁边。
   属于「类型检查盖不到 .vue」漏掉的那一类，2026-09-13 随 vue-tsc 一起补上。 */
.purple {
  background: color-mix(in srgb, var(--mi-purple) 22%, transparent);
  color: var(--mi-purple-ink);
}
</style>
