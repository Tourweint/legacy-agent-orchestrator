<script setup>
import { computed } from 'vue'
import { useTaskStore } from '../stores/task.js'
import { IconCheck, IconX, IconFlag, IconRefresh } from '../icons/index.js'

const store = useTaskStore()

// 三值的界面表达（§三）：颜色只用于状态；UNRESOLVED 不得混同于失败
const view = computed(() => {
  const status = store.terminalEvent?.status
  if (status === 'done') {
    return { cls: 'success', label: '已办成', icon: IconCheck }
  }
  if (status === 'failed') {
    // UNRESOLVED 对外不显示成失败（三值不退化），但终态语义区分：UNRESOLVED → 待处理形态
    if (store.result?.terminal === 'UNRESOLVED') {
      return { cls: 'unresolved', label: '操作未成功，且有一项变更需要人工处理', icon: IconFlag }
    }
    return { cls: 'danger', label: '未能办成', icon: IconX }
  }
  if (status === 'uncertain') {
    return { cls: 'unresolved', label: '操作未成功，且有一项变更需要人工处理', icon: IconFlag }
  }
  return { cls: 'neutral', label: '已结束', icon: IconFlag }
})

const pendingVisible = computed(() => store.result?.terminal === 'UNRESOLVED')
</script>

<template>
  <div class="result" :class="'v-' + view.cls">
    <div class="head-row">
      <span class="icon" aria-hidden="true">
        <component :is="view.icon" :size="18" />
      </span>
      <span class="label">{{ view.label }}</span>
      <span v-if="store.result" class="steps mono muted">{{ store.result.steps }} 步</span>
    </div>

    <div class="conclusion">{{ store.result?.conclusion }}</div>

    <!-- 待处理项：显著展示，禁止折叠进次级面板（§2.3） -->
    <div v-if="pendingVisible" class="pending">
      <div class="pending-title">
        <IconFlag :size="14" />
        待处理事项
      </div>
      <div class="pending-body">
        存量系统中可能存在一条未收敛的预约记录（业务键与记录号见轨迹 P5
        段与证据链），请人工核实后处置； 处置完成后任务留痕不可删除。
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" @click="store._reset()">
        <IconRefresh :size="14" />
        再办一件
      </button>
    </div>
  </div>
</template>

<style scoped>
.result {
  border: var(--border-width) solid var(--border);
  border-left-width: 3px;
  border-radius: var(--radius-card);
  padding: var(--space-4);
  margin-bottom: var(--space-5);
}

.v-success {
  border-left-color: var(--status-success);
}

.v-danger {
  border-left-color: var(--status-danger);
}

.v-unresolved {
  border-left-color: var(--status-uncertain);
  background: var(--status-uncertain-weak);
}

.head-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.icon {
  display: grid;
  place-items: center;
}

.v-success .icon,
.v-success .label {
  color: var(--status-success);
}

.v-danger .icon,
.v-danger .label {
  color: var(--status-danger);
}

.v-unresolved .icon,
.v-unresolved .label {
  color: var(--status-uncertain);
  font-weight: var(--weight-semibold);
}

.label {
  font-weight: var(--weight-bold);
  font-size: var(--text-md);
}

.steps {
  margin-left: auto;
  font-size: var(--text-xs);
}

.conclusion {
  margin-top: var(--space-2);
  white-space: pre-wrap;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.pending {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: var(--border-width) solid var(--status-uncertain);
  border-radius: var(--radius-small);
  background: var(--surface);
}

.pending-title {
  color: var(--status-uncertain);
  font-weight: var(--weight-bold);
  font-size: var(--text-sm);
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.pending-body {
  font-size: var(--text-xs);
  margin-top: var(--space-1);
  color: var(--text-muted);
  line-height: var(--leading-relaxed);
}

.actions {
  margin-top: var(--space-3);
}
</style>
