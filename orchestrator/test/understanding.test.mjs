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

test('判据修正：用户原话里本来就有 "14:00到16:00" → 是原话片段，不该被判成模型自算的值', () => {
  const raw = JSON.stringify(
    validOutput({ slots: { classroomName: '数智楼222', datePhrase: '明天', timeSegment: '14:00到16:00' } }),
  )
  const withSpeech = validateUnderstandingOutput(raw, ['borrow-classroom'], '帮我订明天14:00到16:00数智楼222')
  assert.equal(withSpeech.ok, true)

  // 对照：用户只说了"明天下午"，槽位却变成 "14:00到16:00" → 那是模型自己算的，仍拒绝
  const withoutSpeech = validateUnderstandingOutput(raw, ['borrow-classroom'], '帮我订明天下午数智楼222')
  assert.equal(withoutSpeech.ok, false)
  assert.ok(withoutSpeech.violations.some((v) => v.includes('时钟时刻')))
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
  // 候选来自意图计划闭集（C7/C8/C12 上线后为 6 条）
  assert.deepEqual(result.candidates.map((c) => c.id).sort(), [
    'borrow-classroom',
    'borrow-seat',
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
        // availableDeferred：让这一步停住（用于"运行中取消"的用例——取消发生在写请求之前）
        return world.availableDeferred ?? ok(world.availableRows ?? [
          { id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' },
          { id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' },
        ])
      case '/classrooms/4/reserved_seats':
      case '/classrooms/5/reserved_seats':
      case '/classrooms/6/reserved_seats':
        // C12：默认"这个时段没人占座"；用例可传 reservedSeatIds 造"座位已被占"的场景
        return ok(world.reservedSeatIds ?? [])
      case '/admin/reservations': return ok(world.adminRows ?? [])
      case '/reservations': return ok(world.mineRows ?? []) // F5 我的预约（C7 用例在这里造数据）
      case '/admin/maintenance': return ok([])
      case '/reservations/classrooms': return world.createDeferred ?? world.create ?? ok(120)
      default: {
        const barePath = String(req.path).split('?')[0]
        // C12 座位级：座位布局（F2）、该时段被占座位（F3）、提交座位预约
        if (req.method === 'GET' && /^\/classrooms\/\d+\/seats$/.test(barePath)) {
          return ok(
            world.seats ?? [
              { id: 301, seatNumber: 'A1', status: 'AVAILABLE' },
              { id: 309, seatNumber: 'A3', status: 'AVAILABLE' },
            ],
          )
        }
        if (req.method === 'POST' && barePath === '/reservations/seats') {
          return world.seatCreate ?? ok(500)
        }
        // C7 撤销：DELETE /reservations/{id}
        if (req.method === 'DELETE' && /^\/reservations\/\d+$/.test(req.path)) {
          return world.cancel ?? ok(null)
        }
        return ok(null)
      }
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

test('精确区间端到端：说"下午两点到四点"直接按该区间办理（此前会落到"我没听懂"的追问）', async () => {
  const { runner } = makeChatRunner({}, [
    validOutput({ slots: { classroomName: '数智楼222', datePhrase: '明天', timeSegment: '下午两点到四点' } }),
  ])
  const outcome = await runner.executeChatTask({
    text: '帮我订明天下午两点到四点数智楼222',
    identity: sessionIdentity('TEACHER'),
  })
  assert.ok(!outcome.suspended, '精确区间不该再被追问')
  assert.equal(outcome.result.terminal, 'DONE')
  // §7.3：推算结果照常展示，供用户当场纠正
  assert.match(outcome.result.conclusion, /14:00–16:00/)
})

test('只说了一个钟点 → 追问用到几点（不猜默认时长）', async () => {
  const { runner } = makeChatRunner({}, [
    validOutput({ slots: { classroomName: '数智楼222', datePhrase: '明天', timeSegment: '下午两点' } }),
  ])
  const outcome = await runner.executeChatTask({
    text: '帮我订明天下午两点的数智楼222',
    identity: sessionIdentity('TEACHER'),
  })
  assert.ok(outcome.suspended)
  assert.equal(outcome.clarify.kind, 'unparseable-slot')
  assert.match(outcome.clarify.question, /只说了开始时间/)
  assert.match(outcome.clarify.question, /14点到16点/) // 追问里给出能听懂的说法
})

test('追问话术：听不懂时列出系统真正支持的说法，而不是"请换个说法"', async () => {
  const { runner } = makeChatRunner({}, [
    validOutput({ slots: { classroomName: '数智楼222', datePhrase: '下周', timeSegment: '有空的时候' } }),
  ])
  const outcome = await runner.executeChatTask({
    text: '下周有空的时候帮我订数智楼222',
    identity: sessionIdentity('TEACHER'),
  })
  assert.ok(outcome.suspended)
  assert.match(outcome.clarify.question, /我没听懂/)
  assert.match(outcome.clarify.question, /今天、明天、后天/)
  assert.match(outcome.clarify.question, /14点到16点/)
})

test('会话记忆接进理解层：传入的 history 随本轮一起交给模型（跨任务也记得住上一句）', async () => {
  const { runner, llm } = makeChatRunner({}, [validOutput()])
  const history = [
    { role: 'user', content: '帮我借明天下午数智楼123' },
    {
      role: 'assistant',
      content: JSON.stringify({
        intent: 'borrow-classroom',
        slots: { classroomName: '数智楼123', datePhrase: '明天', timeSegment: '下午' },
        outcome: 'DONE',
      }),
    },
  ]

  await runner.executeChatTask({ text: '那改成后天下午', identity: sessionIdentity('TEACHER'), history })

  const messages = llm.calls[llm.calls.length - 1]
  assert.ok(
    messages.some((m) => m.role === 'user' && m.content === '帮我借明天下午数智楼123'),
    '上一轮原话要在场',
  )
  assert.ok(
    messages.some((m) => m.role === 'assistant' && m.content.includes('数智楼123')),
    '上一轮的结构化摘要要作为助手侧历史在场',
  )
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

test('取消运行中的任务：写请求未发出前受理，运行循环在状态边界收口为 REJECTED', async () => {
  let release
  const gate = new Promise((r) => {
    release = r
  })
  const { runner, chain } = makeChatRunner({ availableDeferred: gate }, [validOutput()])

  let stack = null
  const running = runner.executeChatTask({
    text: '帮我借下周三下午数智楼222',
    identity: sessionIdentity('TEACHER'),
    onStack: (s) => {
      stack = s
    },
  })
  // 运行栈一开跑就该拿得到：修复前它只在**挂起时**回填，于是运行中的取消连状态都读不到
  assert.ok(stack, 'onStack 必须给出运行栈')

  for (let i = 0; i < 100 && stack.machine.state !== 'RESOLVING'; i += 1) {
    await new Promise((r) => setTimeout(r, 2))
  }
  assert.equal(stack.machine.state, 'RESOLVING', '应当停在消解（正在等被卡住的假请求）')

  const outcome = runner.cancelChat({ stack })
  assert.equal(outcome.requested, true, '写请求未发出 → 应当受理取消')

  release(ok([{ id: 4, building: '数智楼', roomNumber: '222', capacity: 55, status: 'ENABLED' }])) // 放行；收口发生在下一个状态边界
  const { result } = await running
  assert.equal(result.terminal, 'REJECTED')
  assert.ok(result.conclusion.includes('未产生任何变更'))
  // 取消前已发出的只读调用不算数；**写入**一次都不能有（取消发生在写请求之前）
  assert.equal(
    chain
      .getEntries()
      .filter((e) => String(e.action).startsWith('contact:') && /create|cancel/i.test(e.action)).length,
    0,
    '取消之后不得有任何写入',
  )
})

test('写请求已发出后不受理取消：如实说明"结果正在核对"，任务照常跑完', async () => {
  let release
  const gate = new Promise((r) => {
    release = r
  })
  const { runner } = makeChatRunner({ createDeferred: gate }, [validOutput()])

  let stack = null
  const running = runner.executeChatTask({
    text: '帮我借下周三下午数智楼222',
    identity: sessionIdentity('TEACHER'),
    onStack: (s) => {
      stack = s
    },
  })
  for (let i = 0; i < 300 && stack.machine.state !== 'SUBMITTING'; i += 1) {
    await new Promise((r) => setTimeout(r, 2))
  }
  assert.equal(stack.machine.state, 'SUBMITTING')

  assert.throws(() => runner.cancelChat({ stack }), /提交给系统/, '副作用可能在飞，取消必须被拒绝')

  release(ok(120))
  const { result } = await running
  assert.equal(result.terminal, 'DONE', '不受理取消 → 任务按真实结果收场')
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

// ---- 零术语（P1-3）：界面上的文案不许出现内部编号 -----------------------------

test('零术语：理解结果的人话文案不含 intentId 与英文槽位键（界面直接显示这一句）', async () => {
  const { chain } = await chat(
    {},
    [
      {
        intent: 'borrow-classroom',
        slots: { classroomName: '数智楼123', datePhrase: '明天', timeSegment: '下午' },
        confidence: 0.92,
        outOfDomain: false,
      },
    ],
    '帮我借明天下午数智楼123',
  )
  const entry = chain.getEntries().find((e) => e.action === 'decide:understand')
  assert.ok(entry, '理解决策有留痕')
  assert.match(entry.conclusion.summary, /识别为「借教室」/)
  assert.match(entry.conclusion.summary, /教室=数智楼123/)
  assert.match(entry.conclusion.summary, /日期=明天/)
  // 关键断言：观众看得见的这句话里不许出现 intentId 或英文槽位键
  assert.doesNotMatch(entry.conclusion.summary, /borrow-classroom|classroomName|datePhrase|timeSegment/)
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

const chat = (world, llmResponses, text, role = 'TEACHER') => {
  const harness = makeChatRunner(world, llmResponses)
  return harness.runner
    .executeChatTask({ text, identity: sessionIdentity(role) })
    .then((outcome) => ({ ...harness, outcome }))
}

// ---- C12 学生占座（座位级写入；2026-09-26 新增）--------------------------------

const seatSlots = { classroomName: '数智楼123', seatNumber: 'A3', datePhrase: '明天', timeSegment: '下午' }
const seatOut = (over = {}) => [
  { intent: 'borrow-seat', slots: { ...seatSlots, ...over }, confidence: 0.9, outOfDomain: false },
]
test('降级换教室：结论必须说明"为什么换了"（I4：可解释性不是加分项）', async () => {
  const { outcome } = await chat(
    // 数智楼123 被他人长期占用（宽时段，保证与"明天下午"重叠）→ 触发换教室
    { adminRows: [conflictRow()] },
    [
      {
        intent: 'borrow-classroom',
        slots: { classroomName: '数智楼123', datePhrase: '明天', timeSegment: '下午' },
        confidence: 0.9,
        outOfDomain: false,
      },
    ],
    '帮我借明天下午数智楼123',
  )
  assert.equal(outcome.result.terminal, 'DONE')
  assert.match(outcome.result.conclusion, /数智楼 222/, '换到哪间要出现在结论里')
  assert.match(
    outcome.result.conclusion,
    /原教室 数智楼 123 在该时段不可用/,
    '还要说清为什么换了——否则用户以为系统听错了自己说的教室',
  )
})

const seatSubmits = (gateway) => gateway.transport.calls.filter((c) => c.path === '/reservations/seats')

test('C12 占座：学生一句话占座 —— 座位号解析成座位 id 后提交，且只提交一次', async () => {
  const { outcome, gateway } = await chat({ mineRows: [], adminRows: [] }, seatOut(), '帮我占明天下午数智楼123的A3座位', 'STUDENT')
  assert.ok(!outcome.suspended)
  assert.equal(outcome.result.terminal, 'DONE')
  assert.match(outcome.result.conclusion, /已为您占好座位/)
  const submits = seatSubmits(gateway)
  assert.equal(submits.length, 1)
  assert.equal(submits[0].body.seat_id, 309, '座位号 A3 被解析成座位 id 309 提交')
})

test('C12 占座：座位号不存在 → 有依据拒绝（引用学生说的座位号），零写入', async () => {
  const { outcome, gateway } = await chat(
    { seats: [{ id: 301, seatNumber: 'A1', status: 'AVAILABLE' }] },
    seatOut({ seatNumber: 'A9' }),
    '帮我占明天下午数智楼123的A9',
    'STUDENT',
  )
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.match(outcome.result.conclusion, /A9/)
  assert.equal(seatSubmits(gateway).length, 0)
})

test('C12 占座：该座位这个时段已被占 → 有依据拒绝，零写入', async () => {
  const { outcome, gateway } = await chat({ reservedSeatIds: [309] }, seatOut(), '帮我占明天下午数智楼123的A3', 'STUDENT')
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.match(outcome.result.conclusion, /已经被别人占了/)
  assert.equal(seatSubmits(gateway).length, 0)
})

test('C12 占座：教师走学生通道 → 有依据拒绝并给替代动作，且零调用', async () => {
  const { outcome, gateway } = await chat({}, seatOut(), '帮我占明天下午数智楼123的A3', 'TEACHER')
  assert.equal(outcome.result.terminal, 'REJECTED')
  assert.match(outcome.result.conclusion, /学生通道/)
  assert.equal(gateway.transport.calls.length, 0, '拒绝发生在任何调用之前')
})

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
