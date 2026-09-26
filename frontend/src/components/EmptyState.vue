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
      <component :is="icon" :size="32" :stroke-width="1.5" />
    </div>
    <div v-if="title" class="empty-title">{{ title }}</div>
    <div v-if="description" class="empty-desc">{{ description }}</div>
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-6) var(--space-4);
  gap: var(--space-2);
  border: var(--border-width) dashed var(--border);
  border-radius: var(--radius-card);
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-faint);
  margin-bottom: var(--space-1);
}

.empty-title {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--text);
}

.empty-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 280px;
  line-height: var(--leading-relaxed);
}
</style>
