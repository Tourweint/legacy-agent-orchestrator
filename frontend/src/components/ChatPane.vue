<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTaskStore } from '../stores/task.js'
import { useSessionStore } from '../stores/session.js'
import DebugTaskPanel from './DebugTaskPanel.vue'
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import Composer from './Composer.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import AnswerBubble from './AnswerBubble.vue'
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

// 追问属于**核心输出**（用户必须当场看到问题才答得上），仍然逐条显示；
// 终态结论交给 AnswerBubble、过程交给 ThinkingBlock——助手侧内容一律由事件派生（§6.1）
function clarifyMessagesOf(turn) {
  return turn.events
    .filter((e) => e.type === 'input-required')
    .map((e) => ({ seq: e.seq, kind: e.type, text: e.text }))
}

const pending = computed(() => store.taskStatus === 'running')
const suspended = computed(() => store.taskStatus === 'suspended')
const terminal = computed(() => store.taskStatus === 'terminal')

// 取消按钮显隐矩阵（§4.5/B8）：提交前可见；不确定态禁用重试类操作
const showCancel = computed(() => store.canCancel || (pending.value && !store.writeIssued))

async function send() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  if (suspended.value) {
    await store.reply(text)
  } else {
    // 终态后继续说是合法的：同一段对话里接着办下一件（引擎带着上文理解）
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

/** 另起一段对话：轮次与记忆都从头开始。 */
function newConversation() {
  store.newConversation()
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

// 任一轮出现新事件（或说出新的一句）就滚到底
watch(() => store.turns.map((t) => `${t.userMessages.length}:${t.events.length}`).join('|'), scrollBottom)
</script>

<template>
  <section class="chat card" aria-label="对话区域">
    <div class="pane-head">
      <div class="pane-title">对话</div>
      <button v-if="store.hasAnyTurn" class="btn btn-ghost btn-sm" @click="newConversation">
        新对话
      </button>
    </div>

    <div ref="listEl" class="messages" role="log" aria-live="polite" aria-label="对话消息">
      <EmptyState
        v-if="!store.hasAnyTurn"
        title="开始一次代办"
        description="试试：「帮我借下周三下午数智楼222」。办完之后接着在这段对话里说下一句就行——它记得住上文。"
      />

      <!-- 会话 = 多轮；每轮 = 这一轮用户说过的话 + 该轮事件派生的助手消息 -->
      <template v-for="(turn, ti) in store.turns" :key="turn.id">
        <div
          v-for="(text, ui) in turn.userMessages"
          :key="'u' + ti + '-' + ui"
          class="bubble user animate-message-right"
        >
          {{ text }}
        </div>

        <!-- 过程：折叠起来按需展开（默认收起；办不成时自动展开失败链） -->
        <ThinkingBlock
          :events="turn.events"
          :status="turn.status"
          :cancelled="turn.cancelled === true"
        />

        <template v-for="m in clarifyMessagesOf(turn)" :key="'a' + m.seq">
          <div
            class="bubble assistant animate-message-left"
            :class="{
              pending: m.kind === 'input-required' && turn.id === store.activeTurnId && pending,
            }"
          >
            {{ m.text }}
            <span
              v-if="m.kind === 'input-required' && turn.id === store.activeTurnId && pending"
              class="pulse-dot"
              aria-hidden="true"
            ></span>
          </div>
          <!-- 闸门二：候选意图按钮（E5） -->
          <div
            v-if="
              m.kind === 'input-required' &&
              turn.id === store.activeTurnId &&
              turn.clarify?.kind === 'intent-choice' &&
              turn.status === 'suspended'
            "
            class="choices"
          >
            <button
              v-for="c in turn.clarify.candidates"
              :key="c.id"
              class="btn btn-sm"
              @click="chooseCandidate(c)"
            >
              {{ c.name }}
            </button>
          </div>
        </template>

        <!-- 结论：核心输出（唯一默认可见的助手内容） -->
        <AnswerBubble :turn="turn" />
      </template>
    </div>

    <!-- 取消按钮（B8/§4.5：写请求发出前可见；提交后不提供任何等价重试/放弃入口） -->
    <div v-if="showCancel && !terminal" class="cancel-row">
      <button class="btn btn-danger btn-block" @click="cancelTask">
        <IconX :size="14" />
        取消任务（未产生任何变更）
      </button>
    </div>

    <!-- 能力入口：说一句就能办（当前角色办得到的那些）；空闲或已办完都可用 -->
    <div v-if="!pending && !suspended" class="capability">
      <div class="capability-label muted">可以这样说（{{ session.roleLabel }}）</div>
      <div class="chips">
        <button v-for="text in examples" :key="text" class="chip" :disabled="pending" @click="useExample(text)">
          {{ text }}
        </button>
      </div>
    </div>

    <ErrorState v-if="store.error" title="请求失败" :message="store.error" :show-retry="false" />

    <Composer
      ref="composerRef"
      v-model="draft"
      :suspended="suspended"
      :pending="pending"
      :terminal="terminal"
      @send="send"
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
  /* 宽屏下对话不要拉得太散（阅读宽度上限），并在剩余空间里居中 */
  width: 100%;
  max-width: 920px;
  justify-self: center;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.pane-title {
  font-weight: var(--weight-semibold);
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
