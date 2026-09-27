<script setup>
// 应用外壳 —— 2026-09-26 登录上线后新增一道闸门：未登录不进主界面。
// 进入时先问一次"我是谁"（会话可能还在），会话失效则退回登录页并给"人话"提示。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ChatPane from './components/ChatPane.vue'
import ConversationList from './components/ConversationList.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import LoginView from './views/LoginView.vue'
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.vue'
import DebugModal from './components/DebugModal.vue'
import { useTheme } from './composables/useTheme.js'
import { useSessionStore } from './stores/session.js'
import { useTaskStore } from './stores/task.js'
import { useGlossaryStore } from './stores/glossary.js'
import { useConversationsStore } from './stores/conversations.js'
import { IconSidebar, IconTerminal } from './icons/index.js'

const session = useSessionStore()
const glossary = useGlossaryStore()
const conversations = useConversationsStore()

// 左栏（会话列表）：宽屏默认展开，窄屏默认收起——窄屏展开会把对话挤没，
// 而"先看到对话"比"先看到会话列表"重要。收起后由顶栏的开关按钮唤回。
const sideCollapsed = ref(typeof window !== 'undefined' && window.innerWidth < 900)

// 术语对照表随登录状态加载/清空（零术语纪律）：登录后拉一次，退出时清掉——
// 换个人登录不该沿用上一个人的界面状态。
watch(
  () => session.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      glossary.load()
      // 会话列表按登录用户装载（同一浏览器换了人，不该看到上一个人的对话）
      conversations.load(session.user?.username ?? null)
    } else {
      glossary.reset()
      conversations.$reset() // 只清视图；磁盘上的记录按用户名隔离保留
    }
  },
)

const store = useTaskStore()
const { theme, toggleTheme } = useTheme()
const showShortcuts = ref(false)
// 调试入口（结构化任务）：2026-09-27 从对话区底部移到顶栏图标按钮（主页更大气）
const showDebug = ref(false)

// SSE 连接状态指示器（仅在有任务时显示）
const connectionView = computed(() => {
  if (!store.taskId) return { show: false }
  const state = store.sseState
  if (state === 'connecting') {
    return { show: true, label: '连接中', cls: 'connecting', spin: true }
  }
  if (state === 'open') {
    return { show: true, label: '已连接', cls: 'open', spin: false }
  }
  if (state === 'reconnecting') {
    const sec = Math.round(store.reconnectDelay / 1000)
    return {
      show: true,
      label: `重连中 (${store.reconnectAttempt}/10${sec > 0 ? `, ${sec}s` : ''})`,
      cls: 'reconnecting',
      spin: true,
    }
  }
  if (state === 'failed') {
    return { show: true, label: '连接失败', cls: 'failed', spin: false }
  }
  return { show: false }
})

// 全局快捷键：? 显示快捷键帮助（输入框中不触发）
function handleGlobalKeydown(e) {
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const target = e.target
    const isEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    if (!isEditable) {
      e.preventDefault()
      showShortcuts.value = true
    }
  }
}

async function logout() {
  // 顺序与容错都是刻意的：先清上一个人的任务视图（换个人不该看见它），
  // 但**任何一步出问题都不能让人退不出去**——退出登录本身必须总能完成。
  try {
    store._reset()
  } catch (err) {
    console.error('[logout] 重置任务视图失败（不影响退出登录）', err)
  }
  await session.logout()
}

onMounted(() => {
  session.restore()
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div class="shell">
    <a href="#main-content" class="skip-link">跳到主要内容</a>
    <header class="topbar" role="banner">
      <div class="topbar-left">
        <button
          class="icon-btn"
          type="button"
          :class="{ collapsed: sideCollapsed }"
          :title="sideCollapsed ? '展开会话列表' : '收起会话列表'"
          :aria-label="sideCollapsed ? '展开会话列表' : '收起会话列表'"
          :aria-expanded="!sideCollapsed"
          @click="sideCollapsed = !sideCollapsed"
        >
          <IconSidebar :size="17" />
        </button>
        <img class="brand-mark" src="/brand-icon.png" alt="" aria-hidden="true" />
        <h1 class="brand">预约教室助手</h1>
      </div>

      <div class="topbar-center">
        <Transition name="fade">
          <div
            v-if="connectionView.show"
            class="conn-indicator"
            :class="'conn-' + connectionView.cls"
            role="status"
            aria-live="polite"
            :title="`SSE 连接状态：${connectionView.label}`"
          >
            <span class="conn-dot" :class="{ 'conn-spin': connectionView.spin }" />
            <span class="conn-label">{{ connectionView.label }}</span>
          </div>
        </Transition>
      </div>

      <div class="topbar-right">
        <button
          class="icon-btn"
          type="button"
          title="调试入口（结构化任务）"
          aria-label="调试入口"
          @click="showDebug = true"
        >
          <IconTerminal :size="16" />
        </button>
        <button
          class="icon-btn"
          type="button"
          title="快捷键（按 ?）"
          aria-label="查看快捷键"
          @click="showShortcuts = true"
        >
          <span class="q-mark" aria-hidden="true">?</span>
        </button>
        <ThemeToggle :theme="theme" @toggle="toggleTheme" />
        <div v-if="session.isLoggedIn" class="who">
          <span class="role">{{ session.roleLabel }}</span>
          <span class="name">{{ session.displayName }}</span>
          <button class="link" type="button" @click="logout">退出登录</button>
        </div>
      </div>
    </header>

    <main v-if="session.status === 'unknown' || session.status === 'checking'" class="booting">
      正在确认登录状态…
    </main>
    <LoginView v-else-if="!session.isLoggedIn" />
    <main
      v-else
      id="main-content"
      class="views"
      :class="{ 'side-collapsed': sideCollapsed }"
      role="main"
      tabindex="-1"
    >
      <ConversationList :collapsed="sideCollapsed" />
      <ChatPane />
    </main>

    <KeyboardShortcutsModal :visible="showShortcuts" @close="showShortcuts = false" />
    <DebugModal :visible="showDebug" @close="showDebug = false" />
  </div>
</template>

<style scoped>
/* 全屏工作台（2026-09-27）：外壳占满视口、页面自身不滚动——
   滚动只发生在消息区内部，输入框因此永远贴在手边。 */
.shell {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 56px;
  padding: 0 var(--space-4);
  border-bottom: var(--border-width) solid var(--border);
  background: var(--surface);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.topbar-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-width: 0;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-small);
  background: transparent;
  color: var(--text-muted);
  flex-shrink: 0;
  transition:
    background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.icon-btn:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
  border-color: transparent;
}

/* 收起按钮的图标随状态旋转 180°，给"收起/展开"一个看得见的手感 */
.icon-btn svg {
  transition: transform var(--dur-base) var(--ease-standard);
}

.icon-btn.collapsed svg {
  transform: rotate(180deg);
}

.q-mark {
  font-size: 15px;
  font-weight: var(--weight-bold);
  line-height: 1;
}

/* 品牌图标（2026-09-27）：AI 生成的"预约教室助手"徽章图（frontend/public/brand-icon.png，
   透明底圆角徽章），不再是渐变底 + 对勾符号的组合 */
.brand-mark {
  display: block;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  object-fit: contain;
  flex-shrink: 0;
}

.brand {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  letter-spacing: 0.2px;
}

/* SSE 连接状态指示器 */
.conn-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: var(--weight-medium);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-muted);
  white-space: nowrap;
}

.conn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.conn-spin {
  animation: conn-pulse 1.2s ease-in-out infinite;
}

@keyframes conn-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.75);
  }
}

.conn-connecting .conn-dot {
  background: var(--accent-500);
}

.conn-open .conn-dot {
  background: var(--success-500);
}

.conn-reconnecting {
  color: var(--warning-700);
  background: var(--warning-50);
}

.conn-reconnecting .conn-dot {
  background: var(--warning-500);
}

.conn-failed {
  color: var(--danger-600);
  background: var(--danger-50);
}

.conn-failed .conn-dot {
  background: var(--danger-500);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}

.role {
  background: var(--accent-weak);
  color: var(--accent);
  border-radius: 999px;
  padding: 2px 9px;
  font-weight: 600;
}

.name {
  color: var(--text-muted);
}

.link {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.booting {
  color: var(--text-muted);
  font-size: 13px;
  padding: var(--space-6) 0;
}

.views {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
  overflow: hidden;
  /* 收起/展开：左栏轨道宽度 268px ↔ 0 平滑过渡，对话区随之让位 */
  transition: grid-template-columns var(--dur-base) var(--ease-standard);
}

/* 收起 = 左栏轨道塌到 0（左栏自身 width:0 + 内容裁切，见 ConversationList）。
   必须保留两列结构：若改单列，grid auto-placement 会把对话区排进 0 宽的第一列，
   整列塌成 0（2026-09-27 实测踩过）。两列 + 轨道 0 时对话区固定占第二列，
   宽度随轨道动画从 979px 平滑扩到全宽。 */
.views.side-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

/* 窄屏：左栏改为对话框上方的一条横向列表（展开时），收起则完全隐藏 */
@media (max-width: 900px) {
  .views {
    grid-template-columns: minmax(0, 1fr);
  }

  .views:not(.side-collapsed) {
    grid-template-rows: auto minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  .topbar {
    padding: 0 var(--space-3);
    gap: var(--space-2);
  }

  .brand {
    font-size: var(--text-md);
  }

  .name {
    display: none;
  }
}

/* 小屏手机：更紧凑 */
@media (max-width: 480px) {
  .conn-label {
    display: none;
  }
}
</style>
