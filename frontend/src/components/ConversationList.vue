<script setup>
// 左栏会话列表 —— 界面方案 §二。默认展开，只给一个收起按钮（收起后留一条窄边）。
// 点一条历史会话即切回去（轮次快照来自 localStorage，见 stores/conversations.js）。

import { computed } from 'vue'
import { useConversationsStore } from '../stores/conversations.js'
import { useTaskStore } from '../stores/task.js'

defineProps({ collapsed: { type: Boolean, default: false } })
const emit = defineEmits(['toggle'])

const convs = useConversationsStore()
const task = useTaskStore()

/** 按日期分三组（今天 / 昨天 / 更早）——够用，不啰嗦。 */
const groups = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  const buckets = { 今天: [], 昨天: [], 更早: [] }
  for (const c of convs.sorted) {
    const t = c.updatedAt ?? 0
    const key = t >= startOfToday ? '今天' : t >= startOfYesterday ? '昨天' : '更早'
    buckets[key].push(c)
  }
  return Object.entries(buckets).filter(([, list]) => list.length > 0)
})

/** 末轮结果 → 状态点（一眼看出哪段对话办成了）。 */
function statusOf(c) {
  const last = c.turns?.[c.turns.length - 1]
  if (!last) return 'idle'
  if (last.status === 'running' || last.status === 'suspended') return 'running'
  if (last.cancelled) return 'idle'
  const terminal = last.result?.terminal
  if (terminal === 'DONE') return 'done'
  if (terminal === 'UNRESOLVED') return 'unsure'
  return 'failed'
}

function open(item) {
  task.restore(item)
  convs.activeId = item.id
}

function startNew() {
  task.newConversation()
  convs.activeId = null
}
</script>

<template>
  <aside class="side" :class="{ collapsed }" aria-label="会话列表">
    <div class="head">
      <button v-if="!collapsed" class="btn btn-ghost btn-sm new" @click="startNew">
        ＋ 新对话
      </button>
      <button
        class="toggle"
        :title="collapsed ? '展开会话列表' : '收起会话列表'"
        :aria-label="collapsed ? '展开会话列表' : '收起会话列表'"
        @click="emit('toggle')"
      >
        {{ collapsed ? '»' : '«' }}
      </button>
    </div>

    <nav v-if="!collapsed" class="list">
      <div v-for="[label, list] in groups" :key="label" class="group">
        <div class="group-label">{{ label }}</div>
        <button
          v-for="c in list"
          :key="c.id"
          class="item"
          :class="{ active: c.id === convs.activeId }"
          :title="c.title"
          @click="open(c)"
        >
          <span class="dot" :class="'is-' + statusOf(c)" aria-hidden="true"></span>
          <span class="title">{{ c.title }}</span>
        </button>
      </div>
      <p v-if="convs.sorted.length === 0" class="empty">还没有对话记录</p>
    </nav>
  </aside>
</template>

<style scoped>
.side {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  position: sticky;
  top: var(--space-5);
  max-height: calc(100vh - var(--space-6));
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.new {
  flex: 1;
  justify-content: flex-start;
}

.toggle {
  flex-shrink: 0;
  background: transparent;
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-small);
  color: var(--text-faint);
  width: 26px;
  height: 26px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard);
}

.toggle:hover {
  color: var(--text);
}

.collapsed .head {
  justify-content: center;
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow-y: auto;
  padding-right: 2px;
}

.group-label {
  font-size: 10px;
  color: var(--text-faint);
  margin-bottom: var(--space-1);
  padding-left: 2px;
}

.item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  background: transparent;
  border: none;
  border-radius: var(--radius-small);
  padding: 5px 6px;
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-standard);
}

.item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.item.active {
  background: var(--accent-weak);
  color: var(--text);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-faint);
}

.dot.is-done {
  background: var(--status-success);
}

.dot.is-failed {
  background: var(--status-danger);
}

.dot.is-unsure,
.dot.is-running {
  background: var(--status-uncertain);
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  font-size: 11px;
  color: var(--text-faint);
  padding-left: 2px;
}
</style>
