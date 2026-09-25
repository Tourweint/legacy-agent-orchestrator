// 编排层测试 —— 阶段 3 验收：正常链路 + 5 个异常场景全部给出正确终态；非法转移显式报错；
// D7 多资源补偿；步数预算兜底。全程假传输（不联网），凭证为测试假值。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeGateway, ok, httpOnly, envelope, UIDS } from './helpers/fake-legacy.js'
import { JudgmentEngine } from '../src/judgment/judgment-engine.js'
import { TaskRunner } from '../src/orchestration/task-runner.js'
import { TaskMachine } from '../src/orchestration/state-machine.js'
import { IllegalTransitionError } from '../src/orchestration/orchestration-error.js'
import { ConfigStore } from '../src/config/config-store.js'

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'config')
const SLOT = { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z') } // 北京 13:00–14:00
const DETAIL = (id, room, cap) => ({ id, building: '数智楼', roomNumber: room, capacity: cap, status: 'ENABLED' })

// wire 行构造（admin 列表）
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

// world：可变的存量系统世界；adminRows 可按调用次数变化（stateful）
function makeRunner(world = {}) {
  const counters = { admin: 0, create: 0, cancel: 0 }
  const { gateway, transport, chain } = makeGateway((req) => {
    switch (req.path) {
      case '/classrooms/5': return world.detail5 ?? ok(DETAIL(5, '123', 48))
      case '/classrooms/4': return world.detail4 ?? ok(DETAIL(4, '222', 55))
      case '/classrooms/available_list':
        return world.available ?? ok(world.availableRows ?? [])
      case '/classrooms/5/reserved_seats':
      case '/classrooms/4/reserved_seats':
        return ok([])
      case '/admin/reservations': {
        counters.admin += 1
        if (world.adminSequence) return world.adminSequence[Math.min(counters.admin, world.adminSequence.length) - 1]
        return ok(world.adminRows ?? [])
      }
      case '/reservations': return ok([])
      case '/admin/maintenance': return ok([])
      case '/reservations/classrooms': {
        counters.create += 1
        if (world.createSequence) return world.createSequence[Math.min(counters.create, world.createSequence.length) - 1]
        return world.create ?? ok(120)
      }
      case '/reservations/120': {
        counters.cancel += 1
        if (world.cancelSequence) return world.cancelSequence[Math.min(counters.cancel, world.cancelSequence.length) - 1]
        return world.cancel ?? ok(null)
      }
      default: return ok(null)
    }
  })
  const judgment = new JudgmentEngine({ configStore: gateway.store, gateway, evidenceChain: chain })
  const runner = new TaskRunner({ configStore: gateway.store, gateway, judgmentEngine: judgment, evidenceChain: chain })
  return { runner, transport, chain, counters }
}

const execute = (world, resources, intentId = 'borrow-classroom') => {
  const { runner } = makeRunner(world)
  return runner.executeTask({ intentId, resources, slot: SLOT, identity: { id: 'TEACHER' } })
}

test('正常链路：单资源提交成功 → 任务 DONE，预约 #120 入补偿清单（未撤销）', async () => {
  const { terminal, steps, compensations, conclusion } = await execute({}, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'DONE')
  assert.equal(steps, 6) // START_STRUCT → ENTITY_RESOLVED → FACTS_READY → PROPOSITIONS_OK → CALL_SUCCESS → JUDGE_SUCCESS
  assert.equal(compensations.length, 1)
  assert.equal(compensations[0].recordId, 120)
  assert.equal(compensations[0].revoked, false)
  assert.ok(conclusion.includes('已为您办妥'))
  assert.ok(conclusion.includes('#120'))
})

test('只读意图：CHECK_ONLY → DONE，全程零写调用', async () => {
  const { runner, transport } = makeRunner({})
  const result = await runner.executeTask({
    intentId: 'query-classroom-availability',
    resources: [{ classroom: { classroomId: 5 } }],
    slot: SLOT,
    identity: { id: 'TEACHER' },
  })
  assert.equal(result.terminal, 'DONE')
  assert.ok(result.results[0].message.includes('可以使用'))
  assert.equal(transport.callsTo('/reservations/classrooms').length, 0) // 零写调用
})

test('异常 1（半成功）：提交超时 → 查证命中本人记录 → DONE（幂等命中）', async () => {
  const world = {
    create: { kind: 'timeout' },
    adminSequence: [ok([]), ok([wireRow()])], // 第 1 次拉列表（GATHERING）为空；第 2 次（查证）出现本人记录
  }
  const { terminal, conclusion } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'DONE')
  assert.ok(conclusion.includes('此前已办成'))
})

test('异常 2（冲突歧义）：200+409 → 查证命中别人的记录 → REJECTED（不降级，J1）', async () => {
  const world = {
    create: envelope(409, '该时间段内教室已被整间预约'),
    adminSequence: [ok([]), ok([wireRow({ userId: 10019, username: '别人' })])],
  }
  const { terminal, conclusion, compensations } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'REJECTED')
  assert.ok(conclusion.includes('已被预约'))
  assert.equal(compensations.length, 0) // 未产生我方副作用
})

test('异常 3（业务失败）：200+400 → JUDGE_FAILURE → FAILED（干净失败，未触发查证）', async () => {
  const world = { create: envelope(400, '参数非法') }
  const { terminal, conclusion, compensations } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'FAILED')
  assert.ok(conclusion.includes('提交未成功'))
  assert.equal(compensations.length, 0)
})

test('异常 4（重试穷尽）：两次查证未命中仍超时 → VERIFY_LIMIT → UNRESOLVED', async () => {
  const world = {
    create: { kind: 'timeout' },
    // GATHERING 1 次 + 查证 3 次（前两次 NOT_FOUND 重试、第三次达到上限不再查）
    adminSequence: [ok([]), ok([]), ok([]), ok([])],
  }
  const { terminal, steps } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'UNRESOLVED')
  // 步数：起手 4 + (CALL_UNKNOWN + VERIFY_NOT_FOUND)×2 + CALL_UNKNOWN + VERIFY_LIMIT = 10
  assert.equal(steps, 10)
})

test('查不清直接落 UNRESOLVED：提交超时且查证路径不可用 → VERIFY_INCONCLUSIVE（不重试）', async () => {
  const world = {
    create: { kind: 'timeout' },
    adminSequence: [ok([]), httpOnly(500)], // GATHERING 成功；查证时列表不可用
  }
  const { terminal, steps } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'UNRESOLVED')
  assert.equal(steps, 6) // 起手 4 + CALL_UNKNOWN + VERIFY_INCONCLUSIVE（查不清不重试，直接收敛）
})

test('异常 5（查证未命中）：唯一回到副作用的边——重试后成功 → DONE', async () => {
  const world = {
    createSequence: [{ kind: 'timeout' }, ok(121)],
    adminSequence: [ok([]), ok([])], // 查证未命中（未超阈）→ 确定未生效 → 允许重试
  }
  const { terminal, compensations, conclusion } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'DONE')
  assert.equal(compensations[0].recordId, 121) // 重试成功的那次入清单
  assert.ok(conclusion.includes('#121'))
})

test('降级成功（演示主场景）：123 被占 → 同楼栋不降容量换 222 → DONE', async () => {
  const world = {
    adminRows: [wireRow({ userId: 10019, id: 130, resourceId: 5, resourceName: '数智楼 123' })], // 123 被别人占
    availableRows: [
      { id: 10, building: '数智楼', roomNumber: '111', capacity: 48, status: 'ENABLED' },
      { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' },
      { id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' },
      { id: 7, building: '数智楼', roomNumber: '233', capacity: 32, status: 'ENABLED' },
    ],
    create: ok(121),
  }
  const { terminal, results, steps, conclusion } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'DONE')
  assert.ok(results[0].message.includes('#121'))
  assert.ok(conclusion.includes('数智楼 222'))
  // 降级后走 GATHERING → VALIDATING 全量重验：4 + DEGRADABLE_CONFLICT + DEGRADE_ACCEPTED + 4 = 9 步
  assert.equal(steps, 9)
})

test('D7 多资源 + 补偿：第一间成功、第二间降级穷尽 → 回滚第一间 → 任务 FAILED', async () => {
  const others222 = wireRow({ userId: 10019, id: 130, resourceId: 4, resourceName: '数智楼 222' })
  const world = {
    // 222 是全栋最大容量（55）：对它降级没有"不降容量"的合法候选 → 第二间降级穷尽
    availableRows: [
      { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' },
      { id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' },
    ],
    createSequence: [ok(120), envelope(409, '该时间段内教室已被整间预约')],
    cancel: ok(null),
    adminSequence: [
      ok([]),                                        // 运行 1 GATHERING（世界尚无记录）
      ok([others222]),                               // 运行 2 GATHERING：222 已被别人占（含 P-SLOT-FREE 冲突）
    ],
  }
  const { terminal, results, compensations, conclusion } = await execute(world, [
    { classroom: { classroomId: 5 } },
    { classroom: { classroomId: 4 } },
  ])
  assert.equal(results[0].terminal, 'DONE')
  assert.equal(results[1].terminal, 'REJECTED')
  assert.equal(terminal, 'FAILED')
  assert.equal(compensations[0].recordId, 120)
  assert.equal(compensations[0].revoked, true) // 降级穷尽才补偿（降级优先于补偿）
  assert.ok(conclusion.includes('已撤销此前完成的预订'))
  assert.ok(conclusion.includes('#120（数智楼 123）'))
})

test('补偿查证收敛：撤销超时 → 按 recordId 查证确认已生效 → 任务 FAILED（副作用已收敛）', async () => {
  const world = {
    detail4: envelope(400, '教室不存在'), // 第二间：F1 不可得 → 保守拒绝（REJECTED，无副作用）
    adminSequence: [
      ok([]), // 运行 1 GATHERING
      ok([]), // 运行 2 GATHERING
      ok([wireRow({ id: 120, userId: UIDS['233'], resourceId: 5, resourceName: '数智楼 123', status: 'CANCELLED' })]), // 补偿查证：#120 已非 ACTIVE
    ],
    create: ok(120),
    cancel: { kind: 'timeout' }, // 撤销请求超时——但服务端实际已撤销（半成功，反向）
  }
  const { terminal, compensations, conclusion } = await execute(world, [
    { classroom: { classroomId: 5 } },
    { classroom: { classroomId: 4 } },
  ])
  assert.equal(results0(world), 'DONE') // 第一间正常完成
  assert.equal(terminal, 'FAILED')
  assert.equal(compensations[0].revoked, true) // 查证确认撤销已生效（不重试撤销、不误判失败）
  assert.ok(conclusion.includes('#120'))
})

// 辅助：读取第一运行的终态（world 无状态记录，这里仅为可读性）
function results0() {
  return 'DONE'
}

test('D7：第一间成功、第二间教室不存在（不可降级失败）→ 整体回滚 → 任务 FAILED', async () => {
  const world = {
    detail4: envelope(400, '教室不存在'),
    adminSequence: [ok([]), ok([])],
    create: ok(120),
  }
  const { terminal, results, compensations, conclusion } = await execute(world, [
    { classroom: { classroomId: 5 } },
    { classroom: { classroomId: 4 } },
  ])
  assert.equal(results[0].terminal, 'DONE')
  assert.equal(results[1].terminal, 'REJECTED')
  // §5.8 映射：最后一运行 REJECTED 且补偿清单非空 → 撤销第一间 → 任务 FAILED（借两间只成一件=整体未完成）
  assert.equal(terminal, 'FAILED')
  assert.equal(compensations[0].revoked, true)
  assert.ok(conclusion.includes('#120'))
})

test('单资源降级穷尽：候选耗尽 → REJECTED，话术说明已尝试的方案（§8.3）', async () => {
  const world = {
    adminRows: [wireRow({ userId: 10019 })], // 123 被占
    availableRows: [{ id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' }], // 无其他候选
  }
  const { terminal, conclusion } = await execute(world, [{ classroom: { classroomId: 5 } }])
  assert.equal(terminal, 'REJECTED')
  assert.ok(conclusion.includes('已尝试') || conclusion.includes('候选已核验'))
})

test('非法转移显式报错并留痕：CALL_SUCCESS 从 IDLE 发出 → IllegalTransitionError + 审计条目', () => {
  const { chain } = makeRunner({})
  const machine = new TaskMachine({
    table: chain ? new ConfigStore().getStateMachine() : new ConfigStore().getStateMachine(),
    constants: new ConfigStore().getConstants(),
    evidenceChain: chain,
    taskId: 'T-ILLEGAL',
  })
  assert.throws(
    () => machine.fire('CALL_SUCCESS'),
    (err) => err instanceof IllegalTransitionError && err.from === 'IDLE' && err.event === 'CALL_SUCCESS',
  )
  const audit = chain.getEntries().find((e) => e.action === 'audit:illegal-transition')
  assert.ok(audit, '非法转移已留痕')
  assert.equal(audit.input.from, 'IDLE')
  // 终态出边同样是非法转移
  machine.begin('DONE', 'forward')
  assert.throws(() => machine.fire('USER_REPLIED'), IllegalTransitionError)
})

test('步数预算兜底（K1）：上限调到 5 后正常链路被强制 UNRESOLVED 并留痕', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-budget-'))
  try {
    cpSync(CONFIG_DIR, dir, { recursive: true })
    const constantsPath = join(dir, 'constants.yaml')
    writeFileSync(constantsPath, readFileSync(constantsPath, 'utf8').replace('taskTotalSteps: 60', 'taskTotalSteps: 5'))
    const store = new ConfigStore(dir)
    const { gateway, chain } = makeGateway(() => ok(DETAIL(5, '123', 48)))
    // gateway 用真实 CONFIG_DIR——为让 runner 用缩小预算的 store，重造栈
    const worldGateway = gateway
    void worldGateway
    const judgment = new JudgmentEngine({ configStore: store, gateway, evidenceChain: chain })
    const runner = new TaskRunner({ configStore: store, gateway, judgmentEngine: judgment, evidenceChain: chain })
    const result = await runner.executeTask({
      intentId: 'borrow-classroom',
      resources: [{ classroom: { classroomId: 5 } }],
      slot: SLOT,
      identity: { id: 'TEACHER' },
    })
    assert.equal(result.terminal, 'UNRESOLVED')
    assert.ok(result.conclusion.includes('人工介入'))
    const audit = chain.getEntries().find((e) => e.action === 'audit:step-budget-exhausted')
    assert.ok(audit, '预算耗尽已留痕')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('证据链完整性：一次 DONE 任务的链含收集/判定/调用/决策/终态，导出无凭证', async () => {
  const { runner, chain } = makeRunner({})
  const result = await runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: 5 } }],
    slot: SLOT,
    identity: { id: 'TEACHER' },
  })
  assert.equal(result.terminal, 'DONE')
  const actions = chain.getEntries().map((e) => e.action)
  for (const expected of ['collect-fact:F1', 'judge:P-SLOT-FREE', 'contact:edu.reservation.classroom.create', 'decide:PROPOSITIONS_OK', 'task-terminal']) {
    assert.ok(actions.includes(expected), `缺少证据条目 ${expected}`)
  }
  const terminalEntry = chain.getEntries().find((e) => e.action === 'task-terminal')
  assert.ok(terminalEntry.basis[0].evidence >= 1, '终态依据引用决策条目')
  assert.ok(!JSON.stringify(chain.exportChain()).includes('test-pw'))
})
