<script setup>
defineProps({
  rows: { type: Number, default: 3 },
  showHeader: { type: Boolean, default: true },
})
</script>

<template>
  <div class="skeleton-loader" aria-busy="true" aria-label="加载中">
    <div v-if="showHeader" class="skeleton-header">
      <div class="skeleton-block skeleton-title"></div>
      <div class="skeleton-block skeleton-subtitle"></div>
    </div>
    <div class="skeleton-rows">
      <div v-for="i in rows" :key="i" class="skeleton-row">
        <div class="skeleton-block skeleton-dot"></div>
        <div class="skeleton-block skeleton-text"></div>
        <div class="skeleton-block skeleton-time"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-loader {
  padding: var(--space-2) 0;
}

.skeleton-header {
  margin-bottom: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.skeleton-block {
  background: var(--surface-2);
  border-radius: var(--radius-small);
  position: relative;
  overflow: hidden;
}

.skeleton-block::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, var(--gray-100) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s var(--ease-standard) infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.skeleton-title {
  width: 120px;
  height: 16px;
}

.skeleton-subtitle {
  width: 200px;
  height: 12px;
}

.skeleton-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skeleton-text {
  flex: 1;
  height: 14px;
}

.skeleton-time {
  width: 48px;
  height: 12px;
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-block::after {
    animation: none;
  }
}
</style>
