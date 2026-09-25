// 接入层测试 —— 阶段 4 验收：① 事件流内容与证据链逐条一致；② 结构化任务入口不经过理解层
// （仓库内无任何 LLM 用法，由约束检查保证）；③ 统一返回结构与错误码；④ 断线续传；⑤ 无凭证。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccessServer, ERROR_CODES } from '../src/access/http-server.js'
import { ConfigStore } from '../src/config/config-store.js'
import { IdentityPool } from '../src/contact/identity-pool.js'
import { makeGateway, ok, envelope, httpOnly, UIDS } from './helpers/fake-legacy.js'

process.env.ORCH_LEGACY_ADMIN_PASSWORD ||= 'test-pw-admin'
process.env.ORCH_LEGACY_TEACHER_PASSWORD ||= 'test-pw-teacher'

const SLOT = { start: '2026-09-30T05:00:00Z', end: '2026-09-30T06:00:00Z' } // 北京 13:00–14:00
const wireRow = (over = {}) => ({
  id: 118, userId: UIDS['233'], username: '233', resourceType: 'CLASSROOM', resourceId: 5,
  resourceName: '数智楼 123', startTime: '2026-09-30T05:00:00', endTime: '2026-09-30T06:00:00',
  status: 'ACTIVE', ...over,
})

// 起一个真实 HTTP 服务（随机端口）+ 假传输的存量系统世界；llmResponses 非空时用脚本化 LLM
async function startServer(world = {}, llmResponses = null) {
  const store = new ConfigStore()
  let adminCalls = 0
  const { gateway, transport } = makeGateway((req) => {
    switch (req.path) {
      case '/classrooms/5': return ok({ id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' })
      case '/classrooms/4': return ok({ id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' })
      case '/classrooms/5/reserved_seats': return ok([])
      case '/classrooms/available_list':
        return ok([
          { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' },
          { id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' },
        ])
      case '/admin/reservations': {
        adminCalls += 1
        if (world.adminSequence) return world.adminSequence[Math.min(adminCalls, world.adminSequence.length) - 1]
        return world.admin ?? ok(world.adminRows ?? [])
      }
      case '/reservations': return ok([])
      case '/admin/maintenance': return ok([])
      case '/reservations/classrooms': return world.create ?? ok(120)
      default: return ok(null)
    }
  })
  const pool = new IdentityPool({
    configStore: store, transport, adapters: gateway.adapters, constants: store.getConstants(),
  })
  const llm = llmResponses
    ? {
        calls: [],
        async complete({ messages }) {
          llm.calls.push(messages)
          const r = llmResponses[Math.min(llm.calls.length - 1, llmResponses.length - 1)]
          return { text: JSON.stringify(r), model: 'fake-qwen', elapsedMs: 1 }
        },
      }
    : undefined
  const { server, taskStore } = createAccessServer({ configStore: store, transport, identityPool: pool, llm })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, server, taskStore, transport, llm }
}

const postTask = async (base, body) =>
  fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const getJson = async (base, path) => {
  const res = await fetch(`${base}${path}`)
  return { httpStatus: res.status, body: await res.json() }
}

// 等待任务到达终态（轮询快照；事件流主通道另测）
async function awaitTerminal(base, taskId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { body } = await getJson(base, `/api/tasks/${taskId}`)
    if (body.data?.status === 'terminal') return body.data
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('任务未在时限内到达终态')
}

// 读取 SSE 流直到连接关闭（终态后服务端主动关闭）
async function readEvents(base, taskId, query = '') {
  const res = await fetch(`${base}/api/tasks/${taskId}/events${query}`)
  const text = await res.text()
  const events = []
  for (const frame of text.split('\n\n').filter(Boolean)) {
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
    if (dataLine) events.push(JSON.parse(dataLine.slice('data: '.length)))
  }
  return { sseStatus: res.status, events }
}

test('正常任务：POST 返回 taskId → 快照到达 DONE → 结论含预约号', async () => {
  const { base, server } = await startServer({})
  try {
    const post = await postTask(base, {
      intentId: 'borrow-classroom',
      identity: 'TEACHER',
      slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    assert.equal(post.status, 200)
    const postBody = await post.json()
    assert.equal(postBody.code, ERROR_CODES.OK)
    assert.ok(postBody.data.taskId)
    assert.equal(postBody.data.eventsPath, `/api/tasks/${postBody.data.taskId}/events`)

    const snapshot = await awaitTerminal(base, postBody.data.taskId)
    assert.equal(snapshot.result.terminal, 'DONE')
    assert.ok(snapshot.result.conclusion.includes('#120'))
  } finally {
    server.close()
  }
})

test('验收①：事件流与证据链逐条一致——事件数=条目数、seq 一一对应、evidenceRef 可解析', async () => {
  const { base, server } = await startServer({})
  try {
    const post = await postTask(base, {
      intentId: 'borrow-classroom', identity: 'TEACHER', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(base, taskId)

    const { body: evidence } = await getJson(base, `/api/tasks/${taskId}/evidence`)
    const { events } = await readEvents(base, taskId)

    assert.equal(events.length, evidence.data.entries.length) // 1:1（§6.1 粒度由证据链决定）
    for (let i = 0; i < events.length; i++) {
      assert.equal(events[i].seq, evidence.data.entries[i].seq)
      assert.equal(events[i].at, evidence.data.entries[i].at)
      assert.equal(events[i].taskId, taskId)
      assert.ok(['phase-start', 'phase-end', 'fact-collected', 'proposition-judged', 'decision', 'call', 'uncertain', 'input-required', 'cancel-result', 'audit', 'terminal', 'pending-item'].includes(events[i].type), `事件类型在闭集内: ${events[i].type}`)
      assert.ok(['running', 'done', 'failed', 'uncertain', 'unavailable', 'not-applicable'].includes(events[i].status), `状态在闭集内: ${events[i].status}`)
      assert.ok(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].includes(events[i].phase))
    }
    // evidenceRef 可解析：每个事件的 ref 都指向同 seq 的证据条目
    for (const e of events) {
      const seq = Number.parseInt(e.evidenceRef.split(':')[1], 10)
      assert.ok(evidence.data.entries.some((en) => en.seq === seq), `evidenceRef 可解析: ${e.evidenceRef}`)
    }
    // 终态事件唯一且最后到达（按 seq）
    const terminals = events.filter((e) => e.type === 'terminal')
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0].seq, Math.max(...events.map((e) => e.seq)))
  } finally {
    server.close()
  }
})

test('事件流脱敏：text 不含接口路径/凭证；UNKNOWN 调用映射为 uncertain 事件', async () => {
  const world = {
    create: { kind: 'timeout' },
    // GATHERING 成功 → 提交超时（UNKNOWN）→ 查证两次均不可用 → UNRESOLVED
    adminSequence: [ok([]), httpOnly(500), httpOnly(500)],
  }
  const { base, server } = await startServer(world)
  try {
    const post = await postTask(base, {
      intentId: 'borrow-classroom', identity: 'TEACHER', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(base, taskId)
    const { events } = await readEvents(base, taskId)

    const allText = events.map((e) => e.text).join('\n')
    assert.ok(!allText.includes('/reservations'), 'text 不得含接口路径')
    assert.ok(!allText.includes('/classrooms'), 'text 不得含接口路径')
    assert.ok(!allText.includes('Bearer'), 'text 不得含凭证')
    assert.ok(!allText.includes('SUBMITTING'), 'text 不得含状态机状态名')

    const uncertain = events.find((e) => e.type === 'uncertain')
    assert.ok(uncertain, 'UNKNOWN 调用产生"不确定"事件（界面切待确认形态）')
    const terminal = events.find((e) => e.type === 'terminal')
    assert.equal(terminal.status, 'uncertain') // UNRESOLVED 不显示成失败
    // 导出整体无凭证
    const { body: evidence } = await getJson(base, `/api/tasks/${taskId}/evidence`)
    assert.ok(!JSON.stringify(evidence).includes('test-pw'))
  } finally {
    server.close()
  }
})

test('断线续传：?lastSeq=1 只重放其后的条目（§6.3 规格 3）', async () => {
  const { base, server } = await startServer({})
  try {
    const post = await postTask(base, {
      intentId: 'borrow-classroom', identity: 'TEACHER', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(base, taskId)

    const full = await readEvents(base, taskId)
    const resumed = await readEvents(base, taskId, '?lastSeq=1')
    assert.equal(resumed.events.length, full.events.length - 1)
    assert.equal(resumed.events[0].seq, 2)
  } finally {
    server.close()
  }
})

test('形状校验错误码：BAD_JSON / 缺意图 / 缺资源 / 缺身份 / 非法时段 / 未知路由 / 未知任务', async () => {
  const { base, server } = await startServer({})
  try {
    const raw = await fetch(`${base}/api/tasks`, { method: 'POST', body: 'not-json' })
    assert.equal((await raw.json()).code, ERROR_CODES.BAD_JSON)

    const missingIntent = await postTask(base, { identity: 'TEACHER', slot: SLOT, resources: [{ classroom: { classroomId: 5 } }] })
    assert.equal((await missingIntent.json()).code, ERROR_CODES.UNKNOWN_INTENT)

    const missingResources = await postTask(base, { intentId: 'borrow-classroom', identity: 'TEACHER', slot: SLOT })
    assert.equal((await missingResources.json()).code, ERROR_CODES.BAD_RESOURCES)

    const missingIdentity = await postTask(base, { intentId: 'borrow-classroom', slot: SLOT, resources: [{ classroom: { classroomId: 5 } }] })
    assert.equal((await missingIdentity.json()).code, ERROR_CODES.BAD_IDENTITY)

    const badSlot = await postTask(base, {
      intentId: 'borrow-classroom', identity: 'TEACHER',
      slot: { start: 'not-a-date', end: '2026-09-30T06:00:00Z' },
      resources: [{ classroom: { classroomId: 5 } }],
    })
    assert.equal((await badSlot.json()).code, ERROR_CODES.BAD_SLOT)

    const invertedSlot = await postTask(base, {
      intentId: 'borrow-classroom', identity: 'TEACHER',
      slot: { start: '2026-09-30T07:00:00Z', end: '2026-09-30T06:00:00Z' },
      resources: [{ classroom: { classroomId: 5 } }],
    })
    assert.equal((await invertedSlot.json()).code, ERROR_CODES.BAD_SLOT)

    const unknownRoute = await getJson(base, '/api/nope')
    assert.equal(unknownRoute.httpStatus, 404)
    assert.equal(unknownRoute.body.code, ERROR_CODES.ROUTE_NOT_FOUND)

    const unknownTask = await getJson(base, '/api/tasks/T-NONE')
    assert.equal(unknownTask.httpStatus, 404)
    assert.equal(unknownTask.body.code, ERROR_CODES.TASK_NOT_FOUND)
  } finally {
    server.close()
  }
})

test('自然语言入口：一句话 → 挂起追问 → 回复 → DONE（两条路径汇入同一编排）', async () => {
  const llmResponses = [
    { intent: 'borrow-classroom', slots: { classroomName: '数智楼222', datePhrase: '下周三' }, confidence: 0.9, outOfDomain: false },
    { intent: 'borrow-classroom', slots: { classroomName: '数智楼222', datePhrase: '下周三', timeSegment: '下午' }, confidence: 0.9, outOfDomain: false },
  ]
  const { base, server } = await startServer({}, llmResponses)
  try {
    const post = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '帮我借下周三下午数智楼222', identity: 'TEACHER' }),
    })
    assert.equal(post.status, 200)
    const { data } = await post.json()

    // 等待挂起（追问）
    let snapshot
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      snapshot = (await getJson(base, `/api/tasks/${data.taskId}`)).body.data
      if (snapshot.status !== 'running') break
      await new Promise((r) => setTimeout(r, 25))
    }
    assert.equal(snapshot.status, 'suspended')
    assert.equal(snapshot.clarify.kind, 'missing-slots')
    assert.deepEqual(snapshot.clarify.missing, ['timeSegment'])

    // 回复 → 恢复 → 终态 DONE
    await fetch(`${base}/api/tasks/${data.taskId}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '下午' }),
    })
    const finalSnapshot = await awaitTerminal(base, data.taskId)
    assert.equal(finalSnapshot.result.terminal, 'DONE')
  } finally {
    server.close()
  }
})

test('多资源任务走同一入口：第二间冲突 → 自动回滚第一间 → 任务 FAILED（对外可见）', async () => {
  // 精确世界：222 被别人占（run 2 的 P-SLOT-FREE 冲突且无降级候选）→ REJECTED → 回滚第一间
  const { base, server } = await startServer({
    adminRows: [wireRow({ userId: 10019, id: 130, resourceId: 4, resourceName: '数智楼 222' })],
  })
  try {
    const post = await postTask(base, {
      intentId: 'borrow-classroom', identity: 'TEACHER', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }, { classroom: { classroomId: 4 } }],
    })
    const { taskId } = (await post.json()).data
    const snapshot = await awaitTerminal(base, taskId)
    assert.equal(snapshot.result.terminal, 'FAILED')
    assert.equal(snapshot.result.compensations[0].revoked, true)
    assert.ok(snapshot.result.conclusion.includes('已撤销此前完成的预订'))
  } finally {
    server.close()
  }
})
