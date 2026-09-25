<script setup>
import { ref } from 'vue'
import { useTaskStore } from '../stores/task.js'

const store = useTaskStore()
const draft = ref(
  JSON.stringify(
    {
      intentId: 'borrow-classroom',
      identity: 'TEACHER',
      slot: { start: '2026-09-30T05:00:00Z', end: '2026-09-30T06:00:00Z' },
      resources: [{ classroom: { classroomId: 5 } }],
    },
    null,
    2,
  ),
)
const error = ref('')

async function submit() {
  error.value = ''
  try {
    const task = JSON.parse(draft.value)
    await store.startStructured(task)
  } catch (err) {
    error.value = `JSON 解析失败：${err.message}`
  }
}
</script>

<template>
  <div class="panel">
    <p class="muted">直接提交结构化任务（无大模型路径；混沌实验与回归使用同一入口）。</p>
    <textarea v-model="draft" rows="8" spellcheck="false"></textarea>
    <div v-if="error" class="err">{{ error }}</div>
    <button class="primary" @click="submit">提交结构化任务</button>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.panel p {
  margin: 0;
  font-size: 12px;
}

textarea {
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
}

.err {
  color: var(--status-danger);
  font-size: 12px;
}

button {
  align-self: flex-start;
}
</style>
