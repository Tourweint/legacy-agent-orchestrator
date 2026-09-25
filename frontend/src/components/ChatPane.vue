<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useTaskStore } from '../stores/task.js'
import DebugTaskPanel from './DebugTaskPanel.vue'

const store = useTaskStore()
const draft = ref('')
const listEl = ref(null)

// 对话视图的助手侧消息全部由事件派生（§6.1：不自行推断）
const assistantMessages = computed(() =>
  store.events
    .filter((e) => e.type === 'input-required' || e.type === 'terminal')
    .map((e) => ({ seq: e.seq, kind: e.type, text: e.text })),
)

const pending = computed(() => store.taskStatus === 'running')
const suspended = computed(() => store.taskStatus === 'suspended')
const terminal = computed(() => store.taskStatus === 'terminal')
const terminalStatus = computed(() => store.terminalEvent?.status ?? null)

// 取消按钮显隐矩阵（§4.5/B8）：提交前可见；不确定态禁用重试类操作
const showCancel = computed(() => store.canCancel || (pending.value && !store.writeIssued))

async function send() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  if (suspended.value) {
    await store.reply(text)
  } else {
    await store.startChat(text)
  }
  scrollBottom()
}

function chooseCandidate(candidate) {
  store.reply(candidate.name)
}

function cancelTask() {
  store.cancel()
}

function newTask() {
  store._reset()
}

function scrollBottom() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' }))
}

watch(assistantMessages, scrollBottom)
</script>

<template>
  <section class="chat card">
    <div class="pane-title">对话</div>

    <div ref="listEl" class="messages">
      <div v-if="store.userMessages.length === 0 && assistantMessages.length === 0" class="empty muted">
        试试：「帮我借下周三下午数智楼222」或「查一下明天上午数智楼123有没有空」
      </div>

      <div v-for="(m, i) in store.userMessages" :key="'u' + i" class="bubble user">{{ m.text }}</div>

      <template v-for="m in assistantMessages" :key="'a' + m.seq">
        <div class="bubble assistant" :class="{ pending: m.kind === 'input-required' && pending }">
          {{ m.text }}
          <span v-if="m.kind === 'input-required' && pending" class="pulse-dot" aria-hidden="true"></span>
        </div>
        <!-- 闸门二：候选意图按钮（E5） -->
        <div v-if="m.kind === 'input-required' && store.clarify?.kind === 'intent-choice' && suspended" class="choices">
          <button v-for="c in store.clarify.candidates" :key="c.id" @click="chooseCandidate(c)">
            {{ c.name }}
          </button>
        </div>
      </template>
    </div>

    <!-- 取消按钮（B8/§4.5：写请求发出前可见；提交后不提供任何等价重试/放弃入口） -->
    <div v-if="showCancel && !terminal" class="cancel-row">
      <button class="cancel" @click="cancelTask">取消任务（未产生任何变更）</button>
    </div>

    <div v-if="store.error" class="error">{{ store.error }}</div>

    <div class="composer">
      <input
        v-model="draft"
        :placeholder="suspended ? '补充信息……' : '用一句话说明要办的事'"
        :disabled="terminal"
        @keydown.enter="send"
      />
      <button class="primary" :disabled="!draft.trim() || pending || terminal" @click="send">
        {{ suspended ? '回复' : '发送' }}
      </button>
    </div>

    <details class="debug">
      <summary class="muted">调试入口（结构化任务）</summary>
      <DebugTaskPanel />
    </details>
  </section>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 640px;
  position: sticky;
  top: var(--space-5);
}

.pane-title {
  font-weight: 650;
  margin-bottom: var(--space-3);
}

.messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}

.empty {
  font-size: 13px;
  padding: var(--space-3);
}

.bubble {
  max-width: 88%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  white-space: pre-wrap;
}

.bubble.user {
  align-self: flex-end;
  background: var(--accent);
  color: var(--on-accent);
  border: none;
}

.bubble.assistant {
  align-self: flex-start;
  background: var(--surface-2);
  border: var(--border-width) solid var(--border);
}

.bubble.assistant.pending {
  border-color: var(--status-uncertain);
}

.pulse-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--status-uncertain);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.choices {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.cancel-row {
  margin: var(--space-2) 0;
}

.cancel {
  width: 100%;
  color: var(--status-danger);
  border-color: var(--status-danger);
  background: transparent;
}

.error {
  color: var(--status-danger);
  font-size: 12px;
  margin-bottom: var(--space-2);
}

.composer {
  display: flex;
  gap: var(--space-2);
}

.composer input {
  flex: 1;
}

.debug {
  margin-top: var(--space-3);
  font-size: 12px;
}

.debug summary {
  cursor: pointer;
}
</style>
