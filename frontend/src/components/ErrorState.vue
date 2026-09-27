<script setup>
import { IconAlert } from '../icons/index.js'

defineProps({
  title: { type: String, default: '出错了' },
  message: { type: String, default: '' },
  showRetry: { type: Boolean, default: true },
  retryText: { type: String, default: '重试' },
  suggestions: { type: Array, default: () => [] },
  helpText: { type: String, default: '' },
  helpHref: { type: String, default: '#' },
})

defineEmits(['retry', 'suggest'])
</script>

<template>
  <div class="error-state" role="alert">
    <div class="error-icon" aria-hidden="true">
      <IconAlert :size="24" />
    </div>
    <div class="error-content">
      <div class="error-title">{{ title }}</div>
      <div v-if="message" class="error-message">{{ message }}</div>

      <!-- 建议话术：用户可以直接点击，不用自己重新组织语言 -->
      <div v-if="suggestions.length" class="error-suggestions">
        <span class="suggest-label">你可以试试：</span>
        <div class="suggest-chips">
          <button
            v-for="s in suggestions"
            :key="s"
            class="suggest-chip"
            type="button"
            @click="$emit('suggest', s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <!-- 帮助链接 -->
      <a v-if="helpText" :href="helpHref" class="error-help" target="_blank" rel="noopener">
        {{ helpText }}
      </a>
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

.error-suggestions {
  margin-top: var(--space-2);
}

.suggest-label {
  display: block;
  font-size: 10px;
  color: var(--danger-500);
  margin-bottom: 4px;
  font-weight: var(--weight-medium);
}

.suggest-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggest-chip {
  padding: 3px 10px;
  border: 1px solid var(--danger-200);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--danger-700);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}

.suggest-chip:hover {
  background: var(--danger-50);
  border-color: var(--danger-300);
}

.suggest-chip:active {
  transform: scale(0.95);
}

.error-help {
  display: inline-block;
  margin-top: var(--space-2);
  font-size: 11px;
  color: var(--danger-600);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.error-help:hover {
  color: var(--danger-700);
}
</style>
