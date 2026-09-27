<script setup>
// 一条 L2 要点行 —— "思考过程"展开后看到的就是它。
// 文案全部来自事件自带的 text（引擎产出的 `人话`），本组件只负责排版与状态符号。

import { IconCheck, IconX, IconFlag } from '../icons/index.js'

defineProps({
  line: { type: Object, required: true },
})
</script>

<template>
  <div class="line" :class="'st-' + line.status">
    <span class="phase mono">{{ line.phaseName }}</span>
    <span class="mark" aria-hidden="true">
      <IconCheck v-if="line.status === 'done'" :size="11" class="ok" />
      <IconX v-else-if="line.status === 'failed'" :size="11" class="bad" />
      <IconFlag
        v-else-if="line.status === 'uncertain' || line.status === 'unavailable'"
        :size="11"
        class="warn"
      />
      <span v-else class="neutral">·</span>
    </span>
    <span class="text">{{ line.text }}</span>
  </div>
</template>

<style scoped>
.line {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 3px 0;
  font-size: var(--text-xs);
  line-height: 1.6;
}

.phase {
  width: 2.4em;
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: 11px;
}

.mark {
  width: 12px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  align-self: center;
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

.neutral {
  color: var(--text-faint);
}

.text {
  color: var(--text-muted);
  min-width: 0;
}

.st-failed .text,
.st-uncertain .text,
.st-unavailable .text {
  color: var(--text);
}
</style>
