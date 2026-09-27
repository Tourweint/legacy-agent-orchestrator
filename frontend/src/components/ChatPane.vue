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
import { IconCheck, IconRefresh } from '../icons/index.js'

const store = useTaskStore()
const session = useSessionStore()
const draft = ref('')
const listEl = ref(null)
const composerRef = ref(null)

// 能力入口（示例话术）：一点即发。为什么要有它——评委不该为了看"能干什么"自己先想句子；
// 每条话术都是**当前角色真的能办成**的事（不是宣传语），按角色只显示办得到的那些。
// 2026-09-27 P2 升级：从静态 4 条改为动态推荐——基础池 + 上下文感知 + 换一批。
const TEACHER_POOL = [
  '帮我借下周三下午数智楼123',
  '查一下明天上午数智楼123有没有空',
  '我订了哪些教室',
  '把数智楼123那间退了',
  '帮我借10月1日下午两点到四点的数智楼222',
  '查一下后天下午哪些教室有空',
  '我下周三的预约改到周五',
  '帮我借明天上午的会议室，开班会用',
  '查一下数智楼222本周的预约情况',
  '取消我所有下周的预约',
]
// 学生通道：座位预约**只能提前 24 小时**（2026-09-26 实测约束），
// 所以示例用"今天下午"而不是"明天"；座位号形如"2-3"（行-列），不是"A3"。
const STUDENT_POOL = [
  '帮我占今天下午数智楼123的2-3号座位',
  '查一下明天上午数智楼123有没有空',
  '我订了哪些教室',
  '把数智楼123的座位退了',
  '帮我占今天晚上图书馆的1-1号座位',
  '查一下今天下午哪些座位还能占',
  '我今天的座位改到明天上午',
  '帮我占明天下午数智楼222的3-5号座位',
]

// 当前显示的 4 条话术（可换一批）
const visibleExamples = ref([])
const exampleSeed = ref(0)

function pickExamples(pool, seed) {
  const shuffled = [...pool]
  // 简单的确定性洗牌（基于 seed），保证同一种子结果一致
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (seed * 7 + i * 13) % (i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, 4)
}

function refreshExamples() {
  exampleSeed.value += 1
  const pool = session.role === 'STUDENT' ? STUDENT_POOL : TEACHER_POOL
  visibleExamples.value = pickExamples(pool, exampleSeed.value)
}

// 初始化话术
refreshExamples()

// 上下文感知推荐：如果上一轮是查询类，优先推荐"接着办"的话术
const contextAwareExamples = computed(() => {
  const lastTurn = store.turns[store.turns.length - 1]
  if (!lastTurn) return visibleExamples.value

  const lastIntent = lastTurn.intentId
  const result = lastTurn.result?.terminal

  // 如果刚查完空闲且成功，推荐"那帮我借了吧"
  if (lastIntent === 'query-classroom-availability' && result === 'DONE') {
    const followUp = ['那帮我借了吧', ...visibleExamples.value.filter((e) => !e.includes('借'))]
    return followUp.slice(0, 4)
  }

  // 如果刚办完借教室，推荐"查一下我的预约"或"改期"
  if (lastIntent === 'borrow-classroom' && result === 'DONE') {
    const followUp = ['查一下我的预约', '把这个预约改到下周', ...visibleExamples.value]
    return [...new Set(followUp)].slice(0, 4)
  }

  return visibleExamples.value
})

const examples = computed(() => contextAwareExamples.value)

// 调试入口默认隐藏，仅在 URL 带 ?debug=1 时显示（生产界面保持纯净）
const debugMode = computed(() => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('debug') === '1'
})

function useExample(text) {
  if (pending.value || terminal.value) return
  draft.value = text
  send()
}

function focusComposer() {
  composerRef.value?.focus()
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

// 办理中进度：已完成步骤数 + 进度条百分比（基于事件数估算）
const activeStepCount = computed(() => {
  const turn = store.activeTurn
  if (!turn) return 0
  return turn.events.filter((e) => e.type !== 'phase-start' && e.type !== 'phase-end').length
})
const progressPercent = computed(() => Math.min(95, 15 + activeStepCount.value * 5))

// 错误恢复：根据错误类型提供建议话术，让用户不用自己重新组织语言
const errorSuggestions = computed(() => {
  const err = store.error
  if (!err) return []
  if (err.includes('DASHSCOPE') || err.includes('理解层') || err.includes('大模型')) {
    return ['查一下明天上午数智楼123有没有空', '我订了哪些教室']
  }
  if (err.includes('超时') || err.includes('网络') || err.includes('连接')) {
    return ['重试刚才的请求', '查一下我的预约']
  }
  return ['换一种说法试试', '查一下我的预约']
})

function handleErrorRetry() {
  store.clearError()
  // 如果有上一条用户消息，重新发送
  const lastTurn = store.turns[store.turns.length - 1]
  const lastUserMsg = lastTurn?.userMessages[lastTurn.userMessages.length - 1]
  if (lastUserMsg) {
    draft.value = lastUserMsg
    send()
  }
}

function handleErrorSuggest(text) {
  store.clearError()
  draft.value = text
  send()
}

// 停止按钮：能不能停由 store 说了算（它和后端的取消口径必须一致——
// 界面上出现一个"点了没反应"的按钮，比没有按钮更糟）。
const showCancel = computed(() => store.canCancel)
const stopHint = computed(() =>
  store.writeIssued
    ? '这一步已经提交给系统，结果正在核对，暂时不能中断'
    : '停止这次办理：还没有向系统提交任何变更',
)

async function send() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  stickToBottom.value = true
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
  stickToBottom.value = true
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
  // Esc：清空输入或停止任务
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

// 自动滚动只在"用户本来就在看最新一条"时发生：读历史时被拽回底部是很烦的。
const stickToBottom = ref(true)

function onScroll() {
  const el = listEl.value
  if (!el) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

function scrollBottom() {
  if (!stickToBottom.value) return
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' }))
}

// 任一轮出现新事件（或说出新的一句）就滚到底
watch(() => store.turns.map((t) => `${t.userMessages.length}:${t.events.length}`).join('|'), scrollBottom)
watch(() => store.activeTurnId, () => {
  stickToBottom.value = true
  scrollBottom()
})
</script>

<template>
  <section class="chat" aria-label="对话区域">
    <div class="pane-head">
      <div class="pane-title">对话</div>
      <button v-if="store.hasAnyTurn" class="btn btn-ghost btn-sm" @click="newConversation">
        新对话
      </button>
    </div>

    <div
      ref="listEl"
      class="messages"
      role="log"
      aria-live="polite"
      aria-label="对话消息"
      @scroll.passive="onScroll"
    >
      <EmptyState
        v-if="!store.hasAnyTurn"
        title="开始一次代办"
        description="试试下面的例子，点击即可自动填入并发送。办完之后接着在这段对话里说下一句就行——它记得住上文。"
      >
        <div class="empty-examples">
          <button
            v-for="text in examples"
            :key="text"
            class="empty-example-card"
            @click="useExample(text)"
          >
            <span class="empty-example-text">{{ text }}</span>
            <span class="empty-example-arrow" aria-hidden="true">→</span>
          </button>
        </div>
        <button class="btn btn-primary empty-cta" @click="focusComposer">
          或者自己说一句
        </button>
      </EmptyState>

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
          :outcome="turn.result?.terminal ?? null"
        />

        <template v-for="m in clarifyMessagesOf(turn)" :key="'a' + m.seq">
          <div class="msg assistant animate-message-left">
            <span class="avatar" aria-hidden="true"><IconCheck :size="13" /></span>
            <div class="msg-body">
              <span
                class="msg-text"
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
              </span>
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
            </div>
          </div>
        </template>

        <!-- 结论：核心输出（唯一默认可见的助手内容）——用大字答话，不藏在过程里 -->
        <AnswerBubble :turn="turn" />
      </template>
    </div>

    <div class="dock">
      <!-- 停止：写在输入框正上方（比一条横贯整屏的红条克制，也更像"随手可停"） -->
      <div v-if="showCancel && !terminal" class="stop-row">
        <button class="stop-btn" :title="stopHint" @click="cancelTask">
          <span class="stop-square" aria-hidden="true"></span>
          停止这次办理
        </button>
        <span class="stop-hint muted">{{ stopHint }}</span>
      </div>

      <!-- 能力入口：说一句就能办（当前角色办得到的那些）；空闲或已办完都可用 -->
      <div v-if="!pending && !suspended" class="capability">
        <div class="capability-header">
          <div class="capability-label muted">可以这样说（{{ session.roleLabel }}）</div>
          <button class="refresh-btn" type="button" title="换一批推荐" @click="refreshExamples">
            <IconRefresh :size="12" />
            <span>换一批</span>
          </button>
        </div>
        <div class="chips">
          <button
            v-for="text in examples"
            :key="text"
            class="chip"
            :disabled="pending"
            @click="useExample(text)"
          >
            {{ text }}
          </button>
        </div>
      </div>

      <!-- 办理中进度条：替代快捷话术区域，让用户知道"它正在干什么" -->
      <div v-if="pending" class="progress-row" role="status" aria-live="polite">
        <div class="progress-info">
          <span class="progress-spinner" aria-hidden="true"></span>
          <span class="progress-text">正在办理中<span class="progress-dots">...</span></span>
          <span v-if="activeStepCount > 0" class="progress-steps muted">已完成 {{ activeStepCount }} 步</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
      </div>

      <ErrorState
        v-if="store.error"
        title="请求失败"
        :message="store.error"
        :show-retry="true"
        retry-text="重试"
        :suggestions="errorSuggestions"
        help-text="查看使用教程"
        help-href="https://github.com/Tourweint/legacy-agent-orchestrator#readme"
        @retry="handleErrorRetry"
        @suggest="handleErrorSuggest"
      />

      <Composer
        ref="composerRef"
        v-model="draft"
        :suspended="suspended"
        :pending="pending"
        :terminal="terminal"
        @send="send"
        @keydown="handleKeydown"
      />

      <details v-if="debugMode" class="debug">
        <summary class="muted">调试入口（结构化任务）</summary>
        <DebugTaskPanel />
      </details>
    </div>
  </section>
</template>

<style scoped>
/* 全屏工作台（2026-09-27）：对话区占满右侧整列——头部、消息区、输入区分三层，
   只有消息区滚动；内容宽度上限 820px 并居中，宽屏下不拉散、也不缩成一条窄卡片。 */
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--surface);
}

.pane-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 52px;
  padding: 0 max(var(--space-5), calc((100% - 820px) / 2));
  border-bottom: var(--border-width) solid var(--border);
  background: var(--surface);
}

.pane-title {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--text);
  letter-spacing: 0.01em;
}

.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) max(var(--space-5), calc((100% - 820px) / 2)) var(--space-5);
  /* 性能优化：限制重绘重排范围，滚动时只影响容器内部 */
  contain: layout paint;
  /* 平滑滚动 */
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
}

.dock {
  flex-shrink: 0;
  padding: var(--space-3) max(var(--space-5), calc((100% - 820px) / 2)) var(--space-4);
  background: var(--surface);
  border-top: var(--border-width) solid var(--border);
  box-shadow: 0 -2px 8px -4px rgba(16, 24, 40, 0.06);
}

.bubble {
  max-width: 82%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  white-space: pre-wrap;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}

/* 用户气泡：淡蓝底 + 细边框（克制的蓝，不做满色块）；右下角收一个小角表达"我发的" */
.bubble.user {
  align-self: flex-end;
  background: var(--accent-weak);
  color: var(--accent-900);
  border: var(--border-width) solid var(--accent-100);
  border-bottom-right-radius: var(--radius-xs);
}

/* 助手消息：不做气泡（回答本来就该像正文一样读），用品牌圆点标明"这是它说的" */
.msg.assistant {
  display: flex;
  gap: var(--space-3);
  align-self: stretch;
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
}

.avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--accent-gradient);
  color: #ffffff;
  flex-shrink: 0;
}

.msg-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: 2px;
}

.msg-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-text.pending {
  color: var(--warning-700);
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

.stop-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.stop-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  border: var(--border-width) solid var(--danger-200);
  background: var(--danger-50);
  color: var(--danger-600);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
}

.stop-btn:hover:not(:disabled) {
  border-color: var(--danger-400);
  background: var(--danger-100);
}

.stop-square {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: currentcolor;
}

.stop-hint {
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capability {
  margin-bottom: var(--space-3);
}

.capability-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.capability-label {
  font-size: 11px;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}

.refresh-btn:hover {
  border-color: var(--accent-300);
  color: var(--accent-600);
  background: var(--accent-50);
}

.refresh-btn:active {
  transform: scale(0.95);
}

.refresh-btn svg {
  transition: transform var(--dur-base) var(--ease-standard);
}

.refresh-btn:hover svg {
  transform: rotate(180deg);
}

/* 办理中进度条 */
.progress-row {
  margin-bottom: var(--space-3);
  padding: var(--space-3);
  background: var(--surface-2);
  border-radius: var(--radius-card);
  border: 1px solid var(--border);
}

.progress-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.progress-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--accent-200);
  border-top-color: var(--accent-500);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.progress-text {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text);
}

.progress-dots {
  display: inline-block;
  width: 1.2em;
  text-align: left;
  animation: dots-blink 1.4s steps(4, end) infinite;
}

@keyframes dots-blink {
  0% { content: ''; opacity: 0; }
  25% { content: '.'; opacity: 1; }
  50% { content: '..'; opacity: 1; }
  75% { content: '...'; opacity: 1; }
  100% { content: ''; opacity: 0; }
}

.progress-steps {
  font-size: var(--text-xs);
  margin-left: auto;
}

.progress-bar {
  height: 4px;
  background: var(--surface);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-gradient);
  border-radius: var(--radius-pill);
  transition: width 0.4s var(--ease-decelerate);
  position: relative;
}

.progress-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
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
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.chip:hover:not(:disabled) {
  border-color: var(--accent-400);
  background: var(--accent-100);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.chip:active:not(:disabled) {
  transform: translateY(0) scale(0.95);
  box-shadow: var(--shadow-xs);
}

.chip:disabled {
  opacity: 0.5;
  cursor: default;
  transform: none;
  box-shadow: none;
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

/* ========== 空状态引导卡片 ========== */

.empty-examples {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  max-width: 400px;
}

.empty-example-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-card);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}

.empty-example-card:hover {
  border-color: var(--accent-400);
  background: var(--accent-weak);
  transform: translateX(4px);
  box-shadow: var(--shadow-sm);
}

.empty-example-card:active {
  transform: translateX(4px) scale(0.98);
}

.empty-example-text {
  font-size: var(--text-sm);
  color: var(--text);
  font-weight: var(--weight-medium);
  line-height: var(--leading-normal);
}

.empty-example-arrow {
  flex-shrink: 0;
  color: var(--accent-500);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.empty-example-card:hover .empty-example-arrow {
  transform: translateX(4px);
}

.empty-cta {
  margin-top: var(--space-1);
  padding: var(--space-2) var(--space-5);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

/* ========== 响应式 ========== */

/* 超宽屏（1440px+）：内容区保持 820px 居中，两侧留白更多 */
@media (min-width: 1440px) {
  .pane-head,
  .messages,
  .dock {
    padding-left: calc((100% - 820px) / 2);
    padding-right: calc((100% - 820px) / 2);
  }
}

/* 平板横屏（1024px 以下）：内容区最大宽度调整为 720px */
@media (max-width: 1024px) {
  .pane-head,
  .messages,
  .dock {
    padding-left: max(var(--space-5), calc((100% - 720px) / 2));
    padding-right: max(var(--space-5), calc((100% - 720px) / 2));
  }
}

/* 平板竖屏（768px 以下）：内容区占满宽度，减少留白 */
@media (max-width: 768px) {
  .pane-head,
  .messages,
  .dock {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }

  .empty-state {
    padding: var(--space-5) var(--space-4);
  }

  .empty-title {
    font-size: var(--text-base);
  }
}

@media (max-width: 480px) {
  .bubble {
    max-width: 92%;
    font-size: var(--text-sm);
  }

  .stop-hint {
    display: none;
  }

  .empty-example-card {
    padding: var(--space-2) var(--space-3);
  }

  .progress-row {
    padding: var(--space-2);
  }
}
</style>
