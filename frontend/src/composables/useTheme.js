// useTheme —— 主题管理 composable
// 职责：读取系统偏好/本地存储、切换主题、持久化、同步 data-theme 属性

import { ref, watch } from 'vue'

const STORAGE_KEY = 'theme'

function getInitialTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const theme = ref(getInitialTheme())

  // 初始化时同步到 DOM
  document.documentElement.dataset.theme = theme.value

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function setTheme(value) {
    if (value === 'light' || value === 'dark') {
      theme.value = value
    }
  }

  // 主题变化时同步 DOM 和本地存储
  watch(theme, (val) => {
    document.documentElement.dataset.theme = val
    localStorage.setItem(STORAGE_KEY, val)
  })

  return {
    theme,
    toggleTheme,
    setTheme,
  }
}
