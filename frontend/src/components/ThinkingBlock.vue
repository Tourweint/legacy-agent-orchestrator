<script setup>
// 思考过程折叠块 —— 界面方案 §3.1。
// 三层信息的中间一层：默认收起（**办不成时部分展开失败链**），点开看要点，再点一层才是完整留痕。
// 归并规则全部在 useThinking.js（纯函数、有单测）；这里只管展开/收起与排版，不新造任何文案。

import { computed, ref, watch } from 'vue'
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

// 终态一到就**强制回到默认展开态**（办成→收起、没办成→部分展开失败链）：
// 运行中"思考"随事件流慢慢展开，**结束后必须自动收起来**（2026-09-27 用户口径）——
// 不沿用运行中遗留的手动展开状态（那会让终态看起来"收不起来"）。
watch(
  () => props.status,
  (st, prev) => {
    if (st === 'terminal' && prev !== 'terminal') manual.value = null
  },
)

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
  // 像 AI 聊天软件：收起时只露一个"思考"，点开才看到细节与标题（2026-09-27）
  if (!expanded.value) return '思考'
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
        <IconChevronDown v-if="expanded" :size="14" />
        <IconChevronRight v-else :size="14" />
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
/* 思考折叠块：与下方答案贴得近（用户口径：间距不要太大）。
   消息列表 flex gap 为 12px，这里用负 margin 抵消掉大部分，
   让思考紧贴下方正文（净距约 4px）；外层统一淡灰半透明，
   运行中/失败**都不改外层颜色**——红色只允许出现在内部失败行。 */
.thinking {
  margin: 0 0 calc(4px - var(--space-3));
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
  color: rgba(107, 114, 128, 0.55);
  font-size: var(--text-base);
  font-family: inherit;
  transition: color var(--dur-fast) var(--ease-standard);
}

.head:hover {
  color: rgba(107, 114, 128, 0.85);
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

.body {
  margin: var(--space-1) 0 var(--space-2);
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
