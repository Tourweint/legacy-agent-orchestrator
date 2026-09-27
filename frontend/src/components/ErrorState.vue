<script setup>
import { IconAlert } from '../icons/index.js'

defineProps({
  title: { type: String, default: '出错了' },
  message: { type: String, default: '' },
  showRetry: { type: Boolean, default: true },
  retryText: { type: String, default: '重试' },
})

defineEmits(['retry'])
</script>

<template>
  <div class="error-state" role="alert">
    <div class="error-icon" aria-hidden="true">
      <IconAlert :size="24" />
    </div>
    <div class="error-content">
      <div class="error-title">{{ title }}</div>
      <div v-if="message" class="error-message">{{ message }}</div>
    </div>
    <button v-if="showRetry" class="btn btn-danger btn-sm" @click="$emit('retry')">
      {{ retryText }}
    </button>
  </div>
</template>

<style scoped>
.error-state {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--danger-50);
  border: var(--border-width) solid var(--danger-200);
  border-radius: var(--radius-small);
  margin-bottom: var(--space-3);
}

.error-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--danger-100);
  color: var(--danger-600);
  flex-shrink: 0;
}

.error-content {
  flex: 1;
  min-width: 0;
}

.error-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--danger-700);
  margin-bottom: 2px;
}

.error-message {
  font-size: var(--text-xs);
  color: var(--danger-600);
  line-height: var(--leading-normal);
  word-break: break-word;
}
</style>
