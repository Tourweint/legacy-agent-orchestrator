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
const composerRef = ref(null)
// 空态中央输入框（hero）：与底部 dock 各一个实例，同一时刻只渲染其一（v-if 互斥）。
// Ctrl/Cmd + K 聚焦当前可见的那个。
const heroComposerRef = ref(null)

function focusComposer() {
  if (!store.hasAnyTurn) heroComposerRef.value?.focus()
  else composerRef.value?.focus()
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
  <section class="chat" aria-label="对话区域">
    <div
      ref="listEl"
      class="messages"
      role="log"
      aria-live="polite"
      aria-label="对话消息"
      @scroll.passive="onScroll"
    >
      <!-- 空态 = DeepSeek 神似的中央构图（2026-09-27 用户口径，第二轮精简）：
           放大镜 + 标题一行 → 中央宽输入框（发送按钮=右下角小圆）→ 输入框下方示例。
           描述/示例标签都不显示（提示词已在输入框里），一旦发出第一条消息整体让位给消息流。 -->
      <template v-if="!store.hasAnyTurn">
        <div class="hero-layout">
          <div class="hero-heading">
            <IconSearch :size="22" :stroke-width="1.5" aria-hidden="true" />
            <h2 class="hero-title">预约教室，从这里开始</h2>
          </div>

          <Composer
            ref="heroComposerRef"
            v-model="draft"
            variant="hero"
            :suspended="suspended"
            :pending="pending"
            :terminal="terminal"
            :disabled="correcting || (pending && store.writeIssued)"
            @send="send"
            @keydown="handleKeydown"
          />

          <!-- 快捷发送：空态时放在中央输入框下方（用户口径：第一次给示例，后续不再重复） -->
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
        </div>
      </template>

      <!-- 会话 = 多轮；每轮 = 这一轮用户说过的话 + 该轮事件派生的助手消息 -->
      <template v-else>
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

    <div class="dock">
      <!-- 停止：写在输入框正上方（比一条横贯整屏的红条克制，也更像"随手可停"） -->
      <div v-if="showCancel && !terminal" class="stop-row">
        <button class="stop-btn" :title="stopHint" @click="cancelTask">
          <span class="stop-square" aria-hidden="true"></span>
          停止这次办理
        </button>
        <span class="stop-hint muted">{{ stopHint }}</span>
      </div>

      <!-- 能力入口：只在空态中央展示（2026-09-27 升级：示例随中央输入框走，
           发过消息或恢复历史会话后不再重复；"＋ 新对话"回到空态又会显示） -->
      <ErrorState v-if="store.error" title="请求失败" :message="store.error" :show-retry="false" />

      <Composer
        v-if="store.hasAnyTurn"
        ref="composerRef"
        v-model="draft"
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
   只有消息区滚动；内容宽度上限 820px 并居中，宽屏下不拉散、也不缩成一条窄卡片。 */
.chat {
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
}

/* 空态中央构图（hero-layout）：放大镜+标题一行 → 中央宽输入框 → 示例 chips。
   命名 hero-layout 而非 hero：Composer 的 hero 形态也叫 .hero，
   撞名会让本容器的 flex-direction:column 等规则兜底污染输入条（2026-09-27 实测踩过）。
   容器在 messages（flex column）里靠 margin 顶部留白 + 底部自适应占位——垂直重心略偏上
   （用户口径"太居中了"：不再钉死在屏幕正中，接近 DeepSeek 的构图上移手感）；
   水平仍居中。发消息后让位给消息流。 */
.hero-layout {
  margin: 12vh auto auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-4);
}

.hero-heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--accent-500);
}

.hero-title {
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  color: var(--text);
}

.hero-chips {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.dock {
  flex-shrink: 0;
  /* 底部留白 18px（2026-09-27 用户拍板"16~20 左右"）：输入框不再压着屏幕底边，
     留出稳定间隙；顶部仍 8px，消息区与输入区保持紧凑 */
  padding: var(--space-2) max(var(--space-5), calc((100% - 820px) / 2)) 18px;
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
  .messages,
  .dock {
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
