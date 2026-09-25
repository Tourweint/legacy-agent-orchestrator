// 判定引擎测试 —— 阶段 2 验收三条：
//   ① 新增一条只依赖已有事实的命题 → 代码零改动（临时配置目录加 YAML 即生效）
//   ② 事实不可得 → 结论是"无法确认"而非"不成立"
//   ③ 降级交叉印证口径 + 两次求值互不串用事实（C10 不缓存）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeGateway, ok, httpOnly, UIDS, sessionIdentity } from './helpers/fake-legacy.js'
import { JudgmentEngine } from '../src/judgment/judgment-engine.js'
import { ConfigStore } from '../src/config/config-store.js'

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'config')

const SLOT = { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z') } // 北京 13:00–14:00
const DETAIL = { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' }

// wire 行（裸 JSON，时间无时区标记——按 UTC 解释由适配器完成）
const wireRow = (over = {}) => ({
  id: 118,
  userId: UIDS['233'],
  username: '233',
  resourceType: 'CLASSROOM',
  resourceId: 5,
  resourceName: '数智楼 123',
  startTime: '2026-09-30T05:00:00',
  endTime: '2026-09-30T06:00:00',
  status: 'ACTIVE',
  ...over,
})

function makeEngine(world) {
  const { gateway, transport } = makeGateway((req) => {
    switch (req.path) {
      case '/classrooms/5': return world.detail ?? ok(DETAIL)
      case '/classrooms/available_list': return world.available ?? ok(world.availableRows ?? [])
      case '/classrooms/5/reserved_seats': return world.seats ?? ok([])
      case '/admin/reservations': return world.adminList ?? ok(world.adminRows ?? [])
      case '/reservations': return world.mine ?? ok(world.mineRows ?? [])
      case '/admin/maintenance': return world.maintenance ?? ok(world.maintenanceRows ?? [])
      default: return httpOnly(404)
    }
  })
  const engine = new JudgmentEngine({ configStore: gateway.store, gateway, evidenceChain: gateway.chain })
  return { engine, transport }
}

const evaluate = (world, target = {}, extra = {}) => {
  const { engine } = makeEngine(world)
  return engine.evaluateIntent({
    intentId: 'borrow-classroom',
    target: { classroom: target.classroom ?? { classroomId: 5 }, slot: target.slot ?? SLOT },
    identity: sessionIdentity('TEACHER'),
    ...extra,
  })
}

const byId = (result, id) => result.results.find((r) => r.id === id)

test('正常链路：教室存在且启用、时段空闲、无维修 → 全部命题成立', async () => {
  const result = await evaluate({})
  assert.equal(result.summary.allSatisfied, true)
  for (const id of ['P-CLASSROOM-EXISTS', 'P-CLASSROOM-ENABLED', 'P-NOT-ALREADY-MINE', 'P-SLOT-FREE', 'P-NOT-UNDER-MAINTENANCE']) {
    assert.equal(byId(result, id).conclusion, 'SATISFIED', id)
  }
  // 事实快照随结果返回（J6：轮内候选共用）
  assert.equal(result.facts.F1.value.classroomId, 5)
  assert.equal(result.facts.F4.meta.total, 0)
})

test('别人占用（F4 跨身份记录重叠）→ P-SLOT-FREE 不成立且可降级；本人查重成立', async () => {
  const result = await evaluate({ adminRows: [wireRow({ userId: 10019, username: '别人' })] })
  const slotFree = byId(result, 'P-SLOT-FREE')
  assert.equal(slotFree.conclusion, 'VIOLATED')
  assert.equal(slotFree.message, '该教室在这段时间已被预约')
  assert.equal(slotFree.degradable, true)
  assert.equal(byId(result, 'P-NOT-ALREADY-MINE').conclusion, 'SATISFIED')
  assert.equal(result.summary.hasDegradableConflict, true)
})

test('自己已提交（C6 幂等命中）→ ALREADY_DONE 事件 + 话术含记录号与人可读时段', async () => {
  const result = await evaluate({ adminRows: [wireRow()] }) // userId = TEACHER 本人
  const mine = byId(result, 'P-NOT-ALREADY-MINE')
  assert.equal(mine.conclusion, 'VIOLATED')
  assert.equal(mine.violatedEvent, 'ALREADY_DONE')
  assert.equal(mine.alreadyDone, true)
  assert.ok(mine.message.includes('预约 #118'))
  assert.ok(mine.message.includes('13:00')) // J2：完整给出已有时段
  assert.equal(result.summary.alreadyDone, true)
})

test('J2：申请区间超出已有时段 → 幂等命中话术追加完整时段提示', async () => {
  const result = await evaluate(
    { adminRows: [wireRow()] },
    { slot: { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:30:00Z') } }, // 13:00–14:30
  )
  const mine = byId(result, 'P-NOT-ALREADY-MINE')
  assert.equal(mine.conclusion, 'VIOLATED')
  assert.equal(mine.appendixApplied, true)
  assert.ok(mine.message.includes('如需完整时段'))
})

test('座位占用（F3 > 0）→ 不成立；全量座位（≥ 容量）→ 歧义标记 + 交叉判定话术', async () => {
  const partial = await evaluate({ seats: ok([309, 310]) })
  const partialSlot = byId(partial, 'P-SLOT-FREE')
  assert.equal(partialSlot.conclusion, 'VIOLATED')
  assert.equal(partialSlot.message, '该教室在这段时间已有安排')
  assert.ok(!partialSlot.ambiguity)

  const full = await evaluate({ seats: ok(Array.from({ length: 48 }, (_, i) => 300 + i)) })
  const fullSlot = byId(full, 'P-SLOT-FREE')
  assert.equal(fullSlot.conclusion, 'VIOLATED')
  assert.equal(fullSlot.ambiguity, true)
  assert.ok(fullSlot.message.includes('交叉判定'))
})

test('维修窗口：ACTIVE 重叠 → 不成立（话术含窗口时段）；CANCELLED → 排除后成立', async () => {
  const active = await evaluate({
    maintenanceRows: [{ id: 3, resourceType: 'CLASSROOM', resourceId: 5, classroomId: 5, startTime: '2026-09-30T04:00:00', endTime: '2026-09-30T07:00:00', status: 'ACTIVE' }],
  })
  const violated = byId(active, 'P-NOT-UNDER-MAINTENANCE')
  assert.equal(violated.conclusion, 'VIOLATED')
  assert.ok(violated.message.includes('检修'))
  assert.ok(violated.message.includes('12:00')) // 窗口 04:00Z–07:00Z = 北京 12:00–15:00

  const cancelled = await evaluate({
    maintenanceRows: [{ id: 3, resourceType: 'CLASSROOM', resourceId: 5, classroomId: 5, startTime: '2026-09-30T04:00:00', endTime: '2026-09-30T07:00:00', status: 'CANCELLED' }],
  })
  assert.equal(byId(cancelled, 'P-NOT-UNDER-MAINTENANCE').conclusion, 'SATISFIED')
})

test('教室不存在（名字解析无匹配）→ EXISTS 不成立并列出可用项；其余命题不适用', async () => {
  const result = await evaluate(
    {
      availableRows: [
        { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' },
        { id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' },
      ],
    },
    { classroom: { building: '数智楼', roomNumber: '999' } },
  )
  const exists = byId(result, 'P-CLASSROOM-EXISTS')
  assert.equal(exists.conclusion, 'VIOLATED')
  assert.ok(exists.message.includes('999'))
  assert.ok(exists.message.includes('数智楼 123（48 座）')) // 话术列出可用项（I4 最可感的细节）
  assert.equal(byId(result, 'P-CLASSROOM-ENABLED').conclusion, 'NOT_APPLICABLE')
  assert.equal(byId(result, 'P-SLOT-FREE').conclusion, 'NOT_APPLICABLE')
})

test('验收②：F4 与 F5 都不可得 → P-NOT-ALREADY-MINE 是"无法确认 + C17 豁免"，不是"不成立"', async () => {
  const result = await evaluate({ adminList: httpOnly(500), mine: httpOnly(500) })
  const mine = byId(result, 'P-NOT-ALREADY-MINE')
  assert.equal(mine.conclusion, 'UNCONFIRMABLE')
  assert.equal(mine.disposition, 'exempt-continue')
  assert.ok(mine.exemption.includes('C17'))
  assert.deepEqual(result.summary.exemptContinue, ['P-NOT-ALREADY-MINE'])
  // P-SLOT-FREE：F3 空闲也证明不了（F4 不可得）→ 保守"无法确认"
  const slotFree = byId(result, 'P-SLOT-FREE')
  assert.equal(slotFree.conclusion, 'UNCONFIRMABLE')
  assert.ok(slotFree.message.includes('无法确认'))
  assert.equal(result.summary.allSatisfied, false)
})

test('验收②（降级可确证面）：F4 不可得但 F5 可得 → 本人查重降级后仍可成立', async () => {
  const result = await evaluate({ adminList: httpOnly(500) })
  const mine = byId(result, 'P-NOT-ALREADY-MINE')
  assert.equal(mine.conclusion, 'SATISFIED')
  assert.equal(mine.mode, 'degraded')
  // P-SLOT-FREE 降级后即使 F3 空闲也只能保守"无法确认"（别人的整间预约看不见）
  assert.equal(byId(result, 'P-SLOT-FREE').conclusion, 'UNCONFIRMABLE')
})

test('安全阈值（C5/§五.4）：列表超阈且未命中 → 降级为"无法确认"，绝不当"空闲"', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => wireRow({ id: 1000 + i, status: 'CANCELLED', userId: 10019, startTime: '2026-01-01T00:00:00', endTime: '2026-01-01T01:00:00' }))
  const result = await evaluate({ adminRows: rows })
  const slotFree = byId(result, 'P-SLOT-FREE')
  assert.equal(slotFree.conclusion, 'UNCONFIRMABLE')
  assert.equal(slotFree.downgraded, true)
  assert.ok(slotFree.message.includes('500'))
})

test('验收③：两次求值互不串用事实（C10 不缓存）——世界变了结论跟着变', async () => {
  const world = { adminRows: [] }
  const { engine, transport } = makeEngine(world)
  const call = () => engine.evaluateIntent({ intentId: 'borrow-classroom', target: { classroom: { classroomId: 5 }, slot: SLOT }, identity: sessionIdentity('TEACHER') })

  const first = await call()
  assert.equal(byId(first, 'P-SLOT-FREE').conclusion, 'SATISFIED')
  world.adminRows = [wireRow({ userId: 10019 })] // 世界变了：别人占了这个时段
  const second = await call()
  assert.equal(byId(second, 'P-SLOT-FREE').conclusion, 'VIOLATED')
  // 事实确实重新收集了（第二次又拉了全量列表）
  assert.equal(transport.callsTo('/admin/reservations').length, 2)
})

test('验收①：新增一条只依赖已有事实的命题 → 只加 YAML，代码零改动', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-prop-'))
  try {
    cpSync(CONFIG_DIR, dir, { recursive: true })
    const propPath = join(dir, 'propositions.yaml')
    const addition = `
  - id: P-CAPACITY-AT-LEAST-40
    semantics: 容量至少 40 人（演示"新增命题零改动"的验收命题）
    dependsOn: [F1]
    skipWhen: {op: classroom-unknown}
    when: {op: value-at-least, fact: F1, path: capacity, value: 40}
    violatedMessage: 该教室容量不足（{{matchedValue}} 座）。
    degradable: true
    invariants: [I1]
`
    writeFileSync(propPath, readFileSync(propPath, 'utf8') + addition)
    const planPath = join(dir, 'intent-plans.yaml')
    const plan = readFileSync(planPath, 'utf8').replace(
      '      - P-NOT-ALREADY-MINE        # 先查本人（幂等命中 → ALREADY_DONE → DONE，决策 C6）',
      '      - P-NOT-ALREADY-MINE        # 先查本人（幂等命中 → ALREADY_DONE → DONE，决策 C6）\n      - P-CAPACITY-AT-LEAST-40',
    )
    writeFileSync(planPath, plan)

    const store = new ConfigStore(dir)
    const { gateway } = makeGateway(() => ok(DETAIL))
    const engine = new JudgmentEngine({ configStore: store, gateway, evidenceChain: gateway.chain })
    const result = await engine.evaluateIntent({
      intentId: 'borrow-classroom',
      target: { classroom: { classroomId: 5 }, slot: SLOT },
      identity: sessionIdentity('TEACHER'),
    })
    const newProp = byId(result, 'P-CAPACITY-AT-LEAST-40')
    assert.ok(newProp, '新命题被引擎判定')
    assert.equal(newProp.conclusion, 'SATISFIED') // 容量 48 ≥ 40
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('名字解析路径：楼栋+房间号 → available_list 匹配 → 详情（F1 via name-lookup）', async () => {
  const result = await evaluate(
    {
      availableRows: [
        { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' },
        { id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' },
      ],
    },
    { classroom: { building: '数智楼', roomNumber: '123' } },
  )
  assert.equal(result.facts.F1.meta.via, 'name-lookup')
  assert.equal(result.facts.F1.value.classroomId, 5)
  assert.equal(result.summary.allSatisfied, true)
})
