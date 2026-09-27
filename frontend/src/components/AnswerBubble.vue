<script setup>
// 答案卡（L1）—— 一轮对话里**唯一默认可见**的助手内容，也是这一轮的最终答话。
//
// 口径（2026-09-27）：答案**用大字给出**，且**只出现一次**——思考过程里不再重复结论
// （见 composables/useThinking.js 的 isAnswerEvent）。
// 结论文案来自引擎（result.conclusion / terminal 事件），本组件不新造句子：只把同一段文本
// 分层展示——主答话（用户要的答案）。
// 2026-09-27（第二次）：顶部"已办成 / N 步"徽章行移除（用户口径：外部只留最重要的结果，
// 步数等信息全部收进"思考"模块——见 docs/变更记录/2026-09-27-思考折叠回归与移除理解卡.md
// 之后的调整记录）。

import { computed } from 'vue'

const props = defineProps({
  turn: { type: Object, required: true },
})

const result = computed(() => props.turn?.result ?? null)
const terminalEvent = computed(
  () => props.turn?.events?.find((e) => e.type === 'terminal') ?? null,
)

/** done | failed | unsure | cancelled | null（未终态就不渲染） */
const kind = computed(() => {
  if (props.turn?.cancelled) return 'cancelled'
  const t = result.value?.terminal
  if (!t) return terminalEvent.value ? 'done' : null
  if (t === 'DONE') return 'done'
  if (t === 'UNRESOLVED') return 'unsure'
  return 'failed'
})

const conclusion = computed(() => result.value?.conclusion ?? terminalEvent.value?.text ?? '')

/**
 * 引擎会把"推算依据"（§7.3 请确认）拼在结论末尾，如
 * "该时段不可用：… （请确认：今天是周日…；「上午」= 08:00–12:00…）"。
 * 2026-09-27 起推算依据不再展示（用户只看最重要的结果）——这里仍把它从正文里剥掉，
 * 避免"（请确认：…）"残留在大字结论里。不新造句子，只是分层。
 */
const parsed = computed(() => {
  const text = conclusion.value
  const m = /（请确认：([\s\S]+?)）\s*$/.exec(text)
  if (!m) return { main: text, notes: [] }
  return {
    main: text.slice(0, m.index).trim(),
    notes: m[1].split('；').map((s) => s.trim()).filter(Boolean),
  }
})

/**
 * 结构化渲染（2026-09-27）：引擎侧列表类结论已是多行（`1. …\n2. …`），
 * 这里按行拆成块级段落——换行不会再被折叠成"摞在一起"的一行；
 * 以 `数字. ` 开头的行识别为列表项，悬挂缩进让序号与正文对齐。
 */
const paragraphs = computed(() =>
  parsed.value.main
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
)
const isItem = (line) => /^\d+\.\s/.test(line)
</script>

<template>
  <div v-if="kind" class="answer" :class="'is-' + kind">
    <template v-for="(line, i) in paragraphs" :key="i">
      <p class="text" :class="{ item: isItem(line) }">{{ line }}</p>
    </template>
  </div>
</template>

<style scoped>
/* 结论紧贴上方"思考"（思考块已用负 margin 抵消 flex gap，这里顶部不再加距） */
.answer {
  margin: 0 0 var(--space-2);
  padding: 0;
}

.is-cancelled .text {
  color: var(--text-muted);
}

/* 大字答案：这是用户要的那句话，值得用整个卡片的视觉重心去承载。
   结构化（2026-09-27）：多行结论按行渲染为块级段落，列表行（`N. `）悬挂缩进。 */
.text {
  margin: 0.15em 0 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-medium);
  line-height: 1.55;
  color: var(--text);
  word-break: break-word;
}

.text:first-child {
  margin-top: 0;
}

.text.item {
  padding-left: 2.4em;
  text-indent: -2.4em;
}

@media (max-width: 480px) {
  .answer {
    padding: var(--space-3);
  }

  .text {
    font-size: var(--text-lg);
  }
}
</style>
