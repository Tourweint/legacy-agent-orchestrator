<script setup>
// 思考过程折叠块 —— 界面方案 §3.1。
// 三层信息的中间一层：默认收起（**办不成时部分展开失败链**），点开看要点，再点一层才是完整留痕。
// 归并规则全部在 useThinking.js（纯函数、有单测）；这里只管展开/收起与排版，不新造任何文案。

import { computed, ref } from 'vue'
import { buildThinking, formatDuration } from '../composables/useThinking.js'
import ThinkingLine from './ThinkingLine.vue'
import TrajectoryItem from './TrajectoryItem.vue'
import { IconChevronDown, IconChevronRight } from '../icons/index.js'

const props = defineProps({
  events: { type: Array, default: () => [] },
  status: { type: String, default: 'idle' },
  cancelled: { type: Boolean, default: false },
  // 终态（DONE / REJECTED / FAILED / UNRESOLVED）：决定"要不要主动摊开过程"——
  // 办成了就收起（答案已在超大字号里），没办成才自动展开失败链。
  outcome: { type: String, default: null },
})

const thinking = computed(() =>
  buildThinking(props.events, { taskStatus: props.status, outcome: props.outcome }),
)

// 用户手动操作优先：动过一次之后不再自动变化——
// 读着读着界面自己收起来了，比"默认不展开"更糟。
const manual = ref(null)
const showAll = ref(false)
const showDetails = ref(false)

const expanded = computed(() =>
  manual.value === null ? thinking.value.defaultMode !== 'collapsed' : manual.value,
)
const fullView = computed(
  () => expanded.value && (showAll.value || thinking.value.defaultMode === 'full'),
)
const visibleLines = computed(() =>
  fullView.value ? thinking.value.lines : thinking.value.lines.filter((l) => l.focus),
)

const running = computed(() => props.status === 'running')
const suspended = computed(() => props.status === 'suspended')
const hasFailures = computed(() => props.status === 'terminal' && thinking.value.failCount > 0)

/** 运行中标题跟随当前阶段，让"它正在干什么"一眼可见。 */
const currentPhaseName = computed(() => {
  const last = props.events[props.events.length - 1]
  const phase = last?.phase ?? 'P6'
  return thinking.value.lines.find((l) => l.phase === phase)?.phaseName ?? '办理'
})

const title = computed(() => {
  const t = thinking.value
  if (running.value) return `正在办理 · ${currentPhaseName.value}`
  if (suspended.value) return `等待你补充信息 · 已走 ${t.steps} 步`
  if (props.cancelled) return `已停止 · 完成 ${t.steps} 步`
  // "为什么是这个结果"而不是"为什么没办成"：查询类同样会有不成立的命题，
  // 而那时用户要问的是"你凭什么这么答"，不是"哪里办错了"。
  if (hasFailures.value) return `为什么是这个结果 · ${t.failCount} 项不通过`
  return `思考过程 · ${t.steps} 步 · ${formatDuration(t.durationMs)}`
})

function toggle() {
  manual.value = !expanded.value
}
</script>

<template>
  <div v-if="thinking.steps > 0" class="thinking" :class="{ running, failed: hasFailures }">
    <button class="head" :aria-expanded="expanded" @click="toggle">
      <span class="chev" aria-hidden="true">
        <IconChevronDown v-if="expanded" :size="12" />
        <IconChevronRight v-else :size="12" />
      </span>
      <span class="title">{{ title }}</span>
      <span v-if="running" class="pulse-dot" aria-hidden="true"></span>
    </button>

    <div v-show="expanded" class="body">
      <ThinkingLine v-for="l in visibleLines" :key="`${l.phase}-${l.seq ?? l.text}`" :line="l" />

      <button v-if="!fullView && thinking.hiddenCount > 0" class="more" @click="showAll = true">
        其余 {{ thinking.hiddenCount }} 步
      </button>

      <button v-if="!showDetails" class="more" @click="showDetails = true">
        查看完整留痕（{{ thinking.details.length }} 条）
      </button>
      <div v-else class="details">
        <TrajectoryItem v-for="e in thinking.details" :key="e.seq" :event="e" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.thinking {
  margin: var(--space-2) 0;
}

.head {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: transparent;
  border: none;
  padding: 2px 0;
  border-radius: 0;
  cursor: pointer;
  color: var(--text-faint);
  font-size: var(--text-xs);
  font-family: inherit;
  transition: color var(--dur-fast) var(--ease-standard);
}

.head:hover {
  color: var(--text-muted);
}

.head:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 1px;
  border-radius: var(--radius-xs);
}

.chev {
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.title {
  font-weight: var(--weight-medium);
}

.running .head {
  color: var(--accent);
}

.failed .head {
  color: var(--status-danger);
}

.body {
  margin: var(--space-2) 0 var(--space-3);
  padding: 0 0 0 var(--space-5);
  background: transparent;
  border-radius: 0;
  border-left: none;
}

.more {
  display: block;
  background: transparent;
  border: none;
  padding: 3px 0;
  margin-top: 2px;
  color: var(--text-faint);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.more:hover {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.details {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
