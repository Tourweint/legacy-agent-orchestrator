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
import { TaskMachine } from './state-machine.js'
import { RunEngine } from './run-engine.js'
import { Verifier } from './verifier.js'
import { ChatBridge } from './chat-bridge.js'

export class TaskRunner {
  constructor({ configStore, gateway, judgmentEngine, evidenceChain, understandingEngine, now = () => new Date() }) {
    this.store = configStore
    this.gateway = gateway
    this.judgment = judgmentEngine
    this.evidenceChain = evidenceChain
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
  async executeTask({ intentId, resources, slot, reason, identity }) {
    const intent = this.store.getIntent(intentId)
    if (!Array.isArray(resources) || resources.length === 0) {
      throw new OrchestrationError('任务缺少资源列表')
    }
    const stack = this.#newStack()
    stack.taskContext.intent = intent
    stack.taskContext.intentId = intent.id
    const { result } = await this.#driveQueue({
      stack,
      identity,
      queue: resources.map((r) => ({ classroom: r.classroom, reason: r.reason ?? reason })),
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
   * @returns {{result}|{suspended: true, clarify, stack}}
   */
  async executeChatTask({ text, identity }) {
    const stack = this.#newStack()
    stack.taskContext.chat.pendingTurn = { text }
    let run
    try {
      run = await stack.runEngine.run({ kind: 'chat', startState: 'IDLE', identity, taskContext: stack.taskContext })
    } catch (err) {
      return { result: this.#forceUnresolved({ stack, err }) }
    }
    if (run.suspended) {
      // 挂起：任务未终态，保留栈等用户回复（resumeChat）
      return { suspended: true, clarify: stack.taskContext.chat.clarify, stack }
    }
    this.#pushRunResult(stack, run)
    if (run.terminal === 'UNRESOLVED') {
      return { result: this.#finish(stack, 'UNRESOLVED') }
    }
    // 剩余资源（D7 聊天多资源：槽位里解析出的第二间及以后）走同一队列
    return this.#driveQueue({
      stack,
      identity,
      queue: (stack.taskContext.chat.resources ?? []).slice(1),
      startStateForFirst: 'GATHERING',
    })
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

  /** 取消挂起中的任务（B8：写请求发出前取消才生效——AWAIT_CLARIFY 必然在提交前）。 */
  cancelChat({ stack }) {
    if (stack.machine.state !== 'AWAIT_CLARIFY') {
      const err = new OrchestrationError('任务不在挂起态，取消不生效（B8：该状态的取消是忽略型无边）')
      err.code = 'CANCEL_NOT_EFFECTIVE'
      throw err
    }
    stack.taskContext.outcome = { message: '已按您的要求取消，未产生任何变更。' }
    stack.machine.fire('USER_CANCELLED') // → REJECTED
    this.#pushRunResult(stack, { terminal: stack.machine.state, message: stack.taskContext.outcome.message })
    return { result: this.#finish(stack, stack.machine.state) }
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
        parts.push(`已撤销此前完成的预订：${revoked.map((c) => `#${c.recordId}（${c.label}）`).join('、')}。`)
      }
      if (terminal === 'UNRESOLVED') {
        parts.push('该任务存在未能收敛的副作用或未知状态，需人工介入。')
      }
    }
    return parts.filter(Boolean).join(' ') + confirmSuffix
  }
}
