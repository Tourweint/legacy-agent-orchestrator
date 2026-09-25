// 判定算子单测 —— SEAT 归并口径（基线 §8.4）、J3 过滤、严格不等号、C1 空值、阈值、J2 条件

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluatePredicate,
  seatRowAttribution,
  renderTemplate,
  normalizeSpace,
} from '../src/judgment/predicates.js'
import { ConfigStore } from '../src/config/config-store.js'

const store = new ConfigStore()
const constants = store.getConstants()

function ctx(overrides = {}) {
  return {
    facts: {
      F3: { state: 'obtained', value: { seatIds: [309], occupiedSeatCount: 1 }, meta: {} },
      F4: { state: 'obtained', value: [], meta: {} },
      F6: { state: 'obtained', value: [], meta: {} },
      ...overrides.facts,
    },
    constants,
    identity: { id: 'TEACHER', userId: 10018 },
    target: {
      classroom: { classroomId: 5, building: '数智楼', roomNumber: '123' },
      slot: { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z') },
      ...overrides.target,
    },
    ...overrides,
  }
}

test('SEAT 归并：resourceName 前缀匹配（数智楼 123 归并「数智楼 123 3-5」，不误配「数智楼 1234」）', () => {
  const classroom = { building: '数智楼', roomNumber: '123' }
  assert.equal(seatRowAttribution({ resourceName: '数智楼 123 3-5' }, classroom), true)
  // 源码拼接保证单空格；normalizeSpace 只收敛连续空白，不做激进去空格
  assert.equal(seatRowAttribution({ resourceName: '数智楼123 3-5' }, classroom), false)
  assert.equal(seatRowAttribution({ resourceName: '数智楼 1234 1-1' }, classroom), false) // 12/123 前缀碰撞防御
  assert.equal(seatRowAttribution({ resourceName: '电信楼 111 2-2' }, classroom), false)
  assert.equal(seatRowAttribution({ resourceName: null }, classroom), false)
  assert.equal(seatRowAttribution({ resourceName: '数智楼 123 3-5' }, { building: '数智楼' }), false) // 基准不全
})

test('overlap-exists：J3 过滤——仅计 ACTIVE；CANCELLED/EXPIRED 重叠记录不算占用', () => {
  const mkRow = (status) => ({
    recordId: 118,
    userId: 10019,
    resourceType: 'CLASSROOM',
    resourceId: 5,
    resourceName: '数智楼 123',
    start: new Date('2026-09-30T05:00:00Z'),
    end: new Date('2026-09-30T06:00:00Z'),
    status,
  })
  for (const status of ['CANCELLED', 'EXPIRED']) {
    const result = evaluatePredicate(
      { op: 'overlap-exists', fact: 'F4', writer: 'any' },
      ctx({ facts: { F4: { state: 'obtained', value: [mkRow(status)], meta: {} } } }),
    )
    assert.equal(result.satisfied, false, `${status} 记录不得判占用`)
  }
  const active = evaluatePredicate(
    { op: 'overlap-exists', fact: 'F4', writer: 'any' },
    ctx({ facts: { F4: { state: 'obtained', value: [mkRow('ACTIVE')], meta: {} } } }),
  )
  assert.equal(active.satisfied, true)
  assert.equal(active.matched.recordId, 118)
})

test('overlap-exists：严格不等号（C8）——紧邻不算重叠；writer=self 按 userId 匹配', () => {
  const row = {
    recordId: 116, userId: 10019, resourceType: 'CLASSROOM', resourceId: 5,
    start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z'), status: 'ACTIVE',
  }
  // 紧邻 14:00–15:00（08:00Z–07:00Z 表述：05:00–06:00 之后的 06:00–07:00Z）
  const adjacent = evaluatePredicate(
    { op: 'overlap-exists', fact: 'F4', writer: 'any' },
    ctx({ target: { classroom: { classroomId: 5 }, slot: { start: new Date('2026-09-30T06:00:00Z'), end: new Date('2026-09-30T07:00:00Z') } }, facts: { F4: { state: 'obtained', value: [row], meta: {} } } }),
  )
  assert.equal(adjacent.satisfied, false)
  // writer=self：别人的记录不命中
  const other = evaluatePredicate({ op: 'overlap-exists', fact: 'F4', writer: 'self' }, ctx({ facts: { F4: { state: 'obtained', value: [row], meta: {} } } }))
  assert.equal(other.satisfied, false)
  // writer=self：自己的记录命中
  const mine = evaluatePredicate(
    { op: 'overlap-exists', fact: 'F4', writer: 'self' },
    ctx({ facts: { F4: { state: 'obtained', value: [{ ...row, userId: 10018 }], meta: {} } } }),
  )
  assert.equal(mine.satisfied, true)
})

test('writer=self 但缺少 userId 时抛 JudgmentError（宁可无法确认，不可误判成立）', () => {
  assert.throws(
    () =>
      evaluatePredicate(
        { op: 'overlap-exists', fact: 'F4', writer: 'self' },
        ctx({ identity: { id: 'TEACHER', userId: null } }),
      ),
    (err) => err.name === 'JudgmentError' && /userId/.test(err.message),
  )
})

test('maintenance-overlaps：排除法——不在失效集合中即视为生效中；classroomId 或 resourceId 归属', () => {
  const mk = (status) => ({
    windowId: 3, resourceType: 'CLASSROOM', resourceId: 5, classroomId: 5,
    start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z'), status,
  })
  for (const status of ['CANCELLED', 'CANCELED', 'FINISHED', 'EXPIRED', 'CLOSED']) {
    const r = evaluatePredicate({ op: 'maintenance-overlaps', fact: 'F6' }, ctx({ facts: { F6: { state: 'obtained', value: [mk(status)], meta: {} } } }))
    assert.equal(r.satisfied, false, `${status} 应被失效集合排除`)
  }
  // 未登记的新状态 → 保守视为生效中（排除法的意义所在）
  const unknown = evaluatePredicate({ op: 'maintenance-overlaps', fact: 'F6' }, ctx({ facts: { F6: { state: 'obtained', value: [mk('SOME_NEW_STATE')], meta: {} } } }))
  assert.equal(unknown.satisfied, true)
})

test('value-in-set：空 status 归一为空串参与集合 membership（C1 空值视为启用）', () => {
  const result = evaluatePredicate(
    { op: 'value-in-set', fact: 'F1', path: 'status', set: 'classroomEnabledStates' },
    ctx({ facts: { F1: { state: 'obtained', value: { status: null }, meta: {} } } }),
  )
  assert.equal(result.satisfied, true)
  assert.equal(result.value, null) // 话术仍引用实际读到的值
})

test('slot-exceeds-matched：申请区间超出已有时段才成立（J2）', () => {
  const matched = { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z') }
  const base = { target: { slot: { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:30:00Z') } }, matched }
  assert.equal(evaluatePredicate({ op: 'slot-exceeds-matched' }, base).satisfied, true) // 14:30 > 14:00
  const contained = evaluatePredicate(
    { op: 'slot-exceeds-matched' },
    { target: { slot: { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z') } }, matched },
  )
  assert.equal(contained.satisfied, false) // 完全一致 → 不追加提示
})

test('话术渲染：{{路径}} 点路径取值，缺失渲染 (未知)', () => {
  assert.equal(renderTemplate('预约 #{{matched.recordId}}，{{matched.slotText}}', { matched: { recordId: 118, slotText: '09-30 13:00–14:00' } }), '预约 #118，09-30 13:00–14:00')
  assert.equal(renderTemplate('{{a.b.c}}', { a: {} }), '(未知)')
})

test('SEAT 行 resourceType 非 CLASSROOM 且 resourceName 无法归属 → 不命中（保守不误判）', () => {
  const row = {
    recordId: 200, userId: 10019, resourceType: 'SEAT', resourceId: 370,
    resourceName: '电信楼 111 2-2', start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z'), status: 'ACTIVE',
  }
  const r = evaluatePredicate({ op: 'overlap-exists', fact: 'F4', writer: 'any' }, ctx({ facts: { F4: { state: 'obtained', value: [row], meta: {} } } }))
  assert.equal(r.satisfied, false)
})

test('normalizeSpace：空白归一', () => {
  assert.equal(normalizeSpace('  数智楼   123 '), '数智楼 123')
})
