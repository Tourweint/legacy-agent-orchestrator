<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTaskStore } from '../stores/task.js'
import { useSessionStore } from '../stores/session.js'
import DebugTaskPanel from './DebugTaskPanel.vue'
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import Composer from './Composer.vue'
import { IconX } from '../icons/index.js'

const store = useTaskStore()
const session = useSessionStore()
const draft = ref('')
const listEl = ref(null)
const composerRef = ref(null)

// 能力入口（示例话术）：一点即发。为什么要有它——评委不该为了看"能干什么"自己先想句子；
// 每条话术都是**当前角色真的能办成**的事（不是宣传语），按角色只显示办得到的那些。
const TEACHER_EXAMPLES = [
  '帮我借下周三下午数智楼123',
  '查一下明天上午数智楼123有没有空',
  '我订了哪些教室',
  '把数智楼123那间退了',
]
// 学生通道：座位预约**只能提前 24 小时**（2026-09-26 实测约束），
// 所以示例用"今天下午"而不是"明天"；座位号形如"2-3"（行-列），不是"A3"。
const STUDENT_EXAMPLES = [
  '帮我占今天下午数智楼123的2-3号座位',
  '查一下明天上午数智楼123有没有空',
  '我订了哪些教室',
]
const examples = computed(() => (session.role === 'STUDENT' ? STUDENT_EXAMPLES : TEACHER_EXAMPLES))

function useExample(text) {
  if (pending.value || terminal.value) return
  draft.value = text
  send()
}

// 对话视图的助手侧消息全部由事件派生（§6.1：不自行推断）
const assistantMessages = computed(() =>
  store.events
    .filter((e) => e.type === 'input-required' || e.type === 'terminal')
    .map((e) => ({ seq: e.seq, kind: e.type, text: e.text }))
)

const pending = computed(() => store.taskStatus === 'running')
const suspended = computed(() => store.taskStatus === 'suspended')
const terminal = computed(() => store.taskStatus === 'terminal')
const isEmpty = computed(
  () => store.userMessages.length === 0 && assistantMessages.value.length === 0
)

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
  draft.value = ''
}

function handleKeydown(e) {
  // Ctrl/Cmd + Enter：发送
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    send()
    return
  }
  // Esc：清空输入或取消任务
  if (e.key === 'Escape') {
    if (draft.value) {
      draft.value = ''
    } else if (showCancel.value && !terminal.value) {
      cancelTask()
    }
  }
}

// 全局快捷键：Ctrl/Cmd + K 聚焦输入框
function handleGlobalKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    composerRef.value?.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})

function scrollBottom() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' }))
}

watch(assistantMessages, scrollBottom)
</script>

<template>
  <section class="chat card" aria-label="对话区域">
    <div class="pane-title">对话</div>

    <div ref="listEl" class="messages" role="log" aria-live="polite" aria-label="对话消息">
      <EmptyState
        v-if="isEmpty"
        title="开始一次代办"
        description="试试：「帮我借下周三下午数智楼222」或「查一下明天上午数智楼123有没有空」"
      />

      <div
        v-for="(m, i) in store.userMessages"
        :key="'u' + i"
        class="bubble user animate-message-right"
        :style="{ animationDelay: `${i * 40}ms` }"
      >
        {{ m.text }}
      </div>

      <template v-for="m in assistantMessages" :key="'a' + m.seq">
        <div
          class="bubble assistant animate-message-left"
          :class="{ pending: m.kind === 'input-required' && pending }"
        >
          {{ m.text }}
          <span
            v-if="m.kind === 'input-required' && pending"
            class="pulse-dot"
            aria-hidden="true"
          ></span>
        </div>
        <!-- 闸门二：候选意图按钮（E5） -->
        <div
          v-if="m.kind === 'input-required' && store.clarify?.kind === 'intent-choice' && suspended"
          class="choices"
        >
          <button
            v-for="c in store.clarify.candidates"
            :key="c.id"
            class="btn btn-sm"
            @click="chooseCandidate(c)"
          >
            {{ c.name }}
          </button>
        </div>
      </template>
    </div>

    <!-- 取消按钮（B8/§4.5：写请求发出前可见；提交后不提供任何等价重试/放弃入口） -->
    <div v-if="showCancel && !terminal" class="cancel-row">
<<<<<<< HEAD
      <button class="cancel" @click="cancelTask">取消任务（未产生任何变更）</button>
    </div>

    <div v-if="store.error" class="error">{{ store.error }}</div>

    <!-- 能力入口：说一句就能办（当前角色办得到的那些） -->
    <div v-if="!terminal && !suspended" class="capability">
      <div class="capability-label muted">可以这样说（{{ session.roleLabel }}）</div>
      <div class="chips">
        <button v-for="text in examples" :key="text" class="chip" :disabled="pending" @click="useExample(text)">
          {{ text }}
        </button>
      </div>
    </div>

    <div class="composer">
      <input
        v-model="draft"
        :placeholder="suspended ? '补充信息……' : '用一句话说明要办的事'"
        :disabled="terminal"
        @keydown.enter="send"
      />
      <button class="primary" :disabled="!draft.trim() || pending || terminal" @click="send">
        {{ suspended ? '回复' : '发送' }}
=======
      <button class="btn btn-danger btn-block" @click="cancelTask">
        <IconX :size="14" />
        取消任务（未产生任何变更）
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2
      </button>
    </div>

    <ErrorState v-if="store.error" title="请求失败" :message="store.error" :show-retry="false" />

    <Composer
      ref="composerRef"
      v-model="draft"
      :suspended="suspended"
      :pending="pending"
      :terminal="terminal"
      @send="send"
      @new-task="newTask"
      @keydown="handleKeydown"
    />

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
  font-weight: var(--weight-semibold);
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

.bubble {
  max-width: 88%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  white-space: pre-wrap;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
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
  animation: pulse 1.2s var(--ease-standard) infinite;
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

.choices {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.cancel-row {
  margin: var(--space-2) 0;
}

<<<<<<< HEAD
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

.capability {
  margin-bottom: var(--space-3);
}

.capability-label {
  font-size: 11px;
  margin-bottom: var(--space-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  background: var(--accent-weak);
  color: var(--accent);
  border: var(--border-width) solid transparent;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--dur-fast) ease;
}

.chip:hover:not(:disabled) {
  border-color: var(--accent);
}

.chip:disabled {
  opacity: 0.5;
  cursor: default;
}

.composer {
  display: flex;
  gap: var(--space-2);
}

.composer input {
  flex: 1;
}

=======
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2
.debug {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
}

.debug summary {
  cursor: pointer;
  padding: var(--space-1) 0;
}

.debug summary:hover {
  color: var(--text);
}

/* ========== 响应式 ========== */

@media (max-width: 768px) {
  .chat {
    height: auto;
    min-height: 420px;
    position: static;
  }
}

@media (max-width: 480px) {
  .chat {
    min-height: 360px;
  }

  .bubble {
    max-width: 92%;
    padding: var(--space-2);
    font-size: var(--text-xs);
  }
}
</style>
