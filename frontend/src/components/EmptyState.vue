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
    <div v-if="$slots.default" class="empty-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-7) var(--space-5);
  gap: var(--space-3);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  max-width: 520px;
  margin: 0 auto;
  width: 100%;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--accent-gradient-soft);
  border: var(--border-width) solid var(--accent-100);
  color: var(--accent-500);
  margin-bottom: var(--space-1);
  box-shadow: var(--shadow-glow-soft);
}

.empty-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text);
}

.empty-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 380px;
  line-height: var(--leading-relaxed);
}

.empty-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
  width: 100%;
}
</style>
