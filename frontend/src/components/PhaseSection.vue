<script setup>
import TrajectoryItem from './TrajectoryItem.vue'
import { IconChevronDown, IconChevronRight } from '../icons/index.js'

defineProps({
  phaseKey: { type: String, required: true },
  phaseName: { type: String, required: true },
  phaseHint: { type: String, default: '' },
  events: { type: Array, default: () => [] },
  collapsed: { type: Boolean, default: false },
  isRunning: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle'])
</script>

<template>
  <div class="phase" :class="{ collapsed }">
    <button class="phase-head" :aria-expanded="!collapsed" @click="emit('toggle')">
      <span class="phase-chevron" aria-hidden="true">
        <IconChevronDown v-if="!collapsed" :size="12" />
        <IconChevronRight v-else :size="12" />
      </span>
      <span class="phase-key mono">{{ phaseKey }}</span>
      <span class="phase-name">{{ phaseName }}</span>
      <span class="phase-hint muted">{{ phaseHint }}</span>
      <span class="count muted">{{ events.length }}</span>
    </button>
    <Transition name="phase-expand">
      <div v-show="!collapsed" class="items">
        <div v-if="events.length === 0" class="muted item-empty">
          {{ isRunning ? '进行中……' : '—' }}
        </div>
        <TrajectoryItem
          v-for="(e, idx) in events"
          :key="e.seq"
          :event="e"
          :style="{ animationDelay: `${idx * 30}ms` }"
          class="animate-item-in"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.phase {
  margin-bottom: var(--space-4);
}

.phase-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-align: left;
  background: transparent;
  border: none;
  padding: var(--space-2) 0;
  cursor: pointer;
  border-radius: var(--radius-small);
  transition: background-color var(--dur-fast) var(--ease-standard);
}

.phase-head:hover {
  background: var(--surface-2);
}

.phase-head:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 2px;
}

.phase-chevron {
  display: grid;
  place-items: center;
  color: var(--text-faint);
  transition: transform var(--dur-fast) var(--ease-standard);
  flex-shrink: 0;
}

.phase-key {
  color: var(--accent);
  font-weight: var(--weight-semibold);
  font-size: var(--text-xs);
}

.phase-name {
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
}

.phase-hint {
  font-size: var(--text-xs);
  flex: 1;
}

.count {
  font-size: var(--text-xs);
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  min-width: 20px;
  text-align: center;
}

.items {
  border-left: 2px solid var(--border);
  margin-left: 14px;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.item-empty {
  font-size: var(--text-xs);
  padding: var(--space-1) 0;
}

/* 阶段折叠过渡 */
.phase-expand-enter-active,
.phase-expand-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    max-height var(--dur-slow) var(--ease-standard);
  overflow: hidden;
}

.phase-expand-enter-from,
.phase-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.phase-expand-enter-to,
.phase-expand-leave-from {
  max-height: 2000px;
}

/* ========== 响应式 ========== */

@media (max-width: 768px) {
  .phase-hint {
    display: none;
  }
}

@media (max-width: 480px) {
  .items {
    margin-left: 10px;
    padding-left: var(--space-3);
  }

  .phase-name {
    font-size: var(--text-xs);
  }
}
</style>
