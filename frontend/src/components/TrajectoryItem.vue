<script setup>
import { computed, ref } from 'vue'
import { useTaskStore } from '../stores/task.js'
<<<<<<< HEAD
import { useGlossaryStore } from '../stores/glossary.js'
=======
import { IconCheck, IconX, IconFlag, IconAlert, IconSpinner } from '../icons/index.js'
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2

const props = defineProps({ event: { type: Object, required: true } })
const store = useTaskStore()
const glossary = useGlossaryStore()
const expanded = ref(false)

// 身份的中文展示（§2.2：身份必须可见；不出现接口 URL/参数名）
const IDENTITY_NAMES = { ADMIN: '管理端身份', TEACHER: '教师身份', STUDENT: '学生身份' }

// 接口的业务语义名（展示用；参数名/URL 禁止出现）
const INTERFACE_NAMES = {
  'auth.login': '登录换取凭证',
  'edu.classroom.detail': '查询教室详情',
  'edu.classroom.available': '按楼栋筛选候选教室',
  'edu.classroom.seats': '查询座位布局',
  'edu.classroom.reservedSeats': '查询该时段座位占用',
  'logi.maintenance.list': '查询维修窗口',
  'edu.reservation.classroom.create': '提交教室预约',
  'edu.reservation.seat.create': '提交座位预约',
  'edu.reservation.mine': '查询我的预约',
  'edu.reservation.cancel': '撤销预约',
  'logi.reservation.list': '查询全量预约（跨身份）',
  'logi.maintenance.create': '创建维修窗口（演示工具）',
}

// 事实/命题/规则的人话名不在这里写死：唯一来源是引擎的术语对照表（stores/glossary.js），
// 查不到时它原样返回编号——比在界面里维护第二份映射诚实。

const entry = computed(() => {
  const seq = Number.parseInt(String(props.event.evidenceRef).split(':')[1], 10)
  return store.entriesBySeq[seq] ?? null
})

const identity = computed(() => {
  const id = entry.value?.metadata?.identity
  return id ? (IDENTITY_NAMES[id] ?? id) : null
})

const callName = computed(() => {
  const action = entry.value?.action ?? ''
  return action.startsWith('contact:')
    ? (INTERFACE_NAMES[action.slice('contact:'.length)] ?? action)
    : null
})

// 依据芯片：说清"这条结论是凭什么下的"——用业务语义，不出现内部编号（零术语 P1-3）
const basisChips = computed(() => {
  const basis = entry.value?.basis ?? []
  return basis
    .filter((b) => b.fact || b.proposition || b.rule)
    .map((b) =>
      b.fact
<<<<<<< HEAD
        ? `依据 · ${glossary.factName(b.fact)}`
        : b.proposition
          ? `判定 · ${glossary.propositionName(b.proposition)}`
          : `处理规则 · ${glossary.ruleName(b.rule)}`,
=======
        ? `事实 ${FACT_NAMES[b.fact] ?? b.fact}`
        : b.proposition
          ? `命题 ${b.proposition}`
          : `规则 ${b.rule}`
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2
    )
})

const injected = computed(() => entry.value?.metadata?.injected === true)

function displayText(event) {
  if (event.type === 'call' && callName.value) return `${callName.value} · ${event.text}`
  if (event.type === 'fact-collected') return event.text
  if (event.type === 'uncertain') return event.text
  return event.text
}

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
      <span class="text" :title="event.text">{{ displayText(event) }}</span>
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
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  border: var(--border-width) solid var(--border);
  color: var(--text-muted);
  background: var(--surface);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.chip.identity {
  color: var(--accent);
  border-color: var(--accent-200);
  background: var(--accent-50);
}

.chip.injected {
  color: var(--status-uncertain);
  border-color: var(--status-uncertain);
  background: var(--status-uncertain-weak);
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
