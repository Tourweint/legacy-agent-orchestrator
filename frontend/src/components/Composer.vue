<script setup>
import { ref } from 'vue'
import { IconSend, IconRefresh } from '../icons/index.js'

defineProps({
  modelValue: { type: String, default: '' },
  suspended: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  terminal: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'send', 'new-task', 'keydown'])

const inputEl = ref(null)

function focus() {
  inputEl.value?.focus()
  inputEl.value?.select()
}

defineExpose({ focus })

function onInput(e) {
  emit('update:modelValue', e.target.value)
}

function onKeydown(e) {
  emit('keydown', e)
}
</script>

<template>
  <div class="composer">
    <template v-if="!terminal">
      <input
        ref="inputEl"
        :value="modelValue"
        class="input"
        :placeholder="suspended ? '补充信息……' : '用一句话说明要办的事'"
        :disabled="disabled"
        aria-label="任务输入"
        @input="onInput"
        @keydown.enter="emit('send')"
        @keydown="onKeydown"
      />
      <button
        class="btn btn-primary"
        :disabled="!modelValue.trim() || pending || disabled"
        aria-label="发送"
        @click="emit('send')"
      >
        <IconSend :size="14" />
        {{ suspended ? '回复' : '发送' }}
      </button>
    </template>
    <button v-else class="btn btn-primary btn-block" @click="emit('new-task')">
      <IconRefresh :size="14" />
      再办一件
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
.composer {
  display: flex;
  gap: var(--space-2);
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
