<script setup>
// 思考过程折叠块 —— 界面方案 §3.1。
// 三层信息的中间一层：默认收起（**办不成时部分展开失败链**），点开看要点，再点一层才是完整留痕。
// 归并规则全部在 useThinking.js（纯函数、有单测）；这里只管展开/收起与排版，不新造任何文案。

import { computed, ref, watch } from 'vue'
import { buildThinking, formatDuration } from '../composables/useThinking.js'
import ThinkingGroup from './ThinkingGroup.vue'
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
// 可见行：全览 → 全部；否则只显示焦点行（失败链/不确定）。
// 兜底：焦点行为空时（如旧版历史会话缓存的事件没有 focus 行）退回全部行，
// 避免"展开后只见按钮不见内容"。
const visibleLines = computed(() => {
  const all = thinking.value.lines
  if (fullView.value) return all
  const focused = all.filter((l) => l.focus)
  return focused.length > 0 ? focused : all
})

const running = computed(() => props.status === 'running')
const suspended = computed(() => props.status === 'suspended')
const hasFailures = computed(() => props.status === 'terminal' && thinking.value.failCount > 0)

// 标题口径（2026-09-27 用户拍板）："思考"二字不动，只加耗时——
// 展开/收起都是"思考 · N 秒"（运行中秒数实时涨，不再显示阶段名/失败数，
// 因为具体步骤展开后直接可见，标题保持简短）。没有耗时数据（如历史会话缓存）
// 时只显示"思考"，不出现"思考 · 0 秒"。
const headTitle = computed(() => {
  const ms = thinking.value.durationMs
  return ms > 0 ? `思考 · ${formatDuration(ms)}` : '思考'
})

// 中间过程按类型分两小节（书式展开的"两个小部分"）：
//   · "思考了什么"：理解 / 判定 / 结果判断（decision / proposition-judged / uncertain）
//   · "执行了什么"：对存量系统的调用（call）
// 按行自带 type 分组（不按阶段——查询类调用常发生在判定阶段，仍属"执行"），
// 分组在 visibleLines（焦点行/全部行）之后做，保持原顺序。
const thinkLines = computed(() => visibleLines.value.filter((l) => l.type !== 'call'))
// 执行组行隐藏事件阶段名（调用常发生在判定阶段，"判定 ✔ 调用 3 次"既重复又违和），
// 行首直接是状态符号 + 文本；文本本身已说明动作。
const execLines = computed(() =>
  visibleLines.value
    .filter((l) => l.type === 'call')
    .map((l) => ({ ...l, phaseName: '' })),
)

function toggle() {
  manual.value = !expanded.value
}
</script>

<template>
  <div v-if="thinking.steps > 0" class="thinking" :class="{ running, failed: hasFailures }">
    <button class="head" :aria-expanded="expanded" @click="toggle">
      <span class="title">{{ headTitle }}</span>
      <span v-if="running" class="pulse-dot" aria-hidden="true"></span>
      <span class="chev" aria-hidden="true">
        <IconChevronDown v-if="expanded" :size="14" />
        <IconChevronRight v-else :size="14" />
      </span>
    </button>

    <Transition name="expand">
      <div v-show="expanded" class="body">
        <div class="body-inner">
          <ThinkingGroup title="思考了什么" :lines="thinkLines" />
          <ThinkingGroup title="执行了什么" :lines="execLines" />

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
    </Transition>
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

/* 小箭头在右侧（2026-09-27 用户口径）：标题与脉冲点在左，chevron 殿后 */
.chev {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  margin-left: 2px;
}

.title {
  font-weight: var(--weight-medium);
}

/* 展开/收起动画：高度 0 ↔ 自适应 + 淡入淡出，约 200ms 平滑滑开/收拢。
   grid-template-rows 过渡对"内容高度不固定"也自适应（再展开"其余 N 步/完整留痕"
   不会跳变）；内层 overflow hidden 是 0fr 折叠的必要条件。 */
.body {
  display: grid;
  grid-template-rows: 1fr;
  margin: var(--space-1) 0 var(--space-2);
  padding: 0 0 0 var(--space-5);
  background: transparent;
  border-radius: 0;
  border-left: none;
}

.body-inner {
  overflow: hidden;
  min-height: 0;
}

.expand-enter-active,
.expand-leave-active {
  transition:
    grid-template-rows var(--dur-base) var(--ease-standard),
    opacity var(--dur-base) var(--ease-standard);
}

.expand-enter-from,
.expand-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .expand-enter-active,
  .expand-leave-active,
  .line-enter-active {
    transition: none;
  }
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
