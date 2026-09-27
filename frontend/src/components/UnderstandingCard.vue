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
/* 极简理解行：无卡片、无边框——就一行"我理解成了什么"，靠字号与留白分层 */
.understand-card {
  align-self: stretch;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: var(--space-2) 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.uc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.uc-intent {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--text);
}

.uc-intent::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
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
  background: var(--accent-weak);
}

.uc-fix:disabled {
  color: var(--text-faint);
  cursor: default;
}

.uc-slots {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  padding-left: 14px;
}

.uc-chip {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
