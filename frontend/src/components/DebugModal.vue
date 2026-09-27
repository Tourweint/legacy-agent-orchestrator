<script setup>
// 调试入口弹窗（2026-09-27）：调试/结构化任务入口从对话区底部移到了顶栏图标按钮，
// 主页不再有底部调试区（用户口径：放底下显得主页不大气）。
import DebugTaskPanel from './DebugTaskPanel.vue'
import { IconClose } from '../icons/index.js'

defineProps({
  visible: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="overlay" @click.self="emit('close')">
        <div class="modal" role="dialog" aria-modal="true" aria-label="调试入口（结构化任务）">
          <div class="head">
            <h2 class="title">调试入口（结构化任务）</h2>
            <button
              class="icon-btn"
              type="button"
              title="关闭"
              aria-label="关闭"
              @click="emit('close')"
            >
              <IconClose :size="16" />
            </button>
          </div>
          <DebugTaskPanel @submitted="emit('close')" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.45);
  padding: var(--space-4);
}

.modal {
  width: min(560px, 100%);
  max-height: 80vh;
  overflow-y: auto;
  background: var(--surface);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg, 0 20px 50px -12px rgba(15, 23, 42, 0.35));
  padding: var(--space-4);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
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
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.icon-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
