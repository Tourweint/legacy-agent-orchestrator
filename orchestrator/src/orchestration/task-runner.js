// 任务组合器 —— 第 04 章 §5.8（多资源运行组合与运行级终态 → 任务级处置的映射）+ §七（循环上限）。
//
// 任务级规则：
//   · 多资源顺序执行，禁止并发提交两个资源（M5）；补偿清单跨运行共享（D7 规格 5）
//   · 降级优先于补偿：只要还有可尝试的替代方案就不撤销已完成步骤（D7 拍板）
//   · 运行级 UNRESOLVED → 任务 UNRESOLVED（状态未知需人工，不自动在其上补偿）
//   · 最后一运行 REJECTED/FAILED 且补偿清单非空 → 以"目的=补偿撤销"的一次运行按清单逆序回滚
//   · 补偿清单不持久化，随任务销毁（K3）；步数预算跨运行累计（K1=60）
//   · 两条入口路径汇入同一段编排逻辑（第 03 章 §十）：结构化任务与自然语言任务
//     都走同一个资源队列驱动器（#driveQueue）；聊天路径多出的只有理解与追问
//
// 聊天任务（阶段 5）：理解/追问发生在第一个资源的运行内（UNDERSTANDING 态），
// 挂起（AWAIT_CLARIFY）时任务保留机器与上下文，恢复后继续同一资源队列。

import { OrchestrationError } from './orchestration-error.js'
import { authorizeIntent, roleLabel } from './intent-authorizer.js'
import { TaskMachine } from './state-machine.js'
import { RunEngine, CANCELABLE_STATES, WRITE_STATES } from './run-engine.js'
import { Verifier } from './verifier.js'
import { ChatBridge } from './chat-bridge.js'

export class TaskRunner {
  constructor({ configStore, gateway, judgmentEngine, evidenceChain, understandingEngine, user = null, now = () => new Date() }) {
    this.store = configStore
    this.gateway = gateway
    this.judgment = judgmentEngine
    this.evidenceChain = evidenceChain
    this.user = user // 发起人（登录会话派生）；角色鉴权用（决定 4/5）
    this.now = now
    this.verifier = new Verifier({ configStore, gateway })
    this.understandingEngine = understandingEngine
  }

  #newStack(taskId) {
    const machine = new TaskMachine({
      table: this.store.getStateMachine(),
      constants: this.store.getConstants(),
      evidenceChain: this.evidenceChain,
      taskId: taskId ?? this.evidenceChain?.taskId ?? 'task',
    })
    const runEngine = new RunEngine({
      configStore: this.store,
      gateway: this.gateway,
      judgmentEngine: this.judgment,
      verifier: this.verifier,
      evidenceChain: this.evidenceChain,
      chatBridge: new ChatBridge({
        configStore: this.store,
        understandingEngine: this.understandingEngine,
        evidenceChain: this.evidenceChain,
      }),
    })
    const taskContext = {
      machine, // 挂起/恢复需要保留机器与上下文（chat 会话内有效，A6）
      compensations: [], // K3：不持久化，随任务销毁
      triedCandidates: [],
      degradeRounds: 0,
      counters: { forwardVerify: 0, compensateVerify: 0 },
      results: [],
      chat: { history: [], slots: {}, clarifyRounds: 0, clarify: null, pendingTurn: null, resources: null },
    }
    return { machine, runEngine, taskContext }
  }

  /**
   * 结构化任务入口（无 LLM 路径，第 03 章 §十）。
   * @param {object} p
   * @param {string} p.intentId      意图标识（闭集）
   * @param {Array}  p.resources     [{classroom: {classroomId} | {building, roomNumber}, reason?}]（D7）
   * @param {object} p.slot          {start, end} 绝对时刻
   * @param {object} p.identity      {id} 业务身份
   */
  async executeTask({ intentId, resources, slot, reason, identity, onStack }) {
    const intent = this.store.getIntent(intentId)
    // 目标不是教室的意图（C7）：不需要调用方给资源目标，引擎自己从"我的预约"里定位那一条记录
    const targetless = intent.requiresEntityResolution === false
    const queue = Array.isArray(resources) && resources.length > 0
      ? resources
      : targetless
        ? [{ classroom: {} }]
        : null
    if (!queue) {
      throw new OrchestrationError('任务缺少资源列表')
    }
    // 越权拒绝发生在任何调用之前（决定 5）：结构化入口在 IDLE 态直接落 REJECTED，不发任何请求
    const denial = authorizeIntent({ intent, identity: this.#identityWithRole(identity) })
    if (denial) return this.#rejectForbidden({ intent, denial, identity })
    const stack = this.#newStack()
    onStack?.(stack) // 运行期间让调用方也拿得到运行栈（取消要读它的状态，见 cancelChat）
    stack.taskContext.intent = intent
    stack.taskContext.intentId = intent.id
    const { result } = await this.#driveQueue({
      stack,
      identity,
      queue: queue.map((r) => ({ classroom: r.classroom ?? {}, reason: r.reason ?? reason })),
      slot,
      reason,
      startStateForFirst: 'IDLE',
    })
    return result
  }

  /**
   * 自然语言任务入口（第 03 章 §十：与结构化路径汇入同一段编排逻辑——
   * 理解产出后走同一个资源队列驱动器）。挂起时返回 clarify 并保留运行栈。
   * @param {object} p
   * @param {string} p.text      用户原话
   * @param {object} p.identity  {id} 业务身份
   * @param {Array}  [p.history] 会话记忆（上一轮及更早的结构化摘要，来自 ConversationStore）
   * @returns {{result}|{suspended: true, clarify, stack}} 另附 understanding（本轮理解摘要，供会话留档）
   */
  async executeChatTask({ text, identity, history = [], onStack }) {
    const stack = this.#newStack()
    // 运行期间把运行栈交给调用方（接入层据此判断"能不能取消"、停在哪个状态）；
    // 此前只在**挂起时**回填，于是运行中的取消请求连状态都读不到，只能一律拒绝。
    onStack?.(stack)
    // 会话记忆先铺底：理解层因此看得到"上一句说的是哪间教室/哪个时段"；
    // 本任务内追问产生的对话（clarify ↔ 回复）继续追加在其后（chat-bridge 负责）
    stack.taskContext.chat.history = [...history]
    stack.taskContext.chat.pendingTurn = { text }
    let run
    try {
      run = await stack.runEngine.run({ kind: 'chat', startState: 'IDLE', identity, taskContext: stack.taskContext })
    } catch (err) {
      return { result: this.#forceUnresolved({ stack, err }), understanding: this.#chatSummary(stack) }
    }
    if (run.suspended) {
      // 挂起：任务未终态，保留栈等用户回复（resumeChat）
      return {
        suspended: true,
        clarify: stack.taskContext.chat.clarify,
        stack,
        understanding: this.#chatSummary(stack),
      }
    }
    this.#pushRunResult(stack, run)
    if (run.terminal === 'UNRESOLVED') {
      return { result: this.#finish(stack, 'UNRESOLVED'), understanding: this.#chatSummary(stack) }
    }
    // 剩余资源（D7 聊天多资源：槽位里解析出的第二间及以后）走同一队列
    const outcome = await this.#driveQueue({
      stack,
      identity,
      queue: (stack.taskContext.chat.resources ?? []).slice(1),
      startStateForFirst: 'GATHERING',
    })
    return { ...outcome, understanding: this.#chatSummary(stack) }
  }

  /** 本轮的理解摘要（意图 + 槽位原话）——供会话记忆留档；未解析出时给中立值。 */
  #chatSummary(stack) {
    const tc = stack.taskContext
    return {
      intent: tc.intentId ?? tc.intent?.id ?? null,
      slots: { ...(tc.chat?.slots ?? {}) },
    }
  }

  /** 挂起任务恢复（追问回复；A6：会话内有效）。 */
  async resumeChat({ stack, replyText }) {
    let run
    try {
      run = await stack.runEngine.resume({ taskContext: stack.taskContext, replyText })
    } catch (err) {
      return { result: this.#forceUnresolved({ stack, err }) }
    }
    if (run.suspended) {
      return { suspended: true, clarify: stack.taskContext.chat.clarify, stack }
    }
    this.#pushRunResult(stack, run)
    if (run.terminal === 'UNRESOLVED') {
      return { result: this.#finish(stack, 'UNRESOLVED') }
    }
    return this.#driveQueue({
      stack,
      identity: stack.taskContext.identity,
      queue: (stack.taskContext.chat.resources ?? []).slice(1),
      startStateForFirst: 'GATHERING',
    })
  }

  /** 角色取"任务发起人"的声明，其次取编排层装配的 user（两条来源一致；测试可只给 identity）。 */
  #identityWithRole(identity) {
    return { ...identity, role: identity?.role ?? this.user?.role ?? null }
  }

  /**
   * 越权拒绝（决定 5）：有依据地拒绝 + 给出替代动作，**不发起任何调用**（I5：不重试、不降级猜测）。
   * 结构化入口从 IDLE 落 REJECTED；自然语言入口的同类拒绝在理解桥里（它才知道意图是什么）。
   */
  #rejectForbidden({ intent, denial, identity }) {
    const stack = this.#newStack()
    stack.taskContext.intent = intent
    stack.taskContext.intentId = intent.id
    stack.taskContext.identity = identity
    const { machine, taskContext } = stack
    machine.begin('IDLE', 'forward')
    taskContext.outcome = { message: denial.message }
    taskContext.results.push({ resource: '—', terminal: 'REJECTED', message: denial.message })
    const entry = this.evidenceChain?.record({
      phase: 'P1',
      action: 'decide:intent-forbidden',
      initiator: identity?.id ?? null,
      actingIdentity: '本人身份',
      input: {
        intentId: intent.id,
        requiredRole: roleLabel(denial.required),
        actualRole: roleLabel(denial.actual),
        callsMade: 0, // 关键证据：拒绝发生在任何调用之前
      },
      basis: [{ spec: 'login-permission-plan#decision-5' }],
      conclusion: { outcome: 'INTENT_FORBIDDEN', summary: denial.message },
    })
    if (entry) taskContext.lastDecisionSeq = entry.seq
    machine.fire('INTENT_FORBIDDEN')
    return this.#finish(stack, 'REJECTED')
  }

  /**
   * 取消任务。
   *
   * 口径（B8 + 2026-09-27 修正）：**写请求发出之前**都可以取消——
   *   · 挂起中（AWAIT_CLARIFY）：立即取消，直接落 REJECTED；
   *   · 运行中但尚未发出写请求（理解/消解/收集/判定/降级）：置停止标记，
   *     由运行循环在下一个状态边界收口（用户点一下就该停，不该被"运行中"挡住）。
   * 写请求一旦发出（SUBMITTING 及之后）：**不受理**——副作用可能已经在飞，
   * 此时"取消"是个谎言；只能由查证收敛给出确定结论（I3/I6）。
   *
   * @returns {{result}|{requested:true}}
   */
  cancelChat({ stack }) {
    const state = stack.machine.state
    if (state === 'AWAIT_CLARIFY') {
      stack.taskContext.outcome = { message: '已按您的要求取消，未产生任何变更。' }
      stack.machine.fire('USER_CANCELLED') // → REJECTED
      this.#pushRunResult(stack, { terminal: stack.machine.state, message: stack.taskContext.outcome.message })
      return { result: this.#finish(stack, stack.machine.state) }
    }
    if (CANCELABLE_STATES.has(state)) {
      stack.taskContext.cancelRequested = true
      return { requested: true }
    }
    const err = new OrchestrationError(
      WRITE_STATES.has(state)
        ? '这一步已经提交给系统了，结果正在核对，暂时不能中断（取消只在写请求发出前生效）'
        : '任务已经结束，无需取消',
    )
    err.code = 'CANCEL_NOT_EFFECTIVE'
    throw err
  }

  // 资源队列驱动：逐运行执行 + §5.8 任务级映射（UNRESOLVED 早退 / DONE / 补偿 / 清单空）
  async #driveQueue({ stack, identity, queue, slot, reason, startStateForFirst = 'GATHERING' }) {
    const { machine, runEngine, taskContext } = stack
    for (let i = 0; i < queue.length; i++) {
      const resource = queue[i]
      try {
        // 每个运行播种自己的资源目标：有 id 直接用；人读名由 F1 收集时的名字路径解析
        taskContext.currentTarget = { ...resource.classroom }
        const run = await runEngine.run({
          kind: 'forward',
          startState: i === 0 ? startStateForFirst : 'GATHERING', // §5.8 规格 2
          resource,
          slot: slot ?? taskContext.slot,
          reason: resource.reason ?? reason,
          identity,
          taskContext,
        })
        this.#pushRunResult(stack, run)
      } catch (err) {
        return { result: this.#forceUnresolved({ stack, err }) }
      }
      if (taskContext.results[taskContext.results.length - 1].terminal === 'UNRESOLVED') {
        // UNRESOLVED 不在 §5.8 映射表内：副作用状态未知，转人工，不自动在其上补偿
        return { result: this.#finish(stack, 'UNRESOLVED') }
      }
      // DONE / REJECTED / FAILED 且任务尚可继续 → 继续后续资源（§5.8 映射表）
    }
    const last = taskContext.results[taskContext.results.length - 1]
    if (last.terminal === 'DONE') {
      return { result: this.#finish(stack, 'DONE') }
    }
    // 任务不可继续（已到最后一个资源）且补偿清单非空 → 进入补偿运行（降级优先于补偿）
    const pending = taskContext.compensations.filter((c) => !c.revoked)
    if (pending.length > 0) {
      let compRun
      try {
        compRun = await runEngine.run({ kind: 'compensate', startState: 'COMPENSATING', identity, taskContext })
      } catch (err) {
        return { result: this.#forceUnresolved({ stack, err }) }
      }
      return { result: this.#finish(stack, compRun.terminal) }
    }
    // 补偿清单为空：运行级终态即任务级终态（§5.8 映射表末行）
    return { result: this.#finish(stack, last.terminal) }
  }

  #pushRunResult(stack, run) {
    stack.taskContext.results.push({
      resource: this.#resourceLabel(stack.taskContext),
      terminal: run.terminal,
      message: run.message,
    })
  }

  #resourceLabel(taskContext) {
    const t = taskContext.currentTarget
    if (t?.building) return `${t.building} ${t.roomNumber ?? ''}`.trim()
    if (t?.classroomId != null) return `教室 ${t.classroomId}`
    return '资源'
  }

  #finish(stack, terminal) {
    const { machine, taskContext } = stack
    const results = [...taskContext.results]
    const compensations = taskContext.compensations.map((c) => ({
      recordId: c.recordId,
      label: c.label,
      slotText: c.slotText,
      revoked: c.revoked,
    }))
    const conclusion = this.#conclusion(terminal, taskContext)
    const evidenceRef = this.evidenceChain?.record({
      phase: 'P6',
      action: 'task-terminal',
      input: { terminal, steps: machine.steps },
      // 终态结论的依据 = 最后一条任务决策（判定/查证/降级/补偿），形成可回溯链条
      basis: [taskContext.lastDecisionSeq ? { evidence: taskContext.lastDecisionSeq } : { spec: 'orchestration' }],
      conclusion: { outcome: terminal, summary: conclusion },
      metadata: { compensations },
    }) ?? null
    return {
      terminal,
      steps: machine.steps,
      results,
      compensations,
      conclusion,
      evidenceRef: evidenceRef ? { taskId: evidenceRef.taskId, seq: evidenceRef.seq } : null,
    }
  }

  // 步数预算耗尽 / 编排层未预期错误：任务强制落 UNRESOLVED 并留痕（§七 / §5.6 保守登记）
  #forceUnresolved({ stack, err }) {
    const { machine, taskContext } = stack
    machine.state = 'UNRESOLVED' // 保守登记：按最保守方式收场，不猜测所处状态
    this.evidenceChain?.record({
      phase: 'P6',
      action: 'task-force-unresolved',
      input: { from: machine.state, error: err.message, steps: machine.steps },
      basis: [{ spec: 'state-machine.yaml' }],
      conclusion: { outcome: 'UNRESOLVED', summary: err.message },
    })
    return {
      terminal: 'UNRESOLVED',
      steps: machine.steps,
      results: [...taskContext.results],
      compensations: taskContext.compensations.map((c) => ({ recordId: c.recordId, label: c.label, revoked: c.revoked })),
      conclusion: `任务异常终止（${err.message}），需人工介入核实副作用。`,
      evidenceRef: null,
    }
  }

  #conclusion(terminal, taskContext) {
    const results = taskContext.results
    const revoked = taskContext.compensations.filter((c) => c.revoked)
    const confirms = taskContext.confirmNotes ?? [] // §7.3：归一化推算的"请确认"注记
    const confirmSuffix = confirms.length > 0 ? `（请确认：${confirms.join('；')}）` : ''
    const parts = []
    if (terminal === 'DONE') {
      parts.push(results.map((r) => r.message).filter(Boolean).join(' '))
    } else {
      const failed = results.filter((r) => r.terminal !== 'DONE')
      parts.push(failed.map((r) => r.message).filter(Boolean).join(' '))
      if (revoked.length > 0 && terminal === 'FAILED') {
        // 2026-09-27 白话化：不再给"#记录号"，给资源与白话时段
        parts.push(
          `已撤销此前完成的预订：${revoked
            .map((c) => `${c.label}${c.slotText ? `（${c.slotText}）` : ''}`)
            .join('、')}。`,
        )
      }
      if (terminal === 'UNRESOLVED') {
        parts.push('该任务存在未能收敛的副作用或未知状态，需人工介入。')
      }
    }
    return parts.filter(Boolean).join(' ') + confirmSuffix
  }
}
