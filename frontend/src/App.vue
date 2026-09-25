<script setup>
import { ref } from 'vue'
import ChatPane from './components/ChatPane.vue'
import TrajectoryPane from './components/TrajectoryPane.vue'
import ThemeToggle from './components/ThemeToggle.vue'

const theme = ref(localStorage.getItem('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
document.documentElement.dataset.theme = theme.value

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('theme', theme.value)
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <div class="brand">校园教室代办</div>
        <div class="tagline">每一步都看得见依据 · 可解释可恢复</div>
      </div>
      <ThemeToggle :theme="theme" @toggle="toggleTheme" />
    </header>

    <main class="views">
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
