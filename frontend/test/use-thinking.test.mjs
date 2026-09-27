// 思考过程归并的测试 —— 把界面方案 §三/§四 的规则钉死在这里。
//
// 为什么值得单测：这是本轮界面改造里**唯一有逻辑**的部分。规则错了，界面再漂亮也是错的
// （最典型的：把"办成"误判成"没办成"，一办完就自动摊开失败链）。纯函数，node 直接跑。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildThinking, defaultModeFor, formatDuration } from '../src/composables/useThinking.js'

// 事件形态取自 event-stream.js 的 mapEntryToEvent（每条都带 phase 与 at）
const ev = (over = {}) => ({
  seq: 1,
  phase: 'P2',
  type: 'proposition-judged',
  status: 'done',
  text: '',
  at: '2026-09-26T05:00:00.000Z',
  ...over,
})

const UNDERSTAND = (seq) =>
  ev({
    seq,
    phase: 'P1',
    type: 'decision',
    status: 'done',
    text: '识别为「借教室」· 教室=数智楼123 · 日期=明天 · 时间=下午两点到四点',
  })

test('办成：判定与调用各自只报计数，折叠块默认收起', () => {
  const t = buildThinking(
    [
      UNDERSTAND(1),
      ev({ seq: 2, text: '找到了这间教室' }),
      ev({ seq: 3, text: '这间教室现在可以预约' }),
      ev({ seq: 4, text: '这个时段是空的' }),
      ev({ seq: 5, phase: 'P3', type: 'call', status: 'done', text: '提交教室预约 · 教师身份' }),
      ev({ seq: 6, phase: 'P6', type: 'terminal', status: 'done', text: '已为您订好' }),
    ],
    { taskStatus: 'terminal' },
  )

  assert.equal(t.steps, 5, '步骤数不含结论事件（terminal 归答案卡）')
  const texts = t.lines.map((l) => l.text)
  assert.ok(texts.includes('判定 3 项全部通过'), '成功的判定只报计数')
  assert.ok(texts.includes('调用 1 次，全部成功'))
  assert.equal(t.failCount, 0)
  assert.equal(t.defaultMode, 'collapsed', '办成时收起——一屏只剩结论')
  // "部分展开"集合里只有理解行（它解释了"为什么它这么理解"）
  assert.deepEqual(
    t.lines.filter((l) => l.focus).map((l) => l.phase),
    ['P1'],
  )
})

test('办不成：展开失败链（汇总行 + 失败行 + 理解行），其余仍收起', () => {
  const t = buildThinking(
    [
      UNDERSTAND(1),
      ev({ seq: 2, text: '找到了这间教室' }),
      ev({ seq: 3, text: '这间教室现在可以预约' }),
      ev({ seq: 4, text: '这个时段是空的', status: 'failed' }),
      ev({ seq: 5, text: '这间教室这段时间不在检修' }),
      ev({ seq: 6, text: '我没有重复提交过同一时段' }),
      ev({ seq: 7, phase: 'P3', type: 'call', status: 'done', text: '查询全量预约（跨身份）· 只读身份' }),
      ev({ seq: 8, phase: 'P6', type: 'terminal', status: 'failed', text: '这个时段已被别人占了' }),
    ],
    { taskStatus: 'terminal' },
  )

  const focusTexts = t.lines.filter((l) => l.focus).map((l) => l.text)
  assert.ok(focusTexts.includes('识别为「借教室」· 教室=数智楼123 · 日期=明天 · 时间=下午两点到四点'))
  assert.ok(focusTexts.includes('判定 5 项，其中 1 项没通过'), '汇总行要在——它是"为什么是这个结果"的来处')
  assert.ok(focusTexts.includes('这个时段是空的'), '失败项逐条要列出来')
  assert.equal(t.failCount, 1, '失败计数只数逐条判定项，不把汇总行算成第二项')
  assert.equal(t.defaultMode, 'partial', '办不成时部分展开')
  assert.ok(t.hiddenCount > 0, '其余要点仍收起')
})

test('运行中与挂起全展开；终态按失败链决定', () => {
  assert.equal(defaultModeFor('running', 0), 'full')
  assert.equal(defaultModeFor('suspended', 0), 'full')
  assert.equal(defaultModeFor('terminal', 0), 'collapsed')
  assert.equal(defaultModeFor('terminal', 2), 'partial')
})

test('办成了就收起过程：查询的"不可用"答复也是办成，不该主动摊开依据', () => {
  assert.equal(defaultModeFor('terminal', 2, 'DONE'), 'collapsed')
  assert.equal(defaultModeFor('terminal', 2, 'REJECTED'), 'partial', '没办成才展开失败链')
  assert.equal(defaultModeFor('terminal', 1, 'UNRESOLVED'), 'partial', '待确认同样要看依据')
})

test('不适用（not-applicable）不算失败，不进失败链', () => {
  const t = buildThinking([UNDERSTAND(1), ev({ seq: 2, status: 'not-applicable', text: '这条不适用' })], {
    taskStatus: 'terminal',
  })
  assert.equal(t.failCount, 0)
  assert.equal(t.defaultMode, 'collapsed')
  assert.ok(t.lines.some((l) => l.text === '判定 1 项全部通过'))
})

test('不确定必须被看见（I3：不确定不悬空，对用户也一样）', () => {
  const t = buildThinking(
    [
      UNDERSTAND(1),
      ev({ seq: 2, phase: 'P4', type: 'uncertain', status: 'uncertain', text: '提交结果存疑 · 正在核对' }),
    ],
    { taskStatus: 'terminal' },
  )
  assert.ok(t.lines.some((l) => l.focus && l.status === 'uncertain'))
  assert.equal(t.defaultMode, 'partial')
})

test('步数与耗时来自事件自身（不依赖 phase-start/phase-end）', () => {
  const t = buildThinking([
    ev({ seq: 1, at: '2026-09-26T05:00:00.000Z' }),
    ev({ seq: 2, at: '2026-09-26T05:00:02.400Z' }),
  ])
  assert.equal(t.steps, 2)
  assert.equal(t.durationMs, 2400)
  assert.equal(formatDuration(2400), '2.4 秒')
  assert.equal(formatDuration(12000), '12 秒')
  assert.equal(formatDuration(72000), '1 分 12 秒')
  assert.equal(formatDuration(0), '0 秒')
})

test('明细（L3）保留全部**过程**证据，不丢任何一条', () => {
  const events = [UNDERSTAND(1), ev({ seq: 2, phase: 'P6', type: 'audit', status: 'done', text: '审计' })]
  const t = buildThinking(events, { taskStatus: 'terminal' })
  assert.equal(t.details.length, 2)
  assert.deepEqual(
    t.details.map((e) => e.seq),
    [1, 2],
  )
})

test('结论不进思考过程：terminal 与 P2 之后的 decision 都不是"步骤"', () => {
  const t = buildThinking(
    [
      UNDERSTAND(1),
      ev({ seq: 2, phase: 'P2', type: 'decision', status: 'done', text: '该教室在这个时段可以使用。' }),
      ev({ seq: 3, phase: 'P6', type: 'terminal', status: 'done', text: '该教室在这个时段可以使用。' }),
    ],
    { taskStatus: 'terminal' },
  )
  assert.equal(t.steps, 1, '只剩"识别为…"这一步；答案是答案，不是过程')
  assert.deepEqual(
    t.details.map((e) => e.seq),
    [1],
  )
})

test('空事件：不报错，收起', () => {
  const t = buildThinking([], { taskStatus: 'idle' })
  assert.equal(t.steps, 0)
  assert.deepEqual(t.lines, [])
  assert.equal(t.defaultMode, 'collapsed')
})
