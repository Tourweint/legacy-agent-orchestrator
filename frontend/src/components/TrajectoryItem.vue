<script setup>
import { computed, ref } from 'vue'
import { useTaskStore } from '../stores/task.js'

const props = defineProps({ event: { type: Object, required: true } })
const store = useTaskStore()
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

const FACT_NAMES = {
  F1: '教室详情',
  F2: '座位布局',
  F3: '时段座位占用',
  F4: '跨身份预约列表',
  F5: '我的预约',
  F6: '维修窗口',
}

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
  return action.startsWith('contact:') ? (INTERFACE_NAMES[action.slice('contact:'.length)] ?? action) : null
})

const basisChips = computed(() => {
  const basis = entry.value?.basis ?? []
  return basis
    .filter((b) => b.fact || b.proposition || b.rule)
    .map((b) => (b.fact ? `事实 ${FACT_NAMES[b.fact] ?? b.fact}` : b.proposition ? `命题 ${b.proposition}` : `规则 ${b.rule}`))
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
    <div class="row" @click="toggleExpand">
      <span class="mark" aria-hidden="true">
        <span v-if="event.status === 'running'" class="spin"></span>
        <span v-else-if="event.status === 'done'" class="ok">✓</span>
        <span v-else-if="event.status === 'failed'" class="bad">✗</span>
        <span v-else-if="event.status === 'uncertain'" class="pulse"></span>
        <span v-else class="neutral">–</span>
      </span>
      <span class="text" :title="event.text">{{ displayText(event) }}</span>
      <span v-if="identity" class="chip identity">{{ identity }}</span>
      <span v-if="injected" class="chip injected" title="本次运行包含故障注入">⚠ 注入</span>
      <span class="time mono muted">{{ timeOf(event) }}</span>
    </div>

    <div v-if="basisChips.length" class="chips">
      <span v-for="(c, i) in basisChips" :key="i" class="chip basis">{{ c }}</span>
    </div>

    <pre v-if="expanded && entry" class="raw mono">{{ JSON.stringify({ input: entry.input, metadata: entry.metadata, basis: entry.basis }, null, 2) }}</pre>
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
}

.mark {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.ok {
  color: var(--status-success);
}

.bad {
  color: var(--status-danger);
}

.neutral {
  color: var(--text-faint);
}

.spin,
.pulse {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.spin {
  border: 2px solid var(--text-faint);
  border-top-color: var(--accent);
  animation: rotate 0.9s linear infinite;
}

.pulse {
  background: var(--status-uncertain);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes rotate {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
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
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  border: var(--border-width) solid var(--border);
  color: var(--text-muted);
  background: var(--surface);
}

.chip.identity {
  color: var(--accent);
  border-color: var(--accent);
}

.chip.injected {
  color: var(--status-uncertain);
  border-color: var(--status-uncertain);
  font-weight: 600;
}

.time {
  flex-shrink: 0;
}

.raw {
  margin: var(--space-2) 0 0 24px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-small);
  overflow-x: auto;
  max-height: 220px;
  font-size: 11px;
}
</style>
