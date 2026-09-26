<script setup>
<<<<<<< HEAD
// 应用外壳 —— 2026-09-26 登录上线后新增一道闸门：未登录不进主界面。
// 进入时先问一次"我是谁"（会话可能还在），会话失效则退回登录页并给"人话"提示。
import { onMounted, ref, watch } from 'vue'
import ChatPane from './components/ChatPane.vue'
import TrajectoryPane from './components/TrajectoryPane.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import LoginView from './views/LoginView.vue'
import { useSessionStore } from './stores/session.js'
import { useTaskStore } from './stores/task.js'
import { useGlossaryStore } from './stores/glossary.js'

const session = useSessionStore()
const task = useTaskStore()
const glossary = useGlossaryStore()

// 术语对照表随登录状态加载/清空（零术语纪律）：登录后拉一次，退出时清掉——
// 换个人登录不该沿用上一个人的界面状态。
watch(
  () => session.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) glossary.load()
    else glossary.reset()
  },
)
=======
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useTaskStore } from './stores/task.js'
import { useTheme } from './composables/useTheme.js'
import ChatPane from './components/ChatPane.vue'
import TrajectoryPane from './components/TrajectoryPane.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.vue'
import { IconSpinner, IconFlag, IconCheck, IconX } from './icons/index.js'
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2

const store = useTaskStore()
const { theme, toggleTheme } = useTheme()
const showShortcuts = ref(false)

// 顶栏任务状态指示器
const statusView = computed(() => {
  const status = store.taskStatus
  if (status === 'running') {
    return { show: true, label: '运行中', cls: 'running', icon: IconSpinner, spin: true }
  }
  if (status === 'suspended') {
    return { show: true, label: '等待输入', cls: 'suspended', icon: IconFlag, spin: false }
  }
  if (status === 'terminal') {
    const terminalStatus = store.terminalEvent?.status
    if (terminalStatus === 'done') {
      return { show: true, label: '已办成', cls: 'success', icon: IconCheck, spin: false }
    }
    if (terminalStatus === 'failed' && store.result?.terminal !== 'UNRESOLVED') {
      return { show: true, label: '未能办成', cls: 'danger', icon: IconX, spin: false }
    }
    return { show: true, label: '待人工处理', cls: 'suspended', icon: IconFlag, spin: false }
  }
  return { show: false, label: '', cls: '', icon: null, spin: false }
})

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

<<<<<<< HEAD
async function logout() {
  // 顺序与容错都是刻意的：先清上一个人的任务视图（换个人不该看见它），
  // 但**任何一步出问题都不能让人退不出去**——退出登录本身必须总能完成。
  try {
    task._reset()
  } catch (err) {
    console.error('[logout] 重置任务视图失败（不影响退出登录）', err)
  }
  await session.logout()
}

onMounted(() => {
  session.restore()
=======
onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2
})
</script>

<template>
  <div class="shell">
    <a href="#main-content" class="skip-link">跳到主要内容</a>
    <header class="topbar" role="banner">
      <div class="brand-area">
        <h1 class="brand">校园教室代办</h1>
        <p class="tagline">每一步都看得见依据 · 可解释可恢复</p>
      </div>
      <div class="topbar-actions">
        <Transition name="fade">
          <div
            v-if="statusView.show"
            class="status-badge"
            :class="'st-' + statusView.cls"
            role="status"
            aria-live="polite"
          >
            <component
              :is="statusView.icon"
              :size="12"
              :class="{ 'status-spin': statusView.spin }"
              aria-hidden="true"
            />
            <span>{{ statusView.label }}</span>
          </div>
        </Transition>
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
        <ThemeToggle :theme="theme" @toggle="toggleTheme" />
      </div>
<<<<<<< HEAD
      <div class="top-right">
        <div v-if="session.isLoggedIn" class="who">
          <span class="role">{{ session.roleLabel }}</span>
          <span class="name">{{ session.displayName }}</span>
          <button class="link" type="button" @click="logout">退出登录</button>
        </div>
        <ThemeToggle :theme="theme" @toggle="toggleTheme" />
      </div>
    </header>

    <main v-if="session.status === 'unknown' || session.status === 'checking'" class="booting">
      正在确认登录状态…
    </main>
    <LoginView v-else-if="!session.isLoggedIn" />
    <main v-else class="views">
=======
    </header>

    <main id="main-content" class="views" role="main" tabindex="-1">
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2
      <ChatPane />
      <TrajectoryPane />
    </main>

    <KeyboardShortcutsModal :visible="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>

<style scoped>
.shell {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5) var(--space-6);
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
}

.brand-area {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  letter-spacing: 0.2px;
}

.tagline {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  border-radius: var(--radius-pill);
  border: var(--border-width) solid;
}

.status-badge.st-running {
  color: var(--accent-600);
  border-color: var(--accent-200);
  background: var(--accent-50);
}

.status-badge.st-suspended {
  color: var(--warning-700);
  border-color: var(--warning-200);
  background: var(--warning-50);
}

.status-badge.st-success {
  color: var(--success-700);
  border-color: var(--success-200);
  background: var(--success-50);
}

.status-badge.st-danger {
  color: var(--danger-600);
  border-color: var(--danger-200);
  background: var(--danger-50);
}

.status-spin {
  animation: spin 0.9s linear infinite;
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

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.top-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

/* 平板：减小对话区宽度 */
@media (max-width: 1024px) {
  .views {
    grid-template-columns: 320px minmax(0, 1fr);
    gap: var(--space-4);
  }
}

/* 移动端：单栏堆叠 */
@media (max-width: 768px) {
  .shell {
    padding: var(--space-4) var(--space-4) var(--space-5);
  }

  .topbar {
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .brand {
    font-size: var(--text-md);
  }

  .tagline {
    display: none;
  }

  .views {
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }
}

/* 小屏手机：更紧凑 */
@media (max-width: 480px) {
  .shell {
    padding: var(--space-3) var(--space-3) var(--space-4);
  }

  .topbar-actions {
    gap: var(--space-2);
  }

  .status-badge {
    padding: 3px 8px;
    font-size: 10px;
  }
}
</style>
