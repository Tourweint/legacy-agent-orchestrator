// 表驱动状态机调度器 —— 第 04 章 §五 转移表的解释器（表在 config/state-machine.yaml）。
//
// 它只做三件事：
//   1. 按 (状态 × 目的 × 事件 × 载荷) 查表推进；未列出 = 非法转移 → 留痕并抛错（§5.6，
//      不静默通过、不就近处理）；ignore 型无边 = 记审计、状态不变、流程继续（§5.6/§5.9）
//   2. 步数预算（K1=60，跨运行累计）：任何情况下都保证停下来（§七 最后防线）
//   3. 目的（正向写入 / 补偿撤销）是一等上下文：SUBMITTING 被进入时必须携带目的
//
// 它不理解业务：事件由 run-engine 的状态处理器产生，处理器只负责"做事 + 报告发生了什么"。

import { readFileSync } from 'node:fs'
import { OrchestrationError, IllegalTransitionError } from './orchestration-error.js'

const TERMINAL_STATES = new Set(['DONE', 'REJECTED', 'FAILED', 'UNRESOLVED'])

export function isTerminal(state) {
  return TERMINAL_STATES.has(state)
}

export class TaskMachine {
  /**
   * @param {object} options
   * @param {object} options.table        解析好的转移表（configStore.getStateMachine()）
   * @param {object} options.constants    常量集合（limits.taskTotalSteps）
   * @param {object} options.evidenceChain 任务证据链（留痕）
   * @param {string} options.taskId
   */
  constructor({ table, constants, evidenceChain, taskId }) {
    this.table = table
    this.maxSteps = constants?.limits?.taskTotalSteps ?? 60
    this.evidenceChain = evidenceChain
    this.taskId = taskId
    this.state = table.initial
    this.purpose = 'forward'
    this.steps = 0
  }

  /**
   * 开始一次运行（第 04 章 §5.8）：首个运行从 IDLE 起，后续资源运行从 GATHERING 起，
   * 补偿运行从 COMPENSATING 起——运行的起点是任务级决定，不是表上的转移（不计步）。
   */
  begin(startState, purpose) {
    this.state = startState
    this.purpose = purpose
  }

  /**
   * 按表推进一次（一次状态转移算一步）。
   * @returns {{to: string, ignore: boolean}} 忽略型无边返回 {ignore: true}，状态不变
   */
  fire(event, { payload } = {}) {
    this.steps += 1
    if (this.steps > this.maxSteps) {
      // 最后防线：表驱动理论无环，但"理论上"不足以让人放心（第 04 章 §七）
      const breach = new OrchestrationError(`任务步数达到上限 ${this.maxSteps}，强制停止`)
      this.evidenceChain?.record({
        action: 'audit:step-budget-exhausted',
        input: { steps: this.steps, maxSteps: this.maxSteps, from: this.state, event },
        basis: [{ spec: 'constants.yaml#limits.taskTotalSteps' }],
        conclusion: { outcome: 'BUDGET_EXHAUSTED', summary: breach.message },
      })
      throw breach
    }
    if (isTerminal(this.state)) {
      throw new IllegalTransitionError({ from: this.state, event, purpose: this.purpose, payload })
    }

    const candidates = (this.table.edges ?? []).filter(
      (e) =>
        e.from === this.state &&
        e.event === event &&
        (e.purpose == null || e.purpose === this.purpose) &&
        (e.payload == null || e.payload === payload),
    )
    if (candidates.length === 0) {
      const violation = new IllegalTransitionError({ from: this.state, event, purpose: this.purpose, payload })
      this.#auditIllegal(violation)
      throw violation
    }
    const edge = candidates[0]
    if (edge.ignore) {
      // 忽略型无边：设计上不生效的事件——记录一条审计后继续当前流程（§5.6/§5.9）
      this.evidenceChain?.record({
        action: `audit:ignored-event`,
        input: { state: this.state, event, purpose: this.purpose },
        basis: [{ spec: 'state-machine.yaml#ignore' }],
        conclusion: { outcome: 'IGNORED', summary: '事件已登记，状态不变，流程继续' },
      })
      return { to: this.state, ignore: true }
    }
    this.state = edge.to
    return { to: this.state, ignore: false }
  }

  /** 非法转移留痕：来源状态、事件、当时的中间数据快照（§5.6）。 */
  #auditIllegal(violation) {
    this.evidenceChain?.record({
      action: 'audit:illegal-transition',
      input: { from: violation.from, event: violation.event, purpose: violation.purpose, payload: violation.payload },
      basis: [{ spec: 'state-machine.yaml' }],
      conclusion: { outcome: 'ILLEGAL_TRANSITION', summary: violation.message },
    })
  }
}
