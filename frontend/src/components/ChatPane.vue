<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTaskStore } from '../stores/task.js'
import { useSessionStore } from '../stores/session.js'
import ErrorState from './ErrorState.vue'
import Composer from './Composer.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import AnswerBubble from './AnswerBubble.vue'
import { IconCheck, IconSearch } from '../icons/index.js'

const store = useTaskStore()
const session = useSessionStore()
const draft = ref('')
const listEl = ref(null)
// 2026-09-27 单实例改造：hero（空态中央）与 dock（底部）是**同一个** Composer 实例，
// 位置/形态由 .composer-host 的 has-turns 类切换 + CSS transition 平滑过渡
// （不再双实例 v-if 互斥——那会造成"两个输入条"的歧义，且切换是瞬间跳变）。
const composerRef = ref(null)

function focusComposer() {
  composerRef.value?.focus()
}

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
  // 运行中/挂起点能力入口不接管（运行中让 send() 按改口语义处理，挂起时用户正在答追问）；
  // **终态后必须可用**——"接着办下一件"是合法链路（2026-09-27 修复：恢复会话被标终态
  // 后，入口点击曾被这里的 terminal 守卫挡住、零请求发出）。
  if (pending.value || suspended.value) return
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

// 方向二 · 改口：用户在运行中（写请求未发出）说的话 = 纠正理解——
// 先取消原任务、**等它落终态**再按新说法起新轮（不假装已停住，I3）。
const correcting = ref(false)
const pendingText = ref('')

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

  // 运行中：分两段。写请求未发出 → 这句话是改口（纠正理解）；
  // 写请求已发出 → 输入框已禁用（Composer disabled），这里兜底忽略，不并发第二个任务。
  if (pending.value) {
    if (!store.writeIssued) {
      draft.value = ''
      stickToBottom.value = true
      beginCorrect(text)
    }
    return
  }

  draft.value = ''
  stickToBottom.value = true
  if (suspended.value) {
    // 挂起追问的回复是**正常链路**，绝不能被当成改口（B2）
    await store.reply(text)
  } else {
    // 终态后继续说是合法的：同一段对话里接着办下一件（引擎带着上文理解）
    await store.startChat(text)
  }
  scrollBottom()
}

function beginCorrect(text) {
  correcting.value = true
  pendingText.value = text
  store.cancel()
}

// 原轮终态到达（取消收口完成，settleCancelledTurn 已判定）→ 自动按新说法起新轮
watch(
  () => store.taskStatus,
  async (st) => {
    if (!correcting.value) return
    if (st === 'terminal') {
      correcting.value = false
      const text = pendingText.value
      pendingText.value = ''
      if (text) {
        await store.startChat(text)
        scrollBottom()
      }
    }
  },
)

function chooseCandidate(candidate) {
  store.reply(candidate.name)
}

function cancelTask() {
  stickToBottom.value = true
  store.cancel()
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

// 全局快捷键：Ctrl/Cmd + K 聚焦输入框（空态聚焦中央、对话中聚焦底部）
function handleGlobalKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    focusComposer()
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
  <section class="chat" :class="{ 'has-turns': store.hasAnyTurn }" aria-label="对话区域">
    <div
      ref="listEl"
      class="messages"
      role="log"
      aria-live="polite"
      aria-label="对话消息"
      @scroll.passive="onScroll"
    >
      <!-- 会话 = 多轮；每轮 = 这一轮用户说过的话 + 该轮事件派生的助手消息。
           空态时这里没有内容（标题/示例/输入条都是绝对定位层，见下方） -->
      <template v-if="store.hasAnyTurn">
        <template v-for="(turn, ti) in store.turns" :key="turn.id">
        <div
          v-for="(text, ui) in turn.userMessages"
          :key="'u' + ti + '-' + ui"
          class="bubble user animate-message-right"
        >
          {{ text }}
        </div>

        <!-- 改口中：原轮正在收口，提示用户稍候 -->
        <div v-if="turn.id === store.activeTurnId && correcting" class="msg assistant animate-message-left">
          <span class="avatar" aria-hidden="true"><IconCheck :size="13" /></span>
          <div class="msg-body">
            <span class="msg-text pending">正在按你的新说法重新理解……</span>
          </div>
        </div>

        <!-- 思考过程：像 AI 聊天软件一样——默认收起、可点开（2026-09-27 起终态不再隐藏）。
             展开/收起与"办不成时部分展开失败链"由 ThinkingBlock 内部决定（useThinking 纯函数）。 -->
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
      </template>
    </div>

    <!-- 空态标题：绝对定位在输入条上方（不占流；has-turns 时淡出）。
         放大镜 + "预约教室，从这里开始"，与输入条成组随重心下移。 -->
    <div class="hero-heading" aria-hidden="true">
      <IconSearch :size="22" :stroke-width="1.5" />
      <h2 class="hero-title">预约教室，从这里开始</h2>
    </div>

    <!-- 空态示例 chips：绝对定位在输入条下方（has-turns 时淡出） -->
    <div class="hero-chips">
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

    <!-- 单实例输入条（2026-09-27）：空态在中央偏下（hero 形态），有对话落到底部（dock 形态）。
         位置（top/width）与形态（padding/圆角/按钮尺寸）都由 has-turns 类切换触发 CSS 过渡，
         "新对话 ↔ 对话"来回切换时输入条平滑移动，而不是瞬间跳变。 -->
    <div class="composer-host" :class="{ 'has-stop': showCancel && !terminal }">
      <!-- 停止：写在输入框正上方（比一条横贯整屏的红条克制，也更像"随手可停"） -->
      <div v-if="showCancel && !terminal" class="stop-row">
        <button class="stop-btn" :title="stopHint" @click="cancelTask">
          <span class="stop-square" aria-hidden="true"></span>
          停止这次办理
        </button>
        <span class="stop-hint muted">{{ stopHint }}</span>
      </div>

      <ErrorState v-if="store.error" title="请求失败" :message="store.error" :show-retry="false" />

      <Composer
        ref="composerRef"
        v-model="draft"
        :variant="store.hasAnyTurn ? 'dock' : 'hero'"
        :suspended="suspended"
        :pending="pending"
        :terminal="terminal"
        :disabled="correcting || (pending && store.writeIssued)"
        @send="send"
        @keydown="handleKeydown"
      />
    </div>
  </section>
</template>

<style scoped>
/* 全屏工作台（2026-09-27）：对话区占满右侧整列——头部、消息区、输入区分三层，
   只有消息区滚动；内容宽度上限 820px 并居中，宽屏下不拉散、也不缩成一条窄卡片。
   position: relative 是绝对定位层（hero-heading / hero-chips / composer-host）的基准。 */
.chat {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--surface);
}

.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) max(var(--space-5), calc((100% - 820px) / 2)) var(--space-5);
  /* 底部输入条已改为绝对定位（不占流），消息区底部留出输入条高度 + 18px 留白，
     最后一条消息滚动到底时不被输入条遮住 */
  padding-bottom: 96px;
}

/* ========== 空态中央构图（绝对定位层，单实例输入条） ==========
   2026-09-27 单实例改造：hero-heading / hero-chips / composer-host 三个绝对定位层，
   top 值成组（标题在输入条上方 8px、chips 在下方 16px），由 .chat.has-turns 类切换：
   - 空态：整体停在 34vh（重心约 40%，用户口径"往下多移一点"，不再靠中上）；
   - 有对话：composer-host 平滑下移到底部 dock（100% - 62px - 停按钮高度），
     标题/chips 淡出（opacity 220ms），输入条形态同步从 hero 过渡到 dock。 */

.hero-heading {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: calc(34vh - 38px);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--accent-500);
  opacity: 1;
  transition: opacity 220ms var(--ease-standard);
  pointer-events: none;
}

.chat.has-turns .hero-heading {
  opacity: 0;
}

.hero-title {
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  color: var(--text);
}

.hero-chips {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: calc(34vh + 86px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  opacity: 1;
  transition: opacity 220ms var(--ease-standard);
}

.chat.has-turns .hero-chips {
  opacity: 0;
  pointer-events: none;
}

.composer-host {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 34vh;
  width: min(64vw, 780px);
  display: flex;
  flex-direction: column;
  --stop-h: 0px;
  transition:
    top 300ms var(--ease-standard),
    width 300ms var(--ease-standard);
  z-index: 2;
}

.chat.has-turns .composer-host {
  /* dock 位置：底部留白 18px；出现停止按钮时整体上移 --stop-h（约 34px） */
  top: calc(100% - 62px - var(--stop-h));
  width: min(820px, calc(100% - 48px));
}

.composer-host.has-stop {
  --stop-h: 34px;
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

/* ========== 响应式 ========== */

@media (max-width: 900px) {
  .messages {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
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
}
</style>
