<script setup>
// 应用外壳 —— 2026-09-26 登录上线后新增一道闸门：未登录不进主界面。
// 进入时先问一次"我是谁"（会话可能还在），会话失效则退回登录页并给"人话"提示。
import { onMounted, ref } from 'vue'
import ChatPane from './components/ChatPane.vue'
import TrajectoryPane from './components/TrajectoryPane.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import LoginView from './views/LoginView.vue'
import { useSessionStore } from './stores/session.js'
import { useTaskStore } from './stores/task.js'

const session = useSessionStore()
const task = useTaskStore()

const theme = ref(localStorage.getItem('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
document.documentElement.dataset.theme = theme.value

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('theme', theme.value)
}

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
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <div class="brand">校园教室代办</div>
        <div class="tagline">每一步都看得见依据 · 可解释可恢复</div>
      </div>
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
      <ChatPane />
      <TrajectoryPane />
    </main>
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

.brand {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.2px;
}

.tagline {
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 2px;
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

@media (max-width: 900px) {
  .views {
    grid-template-columns: 1fr;
  }
}
</style>
