<script setup>
import { IconSearch } from '../icons/index.js'

defineProps({
  icon: { type: Object, default: () => IconSearch },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
})
</script>

<template>
  <div class="empty-state" role="status" aria-live="polite">
    <div class="empty-icon" aria-hidden="true">
      <component :is="icon" :size="34" :stroke-width="1.5" />
    </div>
    <div v-if="title" class="empty-title">{{ title }}</div>
    <div v-if="description" class="empty-desc">{{ description }}</div>
    <slot />
  </div>
</template>

<style scoped>
/* 空态 = 纯文本引导（2026-09-27 重做）：去掉虚线卡片与渐变图标圆底——
   用户基调"不需要边界、简约大气"，留白与字号层级承担层级，
   图标退成淡蓝线条，标题 22px 加粗、说明 12px 浅灰，一眼分清主次。 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  /* margin auto：在消息区（flex column）里垂直+水平居中，空态是页面主角不是卡片 */
  margin: auto;
  padding: var(--space-6) var(--space-4);
  gap: var(--space-2);
}

.empty-icon {
  display: grid;
  place-items: center;
  color: var(--accent-500);
  margin-bottom: var(--space-3);
}

.empty-title {
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  color: var(--text);
}

.empty-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 340px;
  line-height: var(--leading-relaxed);
}
</style>
