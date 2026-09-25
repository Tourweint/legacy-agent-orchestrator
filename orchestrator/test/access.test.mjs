// 接入层测试 —— 阶段 4 验收：① 事件流内容与证据链逐条一致；② 结构化任务入口不经过理解层
// （仓库内无任何 LLM 用法，由约束检查保证）；③ 统一返回结构与错误码；④ 断线续传；⑤ 无凭证。
//
// 登录（2026-09-25 拓展）新增验收面：
//   ⑥ 三个登录端点（login/me/logout）与会话 Cookie/Authorization 两种携带方式
//   ⑦ 未登录一律 4010；⑧ 越权意图在任何调用之前被拒（零写调用）；⑨ 任务归属（查不到别人的任务）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccessServer, ERROR_CODES } from '../src/access/http-server.js'
import { AUTH_ERROR_CODES } from '../src/access/auth-endpoints.js'
import { ConfigStore } from '../src/config/config-store.js'
import { IdentityPool } from '../src/contact/identity-pool.js'
import { UserTokenStore } from '../src/contact/user-token-store.js'
import { SessionStore } from '../src/access/session-store.js'
import { makeGateway, ok, envelope, httpOnly, UIDS } from './helpers/fake-legacy.js'

process.env.ORCH_LEGACY_ADMIN_PASSWORD ||= 'test-pw-admin'
process.env.ORCH_LEGACY_TEACHER_PASSWORD ||= 'test-pw-teacher'
process.env.ORCH_LEGACY_STUDENT_PASSWORD ||= 'test-pw-student'

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
  const { gateway, transport, adapters } = makeGateway((req) => {
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
    configStore: store, transport, adapters, constants: store.getConstants(),
  })
  const userTokenStore = new UserTokenStore({
    configStore: store, transport, adapters, constants: store.getConstants(),
  })
  const sessionStore = new SessionStore({ constants: store.getConstants() })
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
  const { server, taskStore } = createAccessServer({
    configStore: store, transport, identityPool: pool, userTokenStore, sessionStore, adapters, llm,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, server, taskStore, transport, llm, sessionStore, userTokenStore }
}

/** 用存量系统账号登录引擎，拿到会话 Cookie（浏览器路径）。 */
async function login(base, username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]
  return { httpStatus: res.status, body: await res.json(), cookie }
}

const teacherLogin = (base) => login(base, '233', 'test-pw-teacher')
const studentLogin = (base) => login(base, 'abc', 'test-pw-student')

const withCookie = (cookie) => (cookie ? { Cookie: cookie } : {})

const postTask = async (ctx, body) =>
  fetch(`${ctx.base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...withCookie(ctx.cookie) },
    body: JSON.stringify(body),
  })

const getJson = async (ctx, path) => {
  const res = await fetch(`${ctx.base}${path}`, { headers: withCookie(ctx.cookie) })
  return { httpStatus: res.status, body: await res.json() }
}

// 等待任务到达终态（轮询快照；事件流主通道另测）
async function awaitTerminal(ctx, taskId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { body } = await getJson(ctx, `/api/tasks/${taskId}`)
    if (body.data?.status === 'terminal') return body.data
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('任务未在时限内到达终态')
}

// 读取 SSE 流直到连接关闭（终态后服务端主动关闭）
async function readEvents(ctx, taskId, query = '') {
  const res = await fetch(`${ctx.base}/api/tasks/${taskId}/events${query}`, { headers: withCookie(ctx.cookie) })
  const text = await res.text()
  const events = []
  for (const frame of text.split('\n\n').filter(Boolean)) {
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
    if (dataLine) events.push(JSON.parse(dataLine.slice('data: '.length)))
  }
  return { sseStatus: res.status, events }
}

// ── ⑥⑦ 登录与会话 ──────────────────────────────────────────────────────────

test('登录链路：login 发会话 Cookie → me 可用 → logout 后会话失效', async () => {
  const { base, server, transport } = await startServer({})
  try {
    const loginRes = await login(base, '233', 'test-pw-teacher')
    assert.equal(loginRes.httpStatus, 200)
    assert.equal(loginRes.body.data.role, 'TEACHER')
    assert.equal(loginRes.body.data.userInfo.username, '233')
    assert.ok(loginRes.cookie.startsWith('orch_session='), '签发引擎会话 Cookie')
    // 凭证纪律：响应体里不得回带任何令牌
    assert.ok(!JSON.stringify(loginRes.body).includes('tok-'))
    assert.ok(!JSON.stringify(loginRes.body).includes('rt-'))

    const me = await getJson({ base, cookie: loginRes.cookie }, '/api/auth/me')
    assert.equal(me.httpStatus, 200)
    assert.equal(me.body.data.role, 'TEACHER')

    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: withCookie(loginRes.cookie) })
    assert.equal(logout.status, 200)
    const after = await getJson({ base, cookie: loginRes.cookie }, '/api/auth/me')
    assert.equal(after.httpStatus, 401)
    assert.equal(after.body.code, AUTH_ERROR_CODES.UNAUTHORIZED)
    // 登出会把存量侧的设备会话一并撤销（凭证纪律：不留残会话）
    assert.ok(transport.calls.some((c) => c.path === '/auth/logout'))
  } finally {
    server.close()
  }
})

test('未登录：受保护端点一律 4010，登录端点以外的路由不给数据', async () => {
  const { base, server, transport } = await startServer({})
  try {
    const post = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intentId: 'borrow-classroom', slot: SLOT, resources: [{ classroom: { classroomId: 5 } }] }),
    })
    assert.equal(post.status, 401)
    assert.equal((await post.json()).code, AUTH_ERROR_CODES.UNAUTHORIZED)

    const snapshot = await getJson({ base }, '/api/tasks/T-X')
    assert.equal(snapshot.httpStatus, 401)

    // 未登录时不得发生任何业务调用（登录/健康检查除外）
    assert.equal(transport.calls.filter((c) => c.path.startsWith('/reservations')).length, 0)
  } finally {
    server.close()
  }
})

test('会话也接受 Authorization: Bearer（脚本与接口测试路径）', async () => {
  const { base, server, sessionStore } = await startServer({})
  try {
    const loginRes = await login(base, '233', 'test-pw-teacher')
    const token = loginRes.cookie.replace('orch_session=', '')
    assert.ok(sessionStore.get(token), '会话在服务端存在')
    const res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).data.role, 'TEACHER')
  } finally {
    server.close()
  }
})

test('术语对照表下发：未登录 401，登录后拿到事实/命题/规则的人话名（零术语）', async () => {
  const { base, server } = await startServer({})
  try {
    const anon = await fetch(`${base}/api/meta/glossary`)
    assert.equal(anon.status, 401)

    const cookie = (await teacherLogin(base)).cookie
    const res = await fetch(`${base}/api/meta/glossary`, { headers: { Cookie: cookie } })
    assert.equal(res.status, 200)
    const { data } = await res.json()
    assert.equal(data.rules.R1, '读取成功')
    assert.equal(data.facts.F5, '我名下的预约')
    assert.ok(data.propositions['P-SLOT-FREE'])
    // 零术语：任何名字里都不许再出现内部编号
    for (const [id, title] of Object.entries(data.propositions)) assert.ok(!title.includes(id))
  } finally {
    server.close()
  }
})

// ── 原有结构化任务路径（现在都要先登录）────────────────────────────────────

test('正常任务：POST 返回 taskId → 快照到达 DONE → 结论含预约号', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom',
      slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    assert.equal(post.status, 200)
    const postBody = await post.json()
    assert.equal(postBody.code, ERROR_CODES.OK)
    assert.ok(postBody.data.taskId)
    assert.equal(postBody.data.eventsPath, `/api/tasks/${postBody.data.taskId}/events`)

    const snapshot = await awaitTerminal(ctx, postBody.data.taskId)
    assert.equal(snapshot.result.terminal, 'DONE')
    assert.ok(snapshot.result.conclusion.includes('#120'))
    assert.equal(snapshot.owner, '233') // 任务记在发起人名下（影响面 #12）
  } finally {
    ctx.server.close()
  }
})

test('验收①：事件流与证据链逐条一致——事件数=条目数、seq 一一对应、evidenceRef 可解析', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(ctx, taskId)

    const { body: evidence } = await getJson(ctx, `/api/tasks/${taskId}/evidence`)
    const { events } = await readEvents(ctx, taskId)

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
    ctx.server.close()
  }
})

test('事件流脱敏：text 不含接口路径/凭证；UNKNOWN 调用映射为 uncertain 事件', async () => {
  const world = {
    create: { kind: 'timeout' },
    // GATHERING 成功 → 提交超时（UNKNOWN）→ 查证两次均不可用 → UNRESOLVED
    adminSequence: [ok([]), httpOnly(500), httpOnly(500)],
  }
  const ctx = await startServer(world)
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(ctx, taskId)
    const { events } = await readEvents(ctx, taskId)

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
    const { body: evidence } = await getJson(ctx, `/api/tasks/${taskId}/evidence`)
    assert.ok(!JSON.stringify(evidence).includes('test-pw'))
  } finally {
    ctx.server.close()
  }
})

test('每条调用证据都带发起人与实际使用身份（影响面 #13）', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(ctx, taskId)
    const { body: evidence } = await getJson(ctx, `/api/tasks/${taskId}/evidence`)
    const calls = evidence.data.entries.filter((e) => e.action.startsWith('contact:'))
    assert.ok(calls.length > 0)
    for (const entry of calls) {
      assert.equal(entry.initiator, '233', `调用证据必须记录发起人: ${entry.action}`)
      assert.ok(['本人身份', '服务只读身份'].includes(entry.actingIdentity))
    }
    // 写操作（提交预约）必须记成"本人身份"，而不是任何服务身份
    const submit = calls.find((e) => e.action === 'contact:edu.reservation.classroom.create')
    assert.equal(submit.actingIdentity, '本人身份')
    // 跨权限域读（管理端列表）记成服务只读身份，界面上要明示
    const adminRead = calls.find((e) => e.action === 'contact:logi.reservation.list')
    assert.equal(adminRead.actingIdentity, '服务只读身份')
  } finally {
    ctx.server.close()
  }
})

test('断线续传：?lastSeq=1 只重放其后的条目（§6.3 规格 3）', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(ctx, taskId)

    const full = await readEvents(ctx, taskId)
    const resumed = await readEvents(ctx, taskId, '?lastSeq=1')
    assert.equal(resumed.events.length, full.events.length - 1)
    assert.equal(resumed.events[0].seq, 2)
  } finally {
    ctx.server.close()
  }
})

test('形状校验错误码：BAD_JSON / 缺意图 / 缺资源 / 非法时段 / 未知路由 / 未知任务', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const raw = await fetch(`${ctx.base}/api/tasks`, {
      method: 'POST', headers: withCookie(ctx.cookie), body: 'not-json',
    })
    assert.equal((await raw.json()).code, ERROR_CODES.BAD_JSON)

    const missingIntent = await postTask(ctx, { slot: SLOT, resources: [{ classroom: { classroomId: 5 } }] })
    assert.equal((await missingIntent.json()).code, ERROR_CODES.UNKNOWN_INTENT)

    const missingResources = await postTask(ctx, { intentId: 'borrow-classroom', slot: SLOT })
    assert.equal((await missingResources.json()).code, ERROR_CODES.BAD_RESOURCES)

    const badSlot = await postTask(ctx, {
      intentId: 'borrow-classroom',
      slot: { start: 'not-a-date', end: '2026-09-30T06:00:00Z' },
      resources: [{ classroom: { classroomId: 5 } }],
    })
    assert.equal((await badSlot.json()).code, ERROR_CODES.BAD_SLOT)

    const invertedSlot = await postTask(ctx, {
      intentId: 'borrow-classroom',
      slot: { start: '2026-09-30T07:00:00Z', end: '2026-09-30T06:00:00Z' },
      resources: [{ classroom: { classroomId: 5 } }],
    })
    assert.equal((await invertedSlot.json()).code, ERROR_CODES.BAD_SLOT)

    const unknownRoute = await getJson(ctx, '/api/nope')
    assert.equal(unknownRoute.httpStatus, 404)
    assert.equal(unknownRoute.body.code, ERROR_CODES.ROUTE_NOT_FOUND)

    const unknownTask = await getJson(ctx, '/api/tasks/T-NONE')
    assert.equal(unknownTask.httpStatus, 404)
    assert.equal(unknownTask.body.code, ERROR_CODES.TASK_NOT_FOUND)
  } finally {
    ctx.server.close()
  }
})

test('identity 参数已作废：传了也被忽略（身份一律从会话派生）', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await studentLogin(ctx.base)).cookie
    // 学生会话 + 请求里谎称 identity: 'TEACHER' → 不能因此获得教师能力（忽略该参数）
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', identity: 'TEACHER', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    const snapshot = await awaitTerminal(ctx, taskId)
    assert.equal(snapshot.result.terminal, 'REJECTED')
    assert.equal(ctx.transport.callsTo('/reservations/classrooms').length, 0)
  } finally {
    ctx.server.close()
  }
})

// ── ⑧⑨ 越权拒绝与任务归属 ──────────────────────────────────────────────────

test('越权拒绝：学生借整间教室 → 有依据拒绝 + 替代动作，且零写调用', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await studentLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    const snapshot = await awaitTerminal(ctx, taskId)
    assert.equal(snapshot.result.terminal, 'REJECTED')
    assert.match(snapshot.result.conclusion, /教师/)
    assert.match(snapshot.result.conclusion, /候补|空闲/) // 给出下一步，而不是"操作失败"
    // 拒绝发生在任何调用之前（I5）：没有写调用，也没有事实收集调用
    assert.equal(ctx.transport.callsTo('/reservations/classrooms').length, 0)
    assert.equal(ctx.transport.callsTo('/classrooms/5').length, 0)
    const { body: evidence } = await getJson(ctx, `/api/tasks/${taskId}/evidence`)
    const forbidden = evidence.data.entries.find((e) => e.action === 'decide:intent-forbidden')
    assert.ok(forbidden, '越权拒绝必须留痕')
    assert.equal(forbidden.input.callsMade, 0)
    assert.equal(forbidden.initiator, 'abc')
  } finally {
    ctx.server.close()
  }
})

test('任务归属：查不到不属于自己的任务（不暴露其内容）', async () => {
  const ctx = await startServer({})
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }],
    })
    const { taskId } = (await post.json()).data
    await awaitTerminal(ctx, taskId)

    const student = await studentLogin(ctx.base)
    const peek = await getJson({ base: ctx.base, cookie: student.cookie }, `/api/tasks/${taskId}`)
    assert.equal(peek.httpStatus, 404)
    assert.equal(peek.body.code, ERROR_CODES.TASK_NOT_OWNED)
    const evidence = await getJson({ base: ctx.base, cookie: student.cookie }, `/api/tasks/${taskId}/evidence`)
    assert.equal(evidence.httpStatus, 404)
  } finally {
    ctx.server.close()
  }
})

// ── 自然语言入口与多资源 ───────────────────────────────────────────────────

test('自然语言入口：一句话 → 挂起追问 → 回复 → DONE（两条路径汇入同一编排）', async () => {
  const llmResponses = [
    { intent: 'borrow-classroom', slots: { classroomName: '数智楼222', datePhrase: '下周三' }, confidence: 0.9, outOfDomain: false },
    { intent: 'borrow-classroom', slots: { classroomName: '数智楼222', datePhrase: '下周三', timeSegment: '下午' }, confidence: 0.9, outOfDomain: false },
  ]
  const ctx = await startServer({}, llmResponses)
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await fetch(`${ctx.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...withCookie(ctx.cookie) },
      body: JSON.stringify({ text: '帮我借下周三下午数智楼222' }),
    })
    assert.equal(post.status, 200)
    const { data } = await post.json()

    // 等待挂起（追问）
    let snapshot
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      snapshot = (await getJson(ctx, `/api/tasks/${data.taskId}`)).body.data
      if (snapshot.status !== 'running') break
      await new Promise((r) => setTimeout(r, 25))
    }
    assert.equal(snapshot.status, 'suspended')
    assert.equal(snapshot.clarify.kind, 'missing-slots')
    assert.deepEqual(snapshot.clarify.missing, ['timeSegment'])

    // 回复 → 恢复 → 终态 DONE
    await fetch(`${ctx.base}/api/tasks/${data.taskId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...withCookie(ctx.cookie) },
      body: JSON.stringify({ text: '下午' }),
    })
    const finalSnapshot = await awaitTerminal(ctx, data.taskId)
    assert.equal(finalSnapshot.result.terminal, 'DONE')
  } finally {
    ctx.server.close()
  }
})

test('多资源任务走同一入口：第二间冲突 → 自动回滚第一间 → 任务 FAILED（对外可见）', async () => {
  // 精确世界：222 被别人占（run 2 的 P-SLOT-FREE 冲突且无降级候选）→ REJECTED → 回滚第一间
  const ctx = await startServer({
    adminRows: [wireRow({ userId: 10019, id: 130, resourceId: 4, resourceName: '数智楼 222' })],
  })
  try {
    ctx.cookie = (await teacherLogin(ctx.base)).cookie
    const post = await postTask(ctx, {
      intentId: 'borrow-classroom', slot: SLOT,
      resources: [{ classroom: { classroomId: 5 } }, { classroom: { classroomId: 4 } }],
    })
    const { taskId } = (await post.json()).data
    const snapshot = await awaitTerminal(ctx, taskId)
    assert.equal(snapshot.result.terminal, 'FAILED')
    assert.equal(snapshot.result.compensations[0].revoked, true)
    assert.ok(snapshot.result.conclusion.includes('已撤销此前完成的预订'))
  } finally {
    ctx.server.close()
  }
})
