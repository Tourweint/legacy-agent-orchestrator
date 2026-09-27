<script setup>
// 理解卡 —— 2026-09-27 方向二：把引擎"听懂成了什么"亮在对话流里（用户消息之后、思考过程之前），
// 并给"改一下"入口。数据源：P1 的 decision 事件（带 intentName/slots 结构化载荷，引擎已中文化）；
// 只做展示，不自行推断（§6.1 助手侧内容一律由事件派生）。
//
// 为什么在消息流而不是思考过程里：理解是每轮最该先看见的核心信息；
// 思考过程里的"识别为…"行已取消强制焦点（useThinking.js），不重复展示。

defineProps({
  event: { type: Object, required: true },
  // readonly：历史轮（非当前活动轮）只展示理解，不给"改一下"入口
  readonly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

defineEmits(['correct'])
</script>

<template>
  <div class="understand-card" role="status">
    <div class="uc-head">
      <span class="uc-intent">{{ event.intentName }}</span>
      <button
        v-if="!readonly"
        class="uc-fix"
        type="button"
        :disabled="disabled"
        :title="
          disabled
            ? '已经开始办理，改的话会自动退旧办新'
            : '理解得不对？直接说正确说法'
        "
        @click="$emit('correct')"
      >
        {{ disabled ? '已开始办理' : '改一下' }}
      </button>
    </div>
    <div class="uc-slots">
      <span v-for="s in event.slots ?? []" :key="s.key" class="uc-chip">
        {{ s.label }}：{{ s.value }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 浅灰底 + 细边框的卡片：不抢对话正文的注意力，又一眼能确认"它听懂了什么" */
.understand-card {
  align-self: stretch;
  background: var(--surface-2);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-medium);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.uc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.uc-intent {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--text);
}

.uc-fix {
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 2px 6px;
  border-radius: var(--radius-small);
  color: var(--accent);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard);
}

.uc-fix:hover:not(:disabled) {
  background: var(--accent-100);
}

.uc-fix:disabled {
  color: var(--text-faint);
  cursor: default;
}

.uc-slots {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.uc-chip {
  background: var(--surface);
  border: var(--border-width) solid var(--border);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
