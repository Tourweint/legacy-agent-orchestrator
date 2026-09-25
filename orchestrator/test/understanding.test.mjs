// 理解层测试 —— 阶段 5 验收：① 去掉理解层链路完整可跑（结构化路径零 LLM 调用）；
// ② 提示词零接口信息；③ 模型输出 ISO 时间被契约校验拒绝。另覆盖三道闸门与追问循环。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JudgmentEngine } from '../src/judgment/judgment-engine.js'
import { UnderstandingEngine } from '../src/understanding/understanding.js'
import { validateUnderstandingOutput } from '../src/understanding/schema.js'
import { buildSystemPrompt } from '../src/understanding/prompt.js'
import { ConfigStore } from '../src/config/config-store.js'
import { parseClassroomName } from '../src/canonical/classroom-name.js'
import { TaskRunner } from '../src/orchestration/task-runner.js'
import { makeGateway, ok, envelope, UIDS, sessionIdentity } from './helpers/fake-legacy.js'

const store = new ConfigStore()

// 可脚本化的假 LLM（记录每次调用的 messages，供断言"回灌纠正"与"结构化路径零调用"）
function scriptedLlm(responses) {
  const calls = []
  return {
    calls,
    async complete({ messages }) {
      calls.push(messages)
      const r = responses[Math.min(calls.length - 1, responses.length - 1)]
      if (r instanceof Error) throw r
      return { text: typeof r === 'string' ? r : JSON.stringify(r), model: 'fake-qwen', elapsedMs: 1 }
    },
  }
}

const validOutput = (over = {}) => ({
  intent: 'borrow-classroom',
  slots: { classroomName: '数智楼222', datePhrase: '下周三', timeSegment: '下午' },
  confidence: 0.9,
  outOfDomain: false,
  ...over,
})

test('验收③：模型输出 ISO 时间被契约校验拒绝；中文原话通过', () => {
  const bad = validateUnderstandingOutput(
    JSON.stringify(validOutput({ slots: { classroomName: '数智楼222', datePhrase: '2026-09-30', timeSegment: '13:00' } })),
    ['borrow-classroom'],
  )
  assert.equal(bad.ok, false)
  assert.ok(bad.violations.some((v) => v.includes('ISO 日期')))
  assert.ok(bad.violations.some((v) => v.includes('时钟时刻')))

  const good = validateUnderstandingOutput(JSON.stringify(validOutput()), ['borrow-classroom'])
  assert.equal(good.ok, true)
})

test('验收③（闸门一）：intent 不在闭集 → 违规，不允许"最接近的意图"兜底', () => {
  const result = validateUnderstandingOutput(JSON.stringify(validOutput({ intent: 'borrow-room' })), ['borrow-classroom'])
  assert.equal(result.ok, false)
  assert.ok(result.violations[0].includes('闭集'))
})

test('格式重试：首次不合规 → 具体原因回灌 → 第二次合规（§5.4）', async () => {
  const llm = scriptedLlm([
    { ...validOutput(), intent: 'borrow-room' }, // 第一次：意图不在闭集
    validOutput(), // 第二次：合规
  ])
  const engine = new UnderstandingEngine({ configStore: store, llm })
  const result = await engine.understand({ text: '帮我借下周三下午数智楼222' })
  assert.equal(result.status, 'ok')
  assert.equal(llm.calls.length, 2)
  // 回灌了具体原因（不是原样重发）
  const correction = llm.calls[1].at(-1).content
  assert.ok(correction.includes('纠正'))
  assert.ok(correction.includes('闭集'))
})

test('格式重试耗尽：连续不合规 → 如实上报（不编造意图）', async () => {
  const llm = scriptedLlm([{ intent: 'x', slots: {}, confidence: '高', outOfDomain: 'yes' }])
  const engine = new UnderstandingEngine({ configStore: store, llm })
  await assert.rejects(() => engine.understand({ text: '随便' }), (err) => err.message.includes('无法理解'))
  assert.equal(llm.calls.length, 3) // 1 + 2 次重试
})

test('闸门二：置信度不达标 → clarify 并列出候选意图（E5）', async () => {
  const llm = scriptedLlm([validOutput({ confidence: 0.3 })])
  const engine = new UnderstandingEngine({ configStore: store, llm })
  const result = await engine.understand({ text: '帮我弄一下教室' })
  assert.equal(result.status, 'clarify')
  assert.equal(result.reason, 'low-confidence')
  // 候选来自意图计划闭集（C7/C8 上线后为 5 条）
  assert.deepEqual(result.candidates.map((c) => c.id).sort(), [
    'borrow-classroom',
    'cancel-my-reservation',
    'query-classroom-availability',
    'query-my-reservations',
    'reschedule-my-reservation',
  ])
})

test('验收②：提示词零接口信息，且意图清单从计划生成', () => {
  const prompt = buildSystemPrompt({
    intents: store.intentList.map((it) => ({
      id: it.id,
      name: it.name,
      readOnly: it.readOnly,
      slots: it.slots,
      slotHints: it.slotHints ?? {},
    })),
    confidenceRule: '低于 0.55 视为没有把握',
  })
  assert.ok(prompt.includes('borrow-classroom'))
  assert.ok(prompt.includes('classroomName'))
  // 零接口信息：接口标识/路径/HTTP 方法/参数名一律不出现（第 03 章 §六）
  for (const forbidden of [/edu\./, /logi\./, /auth\.login/, /\/reservations/, /\/classrooms/, /min_capacity/, /GET |POST |DELETE /]) {
    assert.ok(!forbidden.test(prompt), `提示词不得含接口信息: ${forbidden}`)
  }
})

test('模型原始输出单独留档，不进证据链（契约④）', async () => {
  const llm = scriptedLlm([validOutput()])
  const archived = []
  const chainEntries = []
  const engine = new UnderstandingEngine({
    configStore: store,
    llm,
    evidenceChain: {
      recordModelOutput(raw) {
        archived.push(raw)
      },
      record(entry) {
        chainEntries.push(entry)
      },
    },
  })
  await engine.understand({ text: '帮我借下周三下午数智楼222' })
  assert.equal(archived.length, 1)
  assert.equal(archived[0].intent, 'borrow-classroom')
  assert.equal(chainEntries.length, 0) // 理解引擎自己不落链（落链由编排桥做结构化决策）
})

test('教室名归一化：多教室切分 + 楼栋/房间号提取', () => {
  assert.deepEqual(
    parseClassroomName('数智楼123和222').map((r) => [r.building, r.roomNumber]),
    [
      ['数智楼', '123'],
      ['数智楼', '222'],
    ],
  )
  assert.deepEqual(parseClassroomName('数智楼 222').map((r) => [r.building, r.roomNumber]), [['数智楼', '222']])
  assert.deepEqual(parseClassroomName('没有数字'), [])
})

// ---- 聊天全流程（run-engine + task-runner 集成，假 LLM + 假传输）----

function makeChatRunner(world, llmResponses) {
  const llm = scriptedLlm(llmResponses)
  const { gateway, chain } = makeGateway((req) => {
    switch (req.path) {
      case '/classrooms/4': return ok({ id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' })
      case '/classrooms/5': return ok({ id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' })
      case '/classrooms/available_list':
        return ok(world.availableRows ?? [
          { id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' },
          { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' },
        ])
      case '/classrooms/4/reserved_seats':
      case '/classrooms/5/reserved_seats':
        return ok([])
      case '/admin/reservations': return ok(world.adminRows ?? [])
      case '/reservations': return ok(world.mineRows ?? []) // F5 我的预约（C7 用例在这里造数据）
      case '/admin/maintenance': return ok([])
      case '/reservations/classrooms': return world.create ?? ok(120)
      default:
        // C7 撤销：DELETE /reservations/{id}
        if (req.method === 'DELETE' && /^\/reservations\/\d+$/.test(req.path)) {
          return world.cancel ?? ok(null)
        }
        return ok(null)
    }
  })
  const judgment = new JudgmentEngine({ configStore: gateway.store, gateway, evidenceChain: chain })
  const understanding = new UnderstandingEngine({ configStore: gateway.store, llm, evidenceChain: chain })
  const runner = new TaskRunner({
    configStore: gateway.store,
    gateway,
    judgmentEngine: judgment,
    evidenceChain: chain,
    understandingEngine: understanding,
  })
  return { runner, llm, chain, gateway }
}

test('验收①：结构化路径零 LLM 调用（去掉理解层链路完整可跑）', async () => {
  const { runner, llm } = makeChatRunner({}, [validOutput()])
  const result = await runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: 4 } }],
    slot: { start: new Date('2026-09-30T05:00:00Z'), end: new Date('2026-09-30T06:00:00Z') },
    identity: sessionIdentity('TEACHER'),
  })
  assert.equal(result.terminal, 'DONE')
  assert.equal(llm.calls.length, 0) // 理解层零参与
})

test('聊天全流程：一句话 → 全部槽位齐备 → 真实办理 → DONE', async () => {
  const { runner, chain } = makeChatRunner({}, [validOutput()])
  const outcome = await runner.executeChatTask({ text: '帮我借下周三下午数智楼222', identity: sessionIdentity('TEACHER') })
  assert.ok(!outcome.suspended)
  assert.equal(outcome.result.terminal, 'DONE')
  assert.ok(outcome.result.conclusion.includes('#120'))
  assert.ok(outcome.result.conclusion.includes('请确认')) // §7.3：推算结果必须展示
  // P1 段留痕：理解决策进链（结构化结果），模型原始输出不进
  const understand = chain.getEntries().find((e) => e.action === 'decide:understand')
  assert.ok(understand, '理解决策入链')
  assert.equal(understand.phase, 'P1')
})

test('追问循环：缺时段 → 挂起追问 → 回复补齐 → 恢复办理 → DONE', async () => {
  const { runner, chain } = makeChatRunner({}, [
    validOutput({ slots: { classroomName: '数智楼222', datePhrase: '下周三' } }), // 缺 timeSegment
    validOutput(), // 回复后模型补全
  ])
  const first = await runner.executeChatTask({ text: '帮我借下周三下午数智楼222', identity: sessionIdentity('TEACHER') })
  assert.ok(first.suspended)
  assert.equal(first.clarify.kind, 'missing-slots')
  assert.deepEqual(first.clarify.missing, ['timeSegment'])

  const resumed = await runner.resumeChat({ stack: first.stack, replyText: '下午' })
  assert.ok(!resumed.suspended)
  assert.equal(resumed.result.terminal, 'DONE')
  // 追问事件对外可见（input-required）
  const asked = chain.getEntries().filter((e) => e.action.startsWith('ask:'))
  assert.equal(asked.length, 1)
  assert.equal(asked[0].phase, 'P1')
})

test('追问上限：连续 3 轮无法补齐 → CLARIFY_LIMIT → REJECTED（§8.2）', async () => {
  const empty = { intent: 'borrow-classroom', slots: {}, confidence: 0.9, outOfDomain: false }
  const { runner } = makeChatRunner({}, [empty, empty, empty, empty])
  const first = await runner.executeChatTask({ text: '帮我借教室', identity: sessionIdentity('TEACHER') })
  assert.ok(first.suspended)
  let outcome = await runner.resumeChat({ stack: first.stack, replyText: '不知道' })
  assert.ok(outcome.suspended)
  outcome = await runner.resumeChat({ stack: outcome.stack, replyText: '还是不知道' })
  assert.ok(outcome.suspended)
  outcome = await runner.resumeChat({ stack: outcome.stack, replyText: '真不知道' })
  assert.ok(!outcome.suspended)
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.ok(outcome.result.conclusion.includes('已追问 3 轮'))
})

test('超域拒答：饭卡充值 → OUT_OF_DOMAIN → REJECTED，不追问（第 03 章 §8.1）', async () => {
  const { runner } = makeChatRunner({}, [
    { intent: null, slots: {}, confidence: 0.95, outOfDomain: true, reasoning: '涉及金钱' },
  ])
  const outcome = await runner.executeChatTask({ text: '帮我的饭卡充两百块钱', identity: sessionIdentity('TEACHER') })
  assert.ok(!outcome.suspended)
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.ok(outcome.result.conclusion.includes('超出'))
})

test('取消挂起任务：B8 写请求前取消生效 → REJECTED', async () => {
  const { runner } = makeChatRunner({}, [validOutput({ slots: { classroomName: '数智楼222', datePhrase: '下周三' } })])
  const first = await runner.executeChatTask({ text: '帮我借下周三下午数智楼222', identity: sessionIdentity('TEACHER') })
  assert.ok(first.suspended)
  const { result } = runner.cancelChat({ stack: first.stack })
  assert.equal(result.terminal, 'REJECTED')
  assert.ok(result.conclusion.includes('未产生任何变更'))
})

test('闸门三机械算缺：模型漏报 missing 也不影响（缺口由计划计算，不采信模型）', async () => {
  // 模型声称槽位齐了且 missing 为空——但计划要求的 timeSegment 没给 → 仍追问
  const llm = scriptedLlm([
    { ...validOutput({ slots: { classroomName: '数智楼222', datePhrase: '下周三' } }), missing: [] },
  ])
  const { gateway, chain } = makeGateway((req) => {
    switch (req.path) {
      case '/classrooms/4': return ok({ id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' })
      case '/admin/reservations': case '/reservations': case '/admin/maintenance': case '/classrooms/4/reserved_seats': return ok([])
      default: return ok(null)
    }
  })
  const understanding = new UnderstandingEngine({ configStore: gateway.store, llm, evidenceChain: chain })
  const runner = new TaskRunner({
    configStore: gateway.store,
    gateway,
    judgmentEngine: new JudgmentEngine({ configStore: gateway.store, gateway, evidenceChain: chain }),
    evidenceChain: chain,
    understandingEngine: understanding,
  })
  const outcome = await runner.executeChatTask({ text: '帮我借下周三下午数智楼222', identity: sessionIdentity('TEACHER') })
  assert.ok(outcome.suspended)
  assert.deepEqual(outcome.clarify.missing, ['timeSegment']) // 闸门三：机械计算的缺口
})

// ---- C7 管理我的预约（2026-09-26 新增：查 / 退）--------------------------------

// F5 的 wire 行（适配器归一化后 recordId/start/end/resourceName 与 admin 列表同形）
const mineRow = (over = {}) => ({
  id: 121,
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

const chat = (world, llmResponses, text) => {
  const harness = makeChatRunner(world, llmResponses)
  return harness.runner
    .executeChatTask({ text, identity: sessionIdentity('TEACHER') })
    .then((outcome) => ({ ...harness, outcome }))
}

test('C7 查：一句话列出名下生效预约——只读、零写调用、不过实体消解', async () => {
  const { outcome, gateway } = await chat(
    { mineRows: [mineRow(), mineRow({ id: 122, resourceId: 4, resourceName: '数智楼 222' })] },
    [{ intent: 'query-my-reservations', slots: {}, confidence: 0.9, outOfDomain: false }],
    '我订了哪些教室',
  )
  assert.ok(!outcome.suspended)
  assert.equal(outcome.result.terminal, 'DONE')
  assert.match(outcome.result.conclusion, /数智楼 123/)
  assert.match(outcome.result.conclusion, /数智楼 222/)
  // 只读：一次写调用都没有；也没有去解析教室名（不需要实体消解）
  assert.equal(gateway.transport.callsTo('/reservations/classrooms').length, 0)
  assert.equal(gateway.transport.callsTo('/classrooms/5').length, 0)
})

test('C7 退：唯一命中 → 真实撤销一次 → DONE（撤销是目的，不进补偿清单）', async () => {
  const { outcome, gateway } = await chat(
    { mineRows: [mineRow()] },
    [{ intent: 'cancel-my-reservation', slots: { classroomName: '数智楼123' }, confidence: 0.9, outOfDomain: false }],
    '把数智楼123那间退了',
  )
  assert.ok(!outcome.suspended)
  assert.equal(outcome.result.terminal, 'DONE')
  assert.match(outcome.result.conclusion, /已为您撤销/)
  const cancels = gateway.transport.calls.filter((c) => c.method === 'DELETE' && /^\/reservations\/\d+$/.test(c.path))
  assert.equal(cancels.length, 1, '只撤销一次')
  assert.match(cancels[0].path, /\/reservations\/121$/)
  assert.equal(outcome.result.compensations.length, 0, '撤销即目的，不留补偿条目')
})

test('C7 退：多命中 → 有依据拒绝并列出候选（绝不猜是哪一条），零写调用', async () => {
  const { outcome, gateway } = await chat(
    { mineRows: [mineRow(), mineRow({ id: 122, resourceId: 4, resourceName: '数智楼 222' })] },
    [{ intent: 'cancel-my-reservation', slots: {}, confidence: 0.9, outOfDomain: false }],
    '把我的预约退了',
  )
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.match(outcome.result.conclusion, /数智楼 123/)
  assert.match(outcome.result.conclusion, /请指明/)
  assert.equal(gateway.transport.calls.filter((c) => c.method === 'DELETE').length, 0)
})

test('C7 退：名下没有匹配 → 有依据拒绝（并说出当前有什么），零写调用', async () => {
  const { outcome, gateway } = await chat(
    { mineRows: [mineRow({ id: 122, resourceId: 4, resourceName: '数智楼 222' })] },
    [{ intent: 'cancel-my-reservation', slots: { classroomName: '数智楼123' }, confidence: 0.9, outOfDomain: false }],
    '退了数智楼123那间',
  )
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.match(outcome.result.conclusion, /没有匹配/)
  assert.match(outcome.result.conclusion, /数智楼 222/)
  assert.equal(gateway.transport.calls.filter((c) => c.method === 'DELETE').length, 0)
})

// ---- C8 改期（先建新、后撤旧）--------------------------------------------------

// 与他人的冲突行：时段跨度刻意写得很宽，这样无论"周四下午"解析成哪一天都会重叠
const conflictRow = (over = {}) => ({
  id: 999,
  userId: 10019, // 别人
  username: 'abc',
  resourceType: 'CLASSROOM',
  resourceId: 5,
  resourceName: '数智楼 123',
  startTime: '2026-09-27T00:00:00',
  endTime: '2026-11-30T00:00:00',
  status: 'ACTIVE',
  ...over,
})

const rescheduleSlots = { classroomName: '数智楼123', datePhrase: '周四', timeSegment: '下午' }
const rescheduleOut = () => [{ intent: 'reschedule-my-reservation', slots: rescheduleSlots, confidence: 0.9, outOfDomain: false }]

test('C8 改期：先建新、后撤旧 —— 两次写入按顺序发生，旧记录被撤掉', async () => {
  const { outcome, gateway } = await chat({ mineRows: [mineRow()], adminRows: [] }, rescheduleOut(), '把数智楼123那间改到周四下午')
  assert.ok(!outcome.suspended)
  assert.equal(outcome.result.terminal, 'DONE')
  assert.match(outcome.result.conclusion, /已为您改期/)
  const writes = gateway.transport.calls.filter(
    (c) => c.path === '/reservations/classrooms' || c.method === 'DELETE',
  )
  assert.equal(writes.length, 2, '恰好两次写入')
  assert.equal(writes[0].path, '/reservations/classrooms', '先建新')
  assert.match(writes[1].path, /\/reservations\/121$/, '后撤旧（撤的是原记录）')
  assert.equal(writes[0].body.classroom_id, 5, '新记录订在原教室')
})

test('C8 改期：目标时段被他人占用 → 有依据拒绝、旧记录完好、两次写入都没发生', async () => {
  const { outcome, gateway } = await chat(
    { mineRows: [mineRow()], adminRows: [conflictRow()] },
    rescheduleOut(),
    '把数智楼123那间改到周四下午',
  )
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.match(outcome.result.conclusion, /未受影响/)
  assert.equal(gateway.transport.calls.filter((c) => c.path === '/reservations/classrooms').length, 0)
  assert.equal(gateway.transport.calls.filter((c) => c.method === 'DELETE').length, 0)
})

test('C8 改期：目标时段只有"自己那条待改期记录"重叠 → 不算被占（排除自己）', async () => {
  // 冲突行就是待改期的那条记录本身（recordId 与定位结果一致）——不排除它就会被自己判成"被占"
  const selfOverlapping = conflictRow({ id: 121, userId: UIDS['233'], username: '233' })
  const { outcome, gateway } = await chat(
    { mineRows: [mineRow()], adminRows: [selfOverlapping] },
    rescheduleOut(),
    '把数智楼123那间改到周四下午',
  )
  assert.equal(outcome.result.terminal, 'DONE')
  assert.equal(gateway.transport.calls.filter((c) => c.path === '/reservations/classrooms').length, 1)
})

test('C8 改期：撤旧失败 → 重试一次 → 仍失败落人工介入，并如实告知"两个时段都有"', async () => {
  const { outcome, gateway } = await chat(
    {
      mineRows: [mineRow()],
      // 撤销始终返回业务失败；且旧记录一直 ACTIVE（查证永远是"还没撤掉"）
      adminRows: [conflictRow({ id: 121, userId: UIDS['233'], username: '233' })],
      cancel: envelope(400, '当前状态不允许撤销'),
    },
    rescheduleOut(),
    '把数智楼123那间改到周四下午',
  )
  assert.equal(outcome.result.terminal, 'UNRESOLVED')
  assert.match(outcome.result.conclusion, /两个时段/)
  // 新记录只建了一次（不回滚），撤销尝试了 1 + 2 次重试
  assert.equal(gateway.transport.calls.filter((c) => c.path === '/reservations/classrooms').length, 1)
  assert.equal(gateway.transport.calls.filter((c) => c.method === 'DELETE').length, 3)
})

test('C8 改期：新时段没订上 → 什么都不用撤（旧记录未动）', async () => {
  const { outcome, gateway } = await chat(
    // 建新返回业务失败（如 409 冲突）：创建类失败 → FAILURE
    { mineRows: [mineRow()], adminRows: [], create: envelope(409, '该时间段内教室已被整间预约') },
    rescheduleOut(),
    '把数智楼123那间改到周四下午',
  )
  assert.equal(outcome.result.terminal, 'UNRESOLVED') // 409 是歧义信号 → 进查证（既有口径）
  assert.equal(gateway.transport.calls.filter((c) => c.method === 'DELETE').length, 0, '旧记录一个都没撤')
})
