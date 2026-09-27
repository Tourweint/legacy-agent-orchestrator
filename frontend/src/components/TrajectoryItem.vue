<script setup>
import { computed, ref } from 'vue'
import { useTaskStore } from '../stores/task.js'
import { useGlossaryStore } from '../stores/glossary.js'
import { identityName } from '../constants/display-names.js'
import { IconCheck, IconX, IconFlag, IconAlert, IconSpinner } from '../icons/index.js'

const props = defineProps({ event: { type: Object, required: true } })
const store = useTaskStore()
const glossary = useGlossaryStore()
const expanded = ref(false)

// 接口业务语义名与身份显示名：与要点行、答案气泡**共用同一份**（constants/display-names.js）——
// 它们原本长在这里，现在三个组件都要用，放一处才不会互相漂移。
// 事实/命题/规则的人话名不在这里写死：唯一来源是引擎的术语对照表（stores/glossary.js），
// 查不到时它原样返回编号——比在界面里维护第二份映射诚实。

const entry = computed(() => {
  const seq = Number.parseInt(String(props.event.evidenceRef).split(':')[1], 10)
  return store.entriesBySeq[seq] ?? null
})

const identity = computed(() => identityName(entry.value?.metadata?.identity))

// 接口的业务语义名不再在这里拼：事件流已把"提交教室预约 · 系统拒绝了这次提交"整句给到
// （引擎从接口注册表派生，见 orchestrator/src/access/event-stream.js），界面直接用 event.text。

// 依据芯片：说清"这条结论是凭什么下的"——用业务语义，不出现内部编号（零术语 P1-3）
const basisChips = computed(() => {
  const basis = entry.value?.basis ?? []
  return basis
    .filter((b) => b.fact || b.proposition || b.rule)
    .map((b) =>
      b.fact
        ? `依据 · ${glossary.factName(b.fact)}`
        : b.proposition
          ? `判定 · ${glossary.propositionName(b.proposition)}`
          : `处理规则 · ${glossary.ruleName(b.rule)}`,
    )
})

const injected = computed(() => entry.value?.metadata?.injected === true)

function timeOf(event) {
  // 绝对时刻 → 展示层单向转本地（只取时分秒）
  const d = new Date(event.at)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function toggleExpand() {
  expanded.value = !expanded.value
  if (expanded.value && store.taskId) {
    await store.ensureEvidence(store.taskId)
  }
}
</script>

<template>
  <div class="item" :class="'st-' + event.status">
    <div class="row" role="button" tabindex="0" @click="toggleExpand" @keydown.enter="toggleExpand">
      <span class="mark" aria-hidden="true">
        <IconSpinner v-if="event.status === 'running'" :size="12" class="spin-icon" />
        <IconCheck v-else-if="event.status === 'done'" :size="12" class="ok" />
        <IconX v-else-if="event.status === 'failed'" :size="12" class="bad" />
        <IconFlag v-else-if="event.status === 'uncertain'" :size="12" class="pulse-icon" />
        <span v-else class="neutral">–</span>
      </span>
      <span class="text" :title="event.text">{{ event.text }}</span>
      <span v-if="identity" class="chip identity">{{ identity }}</span>
      <span v-if="injected" class="chip injected" title="本次运行包含故障注入">
        <IconAlert :size="10" />
        注入
      </span>
      <span class="time mono muted">{{ timeOf(event) }}</span>
    </div>

    <div v-if="basisChips.length" class="chips">
      <span v-for="(c, i) in basisChips" :key="i" class="chip basis">{{ c }}</span>
    </div>

    <pre v-if="expanded && entry" class="raw mono">{{
      JSON.stringify({ input: entry.input, metadata: entry.metadata, basis: entry.basis }, null, 2)
    }}</pre>
  </div>
</template>

<style scoped>
.item {
  padding: var(--space-1) 0;
}

.row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-xs);
  transition: background-color var(--dur-fast) var(--ease-standard);
}

.row:hover {
  background: var(--surface-2);
}

.row:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 1px;
}

.mark {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
  display: grid;
  place-items: center;
}

.ok {
  color: var(--status-success);
}

.bad {
  color: var(--status-danger);
}

.neutral {
  color: var(--text-faint);
  font-size: var(--text-xs);
}

.spin-icon {
  color: var(--accent);
  animation: spin 0.9s linear infinite;
}

.pulse-icon {
  color: var(--status-uncertain);
  animation: pulse 1.2s var(--ease-standard) infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

.text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}

.st-uncertain .text {
  color: var(--status-uncertain);
}

.st-failed .text {
  color: var(--status-danger);
}

.chips {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
  margin: var(--space-1) 0 0 24px;
}

.chip {
  font-size: var(--text-xs);
  padding: 0;
  border-radius: 0;
  border: none;
  color: var(--text-faint);
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.chip.identity {
  color: var(--accent);
}

.chip.injected {
  color: var(--status-uncertain);
  font-weight: var(--weight-semibold);
}

.time {
  flex-shrink: 0;
  font-size: var(--text-xs);
}

.raw {
  margin: var(--space-2) 0 0 24px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-small);
  overflow-x: auto;
  max-height: 220px;
  font-size: var(--text-xs);
}
</style>
