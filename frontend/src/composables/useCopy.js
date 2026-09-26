// useCopy —— 复制到剪贴板 composable
// 职责：调用 navigator.clipboard，处理失败回退，提供复制成功状态反馈

import { ref } from 'vue'

const FEEDBACK_DURATION = 2000 // 复制成功反馈持续时间

export function useCopy() {
  const copied = ref(false)
  let feedbackTimer = null

  async function copy(text) {
    if (!text) return false

    try {
      await navigator.clipboard.writeText(text)
      copied.value = true

      // 重置反馈计时器
      if (feedbackTimer) clearTimeout(feedbackTimer)
      feedbackTimer = setTimeout(() => {
        copied.value = false
        feedbackTimer = null
      }, FEEDBACK_DURATION)

      return true
    } catch {
      // 剪贴板不可用（如非安全上下文）时的降级方案
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)

        copied.value = true
        if (feedbackTimer) clearTimeout(feedbackTimer)
        feedbackTimer = setTimeout(() => {
          copied.value = false
          feedbackTimer = null
        }, FEEDBACK_DURATION)

        return true
      } catch {
        return false
      }
    }
  }

  return {
    copied,
    copy,
  }
}
