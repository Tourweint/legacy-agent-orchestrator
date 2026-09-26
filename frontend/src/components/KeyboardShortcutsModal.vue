<script setup>
import { onMounted, onUnmounted } from 'vue'
import { IconClose } from '../icons/index.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const shortcuts = [
  {
    category: '全局',
    items: [
      { keys: ['Ctrl', 'K'], desc: '聚焦到输入框' },
      { keys: ['?'], desc: '显示此快捷键帮助' },
      { keys: ['Esc'], desc: '关闭弹窗 / 清空输入 / 取消任务' },
    ],
  },
  {
    category: '输入与发送',
    items: [
      { keys: ['Enter'], desc: '发送消息' },
      { keys: ['Ctrl', 'Enter'], desc: '发送消息（备用）' },
      { keys: ['Esc'], desc: '清空输入框内容' },
    ],
  },
  {
    category: '执行轨迹',
    items: [
      { keys: ['点击阶段头'], desc: '折叠 / 展开该阶段' },
      { keys: ['点击条目'], desc: '查看该步骤的详细证据' },
    ],
  },
]

function onKeydown(e) {
  if (e.key === 'Escape' && props.visible) {
    emit('close')
  }
}

function onMaskClick(e) {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="modal-mask"
        role="dialog"
        aria-modal="true"
        aria-label="快捷键帮助"
        @click="onMaskClick"
      >
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">键盘快捷键</h2>
            <button class="btn btn-ghost btn-sm close-btn" aria-label="关闭" @click="emit('close')">
              <IconClose :size="16" />
            </button>
          </div>
          <div class="modal-body">
            <div v-for="group in shortcuts" :key="group.category" class="shortcut-group">
              <h3 class="group-title">{{ group.category }}</h3>
              <div class="shortcut-list">
                <div v-for="(item, idx) in group.items" :key="idx" class="shortcut-item">
                  <div class="shortcut-keys">
                    <kbd v-for="(key, i) in item.keys" :key="i">{{ key }}</kbd>
                  </div>
                  <span class="shortcut-desc">{{ item.desc }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <span class="muted">按 <kbd>Esc</kbd> 或点击空白处关闭</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  padding: var(--space-4);
}

.modal-content {
  background: var(--bg);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width) solid var(--border);
}

.modal-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  margin: 0;
}

.close-btn {
  padding: var(--space-1);
  width: 32px;
  height: 32px;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) var(--space-5);
}

.shortcut-group {
  margin-bottom: var(--space-4);
}

.shortcut-group:last-child {
  margin-bottom: 0;
}

.group-title {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 var(--space-2) 0;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.shortcut-keys {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.shortcut-keys kbd {
  display: inline-block;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
  box-shadow: 0 1px 0 var(--border);
  min-width: 24px;
  text-align: center;
}

.shortcut-desc {
  font-size: var(--text-sm);
  color: var(--text);
  text-align: right;
}

.modal-footer {
  padding: var(--space-3) var(--space-5);
  border-top: var(--border-width) solid var(--border);
  font-size: var(--text-xs);
  text-align: center;
}

.modal-footer kbd {
  display: inline-block;
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
}

/* 动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard);
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .modal-content,
.modal-fade-leave-active .modal-content {
  transition: transform var(--dur-base) var(--ease-standard);
}

.modal-fade-enter-from .modal-content,
.modal-fade-leave-to .modal-content {
  transform: scale(0.95) translateY(10px);
}

@media (max-width: 480px) {
  .modal-content {
    max-height: 90vh;
  }

  .shortcut-item {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .shortcut-desc {
    text-align: left;
  }
}
</style>
