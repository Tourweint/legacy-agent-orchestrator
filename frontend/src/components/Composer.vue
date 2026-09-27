<script setup>
import { computed, ref } from 'vue'
import { IconSend } from '../icons/index.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  suspended: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  terminal: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'send', 'keydown'])

const inputEl = ref(null)

function focus() {
  inputEl.value?.focus()
  inputEl.value?.select()
}

defineExpose({ focus })

// 输入框**常驻**：办完一件事不等于这段对话结束——用户随时可以接着说下一句
// （"那再帮我看看后天"），引擎带着同一段会话的记忆接着办。所以终态不是禁用理由，
// 只影响提示文案。
const placeholder = computed(() => {
  if (props.suspended) return '补充信息……'
  if (props.pending) return '正在办理……'
  if (props.terminal) return '继续说点什么，或接着办下一件……'
  return '用一句话说明要办的事'
})

function onInput(e) {
  emit('update:modelValue', e.target.value)
}

function onKeydown(e) {
  emit('keydown', e)
}
</script>

<template>
  <div class="composer">
    <input
      ref="inputEl"
      :value="modelValue"
      class="input"
      :placeholder="placeholder"
      :disabled="disabled"
      aria-label="对话输入"
      @input="onInput"
      @keydown.enter="emit('send')"
      @keydown="onKeydown"
    />
    <button
      class="btn btn-primary"
      :class="{ 'btn-pulse': modelValue.trim() && !pending && !disabled }"
      :disabled="!modelValue.trim() || pending || disabled"
      aria-label="发送"
      @click="emit('send')"
    >
      <IconSend :size="14" />
      {{ suspended ? '回复' : '发送' }}
    </button>
  </div>

  <div class="kb-hints muted" aria-hidden="true">
    <kbd>Enter</kbd> 发送
    <span class="kb-sep">·</span>
    <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 发送
    <span class="kb-sep">·</span>
    <kbd>Ctrl</kbd>+<kbd>K</kbd> 聚焦输入
    <span class="kb-sep">·</span>
    <kbd>Esc</kbd> 清空/取消
    <span class="kb-sep">·</span>
    <kbd>?</kbd> 快捷键
  </div>
</template>

<style scoped>
/* 输入条做成一个整体 dock：白底圆角容器，输入框去边框融入；聚焦时整体发光 */
.composer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--surface);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-medium);
  padding: 6px 6px 6px 12px;
  box-shadow: var(--shadow-xs);
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}

.composer:focus-within {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--accent-100), var(--shadow-glow-soft);
}

.composer .input {
  flex: 1;
  border: none;
  background: transparent;
  box-shadow: none;
  padding: var(--space-2) 4px;
}

.composer .input:focus {
  box-shadow: none;
}

.composer .btn {
  flex-shrink: 0;
  border-radius: var(--radius-small);
  position: relative;
  overflow: hidden;
}

/* 有输入时的 pulse 动画：微妙地提示用户"可以发送了" */
.btn-pulse {
  animation: btn-pulse 2s ease-in-out infinite;
}

@keyframes btn-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(99, 102, 241, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn-pulse {
    animation: none;
  }
}

.kb-hints {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: var(--space-2);
  font-size: 10px;
  line-height: 1.4;
}

.kb-hints kbd {
  display: inline-block;
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
  box-shadow: 0 1px 0 var(--border);
}

.kb-sep {
  color: var(--text-faint);
  margin: 0 2px;
}

@media (max-width: 480px) {
  .composer {
    flex-direction: column;
  }

  .composer .btn {
    width: 100%;
  }
}
</style>
