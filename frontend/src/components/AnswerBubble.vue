<script setup>
// 答案卡（L1）—— 一轮对话里**唯一默认可见**的助手内容，也是这一轮的最终答话。
//
// 口径（2026-09-27）：答案**用大字给出**，且**只出现一次**——思考过程里不再重复结论
// （见 composables/useThinking.js 的 isAnswerEvent）。
// 结论文案来自引擎（result.conclusion / terminal 事件），本组件不新造句子：只把同一段文本
// 分成两层展示——主答话（用户要的答案）与"推算依据"（过程性说明，小字）。

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

/**
 * 引擎会把"推算依据"（§7.3 请确认）拼在结论末尾，如
 * "该时段不可用：… （请确认：今天是周日…；「上午」= 08:00–12:00…）"。
 * 那是过程性说明，不该抢大字的位置——拆成小字附注。不新造句子，只是分层展示。
 */
const parsed = computed(() => {
  const text = conclusion.value
  const m = /（请确认：([\s\S]+?)）\s*$/.exec(text)
  if (!m) return { main: text, notes: [] }
  return {
    main: text.slice(0, m.index).trim(),
    notes: m[1].split('；').map((s) => s.trim()).filter(Boolean),
  }
})

const steps = computed(() => result.value?.steps ?? null)
</script>

<template>
  <div v-if="kind" class="answer" :class="'is-' + kind">
    <div class="head">
      <span class="mark" aria-hidden="true">
        <IconCheck v-if="kind === 'done'" :size="14" class="ok" />
        <IconX v-else-if="kind === 'failed'" :size="14" class="bad" />
        <IconFlag v-else :size="14" class="warn" />
      </span>
      <span class="label">{{ LABELS[kind] }}</span>
      <span v-if="steps" class="steps mono">{{ steps }} 步</span>
    </div>

    <p class="text">{{ parsed.main }}</p>

    <div v-if="parsed.notes.length" class="notes">
      <div class="notes-label">推算依据（如有出入，请接着说一句更正）</div>
      <ul>
        <li v-for="(n, i) in parsed.notes" :key="i">{{ n }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.answer {
  margin: var(--space-3) 0 var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  border: var(--border-width) solid var(--border);
  border-left-width: 3px;
  background: var(--surface-1);
  box-shadow: var(--shadow-xs);
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
  margin-bottom: var(--space-2);
}

.mark {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  flex-shrink: 0;
}

.is-done .mark {
  background: var(--success-100);
}

.is-failed .mark {
  background: var(--danger-100);
}

.is-unsure .mark {
  background: var(--warning-100);
}

.is-cancelled .mark {
  background: var(--surface-2);
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

/* 大字答案：这是用户要的那句话，值得用整个卡片的视觉重心去承载 */
.text {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-medium);
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.notes {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border);
}

.notes-label {
  font-size: var(--text-xs);
  color: var(--text-faint);
  margin-bottom: var(--space-1);
}

.notes ul {
  margin: 0;
  padding-left: 1.1em;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

@media (max-width: 480px) {
  .answer {
    padding: var(--space-3);
  }

  .text {
    font-size: var(--text-lg);
  }
}
</style>
