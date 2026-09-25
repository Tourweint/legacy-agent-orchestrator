// 任务组合器 —— 第 04 章 §5.8（多资源运行组合与运行级终态 → 任务级处置的映射）+ §七（循环上限）。
//
// 任务级规则：
//   · 多资源顺序执行，禁止并发提交两个资源（M5）；补偿清单跨运行共享（D7 规格 5）
//   · 降级优先于补偿：只要还有可尝试的替代方案就不撤销已完成步骤（D7 拍板）
//   · 运行级 UNRESOLVED → 任务 UNRESOLVED（状态未知需人工，不自动在其上补偿）
//   · 最后一运行 REJECTED/FAILED 且补偿清单非空 → 以"目的=补偿撤销"的一次运行按清单逆序回滚
//   · 补偿清单不持久化，随任务销毁（K3）；步数预算跨运行累计（K1=60）

import { OrchestrationError } from './orchestration-error.js'
import { TaskMachine, isTerminal } from './state-machine.js'
import { RunEngine } from './run-engine.js'
import { Verifier } from './verifier.js'

export class TaskRunner {
  constructor({ configStore, gateway, judgmentEngine, evidenceChain, now = () => new Date() }) {
    this.store = configStore
    this.gateway = gateway
    this.judgment = judgmentEngine
    this.evidenceChain = evidenceChain
    this.now = now
    this.verifier = new Verifier({ configStore, gateway })
  }

  /**
   * 执行一个结构化任务（无 LLM 路径；理解层在阶段 5 接入同一入口）。
   * @param {object} p
   * @param {string} p.intentId      意图标识（闭集）
   * @param {Array}  p.resources     资源列表：[{classroom: {classroomId} | {building, roomNumber}, reason?}]（D7：多资源合法）
   * @param {object} p.slot          {start, end} 绝对时刻
   * @param {object} p.identity      {id} 业务身份
   * @returns 终态 + 逐资源结果 + 补偿报告 + 用户可读结论
   */
  async executeTask({ intentId, resources, slot, reason, identity }) {
    const intent = this.store.getIntent(intentId)
    if (!Array.isArray(resources) || resources.length === 0) {
      throw new OrchestrationError('任务缺少资源列表')
    }
    const machine = new TaskMachine({
      table: this.store.getStateMachine(),
      constants: this.store.getConstants(),
      evidenceChain: this.evidenceChain,
      taskId: this.evidenceChain?.taskId ?? 'task',
    })
    const runEngine = new RunEngine({
      configStore: this.store,
      gateway: this.gateway,
      judgmentEngine: this.judgment,
      verifier: this.verifier,
      evidenceChain: this.evidenceChain,
    })
    const taskContext = {
      compensations: [], // K3：不持久化，随任务销毁
      triedCandidates: [],
      degradeRounds: 0,
      counters: { forwardVerify: 0, compensateVerify: 0 },
    }

    const results = []
    let lastRun = null
    for (let i = 0; i < resources.length; i++) {
      try {
        // 每个运行播种自己的资源目标：有 id 直接用；人读名由 F1 收集时的名字路径解析
        // （§5.8 规格 2：实体消解一次完成后，后续运行从 GATHERING 起，事实从零收集）
        taskContext.currentTarget = { ...resources[i].classroom }
        lastRun = await runEngine.run({
          intent,
          machine,
          kind: 'forward',
          startState: i === 0 ? 'IDLE' : 'GATHERING', // §5.8 规格 2：后续运行从 GATHERING 起
          resource: resources[i],
          slot,
          reason: resources[i].reason ?? reason,
          identity,
          taskContext,
        })
      } catch (err) {
        return this.#forceUnresolved({ machine, taskContext, err, results })
      }
      results.push({
        resource: this.#resourceLabel(taskContext, resources[i], i),
        terminal: lastRun.terminal,
        message: lastRun.message,
      })
      if (lastRun.terminal === 'UNRESOLVED') {
        // UNRESOLVED 不在 §5.8 映射表内：副作用状态未知，转人工，不自动在其上补偿
        return this.#finish(machine, taskContext, 'UNRESOLVED', results)
      }
      // DONE / REJECTED / FAILED 且任务尚可继续 → 继续后续资源（§5.8 映射表）
    }

    const last = results[results.length - 1]
    if (last.terminal === 'DONE') {
      return this.#finish(machine, taskContext, 'DONE', results)
    }
    // 任务不可继续（已到最后一个资源）且补偿清单非空 → 进入补偿运行（降级优先于补偿）
    const pending = taskContext.compensations.filter((c) => !c.revoked)
    if (pending.length > 0) {
      let compRun
      try {
        compRun = await runEngine.run({
          intent,
          machine,
          kind: 'compensate',
          startState: 'COMPENSATING',
          identity,
          taskContext,
        })
      } catch (err) {
        return this.#forceUnresolved({ machine, taskContext, err, results })
      }
      return this.#finish(machine, taskContext, compRun.terminal, results)
    }
    // 补偿清单为空：运行级终态即任务级终态（§5.8 映射表末行）
    return this.#finish(machine, taskContext, last.terminal, results)
  }

  #finish(machine, taskContext, terminal, results) {
    const compensations = taskContext.compensations.map((c) => ({
      recordId: c.recordId,
      label: c.label,
      revoked: c.revoked,
    }))
    const conclusion = this.#conclusion(terminal, results, taskContext)
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
  #forceUnresolved({ machine, taskContext, err, results }) {
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
      results,
      compensations: taskContext.compensations.map((c) => ({ recordId: c.recordId, label: c.label, revoked: c.revoked })),
      conclusion: `任务异常终止（${err.message}），需人工介入核实副作用。`,
      evidenceRef: null,
    }
  }

  #resourceLabel(taskContext, resource, index) {
    const target = taskContext.currentTarget
    if (resource.classroom?.roomNumber) return `${resource.classroom.building ?? ''} ${resource.classroom.roomNumber}`.trim()
    if (target?.building) return `${target.building} ${target.roomNumber ?? ''}`.trim()
    return `资源 ${index + 1}`
  }

  #conclusion(terminal, results, taskContext) {
    const revoked = taskContext.compensations.filter((c) => c.revoked)
    const parts = []
    if (terminal === 'DONE') {
      const done = results.filter((r) => r.terminal === 'DONE')
      parts.push(done.map((r) => r.message).filter(Boolean).join(' '))
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
    return parts.filter(Boolean).join(' ')
  }
}
