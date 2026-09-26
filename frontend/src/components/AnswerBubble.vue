<script setup>
// 核心输出（L1）—— 一轮对话里**唯一默认可见**的助手内容。
// 判据（界面方案 §1.2）：会不会改变用户下一步的动作？会 → 就在这里。
// 结论文案来自引擎（result.conclusion / terminal 事件），本组件不新造句子。

import { computed } from 'vue'
import { IconCheck, IconX, IconFlag } from '../icons/index.js'

const props = defineProps({
  turn: { type: Object, required: true },
})

const result = computed(() => props.turn?.result ?? null)
const terminalEvent = computed(
  () => props.turn?.events?.find((e) => e.type === 'terminal') ?? null,
)

/** done | failed | unsure | cancelled | null（未终态就不渲染） */
const kind = computed(() => {
  if (props.turn?.cancelled) return 'cancelled'
  const t = result.value?.terminal
  if (!t) return terminalEvent.value ? 'done' : null
  if (t === 'DONE') return 'done'
  if (t === 'UNRESOLVED') return 'unsure'
  return 'failed'
})

const LABELS = { done: '已办成', failed: '没能办成', unsure: '结果待确认', cancelled: '已取消' }

const conclusion = computed(() => result.value?.conclusion ?? terminalEvent.value?.text ?? '')
const steps = computed(() => result.value?.steps ?? null)
</script>

<template>
  <div v-if="kind" class="answer" :class="'is-' + kind">
    <div class="head">
      <span class="mark" aria-hidden="true">
        <IconCheck v-if="kind === 'done'" :size="13" class="ok" />
        <IconX v-else-if="kind === 'failed'" :size="13" class="bad" />
        <IconFlag v-else :size="13" class="warn" />
      </span>
      <span class="label">{{ LABELS[kind] }}</span>
      <span v-if="steps" class="steps mono">{{ steps }} 步</span>
    </div>
    <p class="text">{{ conclusion }}</p>
  </div>
</template>

<style scoped>
.answer {
  margin: var(--space-3) 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-medium);
  border: var(--border-width) solid var(--border);
  border-left-width: 3px;
  background: var(--surface-1);
}

.is-done {
  border-left-color: var(--status-success);
}

.is-failed {
  border-left-color: var(--status-danger);
}

.is-unsure {
  border-left-color: var(--status-uncertain);
}

.is-cancelled {
  border-left-color: var(--text-faint);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.mark {
  display: grid;
  place-items: center;
}

.ok {
  color: var(--status-success);
}

.bad {
  color: var(--status-danger);
}

.warn {
  color: var(--status-uncertain);
}

.label {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.steps {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-faint);
}

.is-cancelled .label,
.is-cancelled .text {
  color: var(--text-muted);
}

.text {
  margin: 0;
  font-size: var(--text-md);
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
