<script setup>
import { computed, ref } from 'vue'
import { IconSend } from '../icons/index.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  suspended: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  terminal: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  // 方向二："改一下"触发的占位提示（覆盖默认 placeholder）
  hint: { type: String, default: '' },
  // 形态：dock（底部常驻窄条，默认）| hero（空态中央宽输入框——DeepSeek 神似，
  // 2026-09-27 用户口径：第一次对话时放中间、宽一点；有对话后回底部 dock）
  variant: { type: String, default: 'dock' },
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
  if (props.hint) return props.hint
  if (props.suspended) return '补充信息……'
  // 运行中：写请求还没发出时**可以直接说纠正话**（点了就是"停掉原任务、按新说法重来"）；
  // 写请求已发出才锁死（此时中断是谎言）。为什么区分：界面上出现一个"点了没反应"的按钮最糟。
  if (props.pending) {
    return props.disabled ? '正在办理……' : '要改口就直接说新的说法（例如：不是周三，是周四）'
  }
  if (props.terminal) return '继续说点什么，或接着办下一件……'
  return '用一句话说明要办的事'
})

/**
 * 按钮文案要说清"点下去会发生什么"：
 * 运行中点是**改口重来**（先停原任务、再按新说法起一轮），不是"再发一句"。
 */
const actionLabel = computed(() => {
  if (props.pending) return '改口重来'
  if (props.suspended) return '回复'
  return '发送'
})

function onInput(e) {
  emit('update:modelValue', e.target.value)
}

function onKeydown(e) {
  emit('keydown', e)
}
</script>

<template>
  <div class="composer" :class="variant">
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
    <!-- 运行中不再一律禁用：写请求未发出时，"发送"就是**改口**（否则改口路径根本没有入口，
         ChatPane.send() 里那段处理永远走不到）。写请求已发出时由父组件传 disabled 锁死。 -->
    <button
      class="btn btn-primary"
      :disabled="!modelValue.trim() || disabled"
      :aria-label="actionLabel"
      @click="emit('send')"
    >
      <IconSend :size="14" />
      {{ actionLabel }}
    </button>
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
}

/* 空态中央宽输入框（hero）：不扁平——更宽、圆角更大、内边距更厚、输入字号更大。
   宽度按视口百分比自适应（约 50%，DeepSeek 神似；浏览器窄了自动变窄），
   上限 680px 防超宽屏拉散。 */
.composer.hero {
  width: min(50vw, 680px);
  max-width: 100%;
  padding: 14px 10px 14px 18px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.composer.hero .input {
  padding: var(--space-2) 6px;
  font-size: var(--text-base);
}

.composer.hero .btn {
  padding: 10px 18px;
  font-size: var(--text-md);
  border-radius: var(--radius-medium);
}

@media (prefers-reduced-motion: reduce) {
  .composer {
    transition: none;
  }
}

@media (max-width: 480px) {
  .composer {
    flex-direction: column;
  }

  .composer .btn {
    width: 100%;
  }

  .composer.hero {
    width: 100%;
    padding: 12px 10px;
  }
}
</style>
