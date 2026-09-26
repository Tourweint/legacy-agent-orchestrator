<script setup>
import { computed, ref } from 'vue'
import { PHASES, useTaskStore } from '../stores/task.js'
import { useCopy } from '../composables/useCopy.js'
import ResultCard from './ResultCard.vue'
import PhaseSection from './PhaseSection.vue'
import EmptyState from './EmptyState.vue'
import SkeletonLoader from './SkeletonLoader.vue'
import { IconCopy, IconCheck } from '../icons/index.js'

const store = useTaskStore()
const { copied, copy } = useCopy()
// 折叠规则（§2.2）：默认展开 P1–P4，P5/P6 折叠
const collapsed = ref({ P1: false, P2: false, P3: false, P4: false, P5: true, P6: true })

const hasTask = computed(() => store.taskId !== null)
const terminal = computed(() => store.taskStatus === 'terminal')
const isLoading = computed(() => store.taskStatus === 'running' && store.events.length === 0)
const isRunning = computed(() => store.taskStatus === 'running')

function toggle(key) {
  collapsed.value[key] = !collapsed.value[key]
}

function copyTaskId() {
  if (store.taskId) copy(store.taskId)
}
</script>

<template>
  <section class="trajectory card" aria-label="执行轨迹区域">
    <div class="head">
      <div id="trajectory-heading" class="pane-title">执行轨迹</div>
      <div v-if="store.taskId" class="task-id-row">
        <span class="mono muted task-id">{{ store.taskId }}</span>
        <button
          class="btn btn-ghost btn-sm copy-btn"
          :title="copied ? '已复制' : '复制任务ID'"
          aria-label="复制任务ID"
          @click="copyTaskId"
        >
          <IconCheck v-if="copied" :size="12" class="text-success" />
          <IconCopy v-else :size="12" />
        </button>
      </div>
    </div>

    <div v-if="terminal" class="animate-result-in">
      <ResultCard />
    </div>

    <EmptyState
      v-if="!hasTask && !isLoading"
      title="暂无执行轨迹"
      description="发起一次请求后，这里的每一步都会实时出现——包括它依据什么、用了哪个身份、结果是否确定。"
    />

    <SkeletonLoader v-if="isLoading" :rows="4" />

    <template v-if="hasTask">
      <PhaseSection
        v-for="p in PHASES"
        :key="p.key"
        :phase-key="p.key"
        :phase-name="p.name"
        :phase-hint="p.hint"
        :events="store.eventsByPhase[p.key]"
        :collapsed="collapsed[p.key]"
        :is-running="isRunning"
        @toggle="toggle(p.key)"
      />
    </template>
  </section>
</template>

<style scoped>
.trajectory {
  padding: var(--space-5);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}

.task-id-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.task-id {
  user-select: all;
  font-size: var(--text-xs);
}

.copy-btn {
  padding: var(--space-1);
  width: 24px;
  height: 24px;
}

/* ========== 响应式 ========== */

@media (max-width: 768px) {
  .trajectory {
    padding: var(--space-4);
  }
}

@media (max-width: 480px) {
  .trajectory {
    padding: var(--space-3);
  }

  .head {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }
}
</style>
