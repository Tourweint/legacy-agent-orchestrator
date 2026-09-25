<script setup>
import { computed, ref } from 'vue'
import { PHASES, useTaskStore } from '../stores/task.js'
import ResultCard from './ResultCard.vue'
import TrajectoryItem from './TrajectoryItem.vue'

const store = useTaskStore()
// 折叠规则（§2.2）：默认展开 P1–P4，P5/P6 折叠
const collapsed = ref({ P1: false, P2: false, P3: false, P4: false, P5: true, P6: true })

const hasTask = computed(() => store.taskId !== null)

function toggle(key) {
  collapsed.value[key] = !collapsed.value[key]
}

function phaseName(key) {
  return PHASES.find((p) => p.key === key)
}
</script>

<template>
  <section class="trajectory card">
    <div class="head">
      <div class="pane-title">执行轨迹</div>
      <div v-if="store.taskId" class="mono muted task-id">{{ store.taskId }}</div>
    </div>

    <div v-if="terminal" >
      <ResultCard />
    </div>

    <div v-if="!hasTask" class="empty muted">
      发起一次请求后，这里的每一步都会实时出现——包括它依据什么、用了哪个身份、结果是否确定。
    </div>

    <template v-for="p in PHASES" :key="p.key">
      <div v-if="hasTask" class="phase" :class="{ collapsed: collapsed[p.key] }">
        <button class="phase-head" @click="toggle(p.key)">
          <span class="phase-key mono">{{ p.key }}</span>
          <span class="phase-name">{{ phaseName(p.key).name }}</span>
          <span class="phase-hint muted">{{ phaseName(p.key).hint }}</span>
          <span class="count muted">{{ store.eventsByPhase[p.key].length }}</span>
        </button>
        <div v-show="!collapsed[p.key]" class="items">
          <div v-if="store.eventsByPhase[p.key].length === 0" class="muted item-empty">
            {{ store.taskStatus === 'running' ? '进行中……' : '—' }}
          </div>
          <TrajectoryItem v-for="e in store.eventsByPhase[p.key]" :key="e.seq" :event="e" />
        </div>
      </div>
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
  align-items: baseline;
  margin-bottom: var(--space-4);
}

.task-id {
  user-select: all;
}

.empty {
  padding: var(--space-5);
  border: var(--border-width) dashed var(--border);
  border-radius: var(--radius-card);
  font-size: 13px;
}

.phase {
  margin-bottom: var(--space-4);
}

.phase-head {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  text-align: left;
  background: transparent;
  border: none;
  padding: var(--space-2) 0;
}

.phase-key {
  color: var(--accent);
  font-weight: 650;
}

.phase-name {
  font-weight: 650;
}

.phase-hint {
  font-size: 12px;
  flex: 1;
}

.count {
  font-size: 11px;
}

.items {
  border-left: 2px solid var(--border);
  margin-left: 10px;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.item-empty {
  font-size: 12px;
  padding: var(--space-1) 0;
}
</style>
