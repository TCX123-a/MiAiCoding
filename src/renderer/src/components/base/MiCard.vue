<script setup lang="ts">
defineProps<{
  title?: string
  padding?: string
}>()
</script>

<template>
  <div class="mi-card" :style="padding ? { padding } : undefined">
    <div v-if="title || $slots.extra" class="mi-card-head">
      <div class="mi-card-title">{{ title }}</div>
      <div class="mi-card-extra"><slot name="extra" /></div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.mi-card {
  /* glass 令牌：壁纸关时 = --mi-card 逐字节相同；壁纸开时按 --mi-panel-alpha 稀释。
     机制与硬底线边界见 tokens.css 玻璃层那段。字还是实心的 —— 只动了这一行底。 */
  background: var(--mi-card-glass);
  border-radius: var(--mi-radius);
  box-shadow: var(--mi-shadow);
  padding: 16px;
}
.mi-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.mi-card-title {
  font-size: 15px;
  font-weight: 600;
}
.mi-card-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
