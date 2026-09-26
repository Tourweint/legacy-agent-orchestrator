// 会话记忆测试 —— "上一句说的"必须能被下一句用上（跨任务的多轮记忆）。
//
// 为什么单独测它：一个 chat 任务只承载一轮，任务落终态即销毁运行栈——记忆若不落在
// 会话层，用户体感就是"上一句发这个、下一句发那个，它记不住"。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationStore } from '../src/access/conversation-store.js'

test('记一轮 → 下一轮拿到它的结构化摘要（原话 + 意图 + 槽位 + 结果）', () => {
  const store = new ConversationStore()
  store.recordTurn('C-1', 'alice', {
    text: '帮我借明天下午数智楼123',
    intent: 'borrow-classroom',
    slots: { classroomName: '数智楼123', datePhrase: '明天', timeSegment: '下午' },
    outcome: 'DONE',
  })

  const history = store.historyFor('C-1', 'alice')
  assert.equal(history.length, 2)
  assert.equal(history[0].role, 'user')
  assert.equal(history[0].content, '帮我借明天下午数智楼123')
  assert.equal(history[1].role, 'assistant')
  const summary = JSON.parse(history[1].content)
  assert.equal(summary.intent, 'borrow-classroom')
  assert.equal(summary.slots.classroomName, '数智楼123') // ← 下一句"那改成后天"靠它接上
  assert.equal(summary.outcome, 'DONE')
})

test('追问轮也记（挂起时 outcome=INPUT_REQUIRED）——下一句的"那……"依赖它', () => {
  const store = new ConversationStore()
  store.recordTurn('C-2', 'alice', {
    text: '帮我借数智楼222',
    intent: 'borrow-classroom',
    slots: { classroomName: '数智楼222' },
    outcome: 'INPUT_REQUIRED',
  })
  const summary = JSON.parse(store.historyFor('C-2', 'alice')[1].content)
  assert.equal(summary.outcome, 'INPUT_REQUIRED')
  assert.equal(summary.slots.classroomName, '数智楼222')
})

test('会话不跨用户：别人的会话拿不到历史，也不会被覆盖', () => {
  const store = new ConversationStore()
  store.recordTurn('C-3', 'alice', { text: 'alice 的话' })
  assert.deepEqual(store.historyFor('C-3', 'bob'), [])

  store.recordTurn('C-3', 'bob', { text: 'bob 的话' })
  assert.equal(store.historyFor('C-3', 'alice')[0].content, 'alice 的话')
})

test('resolveId：未知 id 照用（引擎重启后前端仍可续）；他人的 id 另发新 id', () => {
  const store = new ConversationStore()
  store.recordTurn('C-4', 'alice', { text: 'x' })
  const fresh = () => 'C-fresh'
  assert.equal(store.resolveId('C-unknown', 'alice', fresh), 'C-unknown')
  assert.equal(store.resolveId('C-4', 'alice', fresh), 'C-4')
  assert.equal(store.resolveId('C-4', 'bob', fresh), 'C-fresh')
  assert.equal(store.resolveId(undefined, 'alice', fresh), 'C-fresh')
})

test('有上限：注入历史轮数封顶、会话轮次封顶（上下文与内存都不无限涨）', () => {
  const store = new ConversationStore({ historyLimit: 2, maxTurns: 3 })
  for (let i = 1; i <= 5; i += 1) store.recordTurn('C-5', 'alice', { text: `第${i}句` })

  const history = store.historyFor('C-5', 'alice')
  assert.equal(history.length, 4) // 2 轮 ×（user + assistant）
  assert.equal(history[0].content, '第4句') // 只留最近的
  assert.equal(store.conversations.get('C-5').turns.length, 3)
})

test('空闲超时的会话被回收', () => {
  let now = 1000
  const store = new ConversationStore({ ttlMs: 100, now: () => now })
  store.recordTurn('C-6', 'alice', { text: 'x' })

  now = 1050
  assert.equal(store.cleanup(), 0)
  now = 2000
  assert.equal(store.cleanup(), 1)
  assert.equal(store.size(), 0)
})
