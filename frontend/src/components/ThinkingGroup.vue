<script setup>
// 思考过程的一个小节（"像书一样展开"的第二层）：
// 大标题"思考"展开后，中间过程按类型分成两个小部分——
//   · "思考了什么"：理解 / 判定 / 结果判断（P1/P2/P4 的行）
//   · "执行了什么"：调用存量系统 / 恢复补偿（P3/P5/P6 的行）
// 只做分组与排版，文案全部来自行自带 text，不新造句子。
// 逐条淡入（思考一条出来一条）：运行中事件流进来时每条要点行轻轻浮现。
import ThinkingLine from './ThinkingLine.vue'

defineProps({
  title: { type: String, required: true },
  lines: { type: Array, required: true },
})
</script>

<template>
  <section v-if="lines.length > 0" class="group">
    <h4 class="group-title">{{ title }}</h4>
    <TransitionGroup name="line" tag="div" class="group-lines">
      <ThinkingLine v-for="l in lines" :key="`${l.phase}-${l.seq ?? l.text}`" :line="l" />
    </TransitionGroup>
  </section>
</template>

<style scoped>
.group {
  margin: var(--space-1) 0 0;
}

.group-title {
  margin: 0 0 2px;
  font-size: 11px;
  font-weight: var(--weight-medium);
  color: var(--text-faint);
  letter-spacing: 0.02em;
}

.group-lines {
  display: flex;
  flex-direction: column;
}

/* 逐条淡入：运行中每来一条要点就轻轻浮现（"思考一条出来一条"）。
   enter 类由 TransitionGroup 加到行根元素（ThinkingLine 的 .line）上，
   父组件 scoped 样式对子组件根节点同样生效。 */
.line-enter-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

.line-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
</style>
