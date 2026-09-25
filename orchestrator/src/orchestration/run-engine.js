// 单次运行 —— 第 04 章 §5.8：一次运行承载一个资源目标的完整生命周期。
// 正向写入与补偿撤销复用同一套 SUBMITTING/JUDGING/VERIFYING 机制（§六 约束一）：
// 区别只在 machine.purpose 这一个标记上，而不是两条代码路径——补偿请求同样会超时、
// 同样返回歧义信号、同样需要查证（"补偿失败被误判为成功"是最危险的假成功）。
//
// 各状态处理器只做两件事：执行该状态的动作（经判定层/接触层，自己不发 HTTP）、
// 按动作结果触发事件。转移合法性全部由调度器查表保证。

import { OrchestrationError } from './orchestration-error.js'
import { isTerminal } from './state-machine.js'
import { normalizeSpace } from '../judgment/predicates.js'
import { describeRange } from '../canonical/time.js'

function machineGuard(taskContext) {
  if (!taskContext.machine) throw new OrchestrationError('taskContext.machine 未初始化（由 TaskRunner 注入）')
}

export class RunEngine {
  constructor({ configStore, gateway, judgmentEngine, verifier, evidenceChain, chatBridge }) {
    this.store = configStore
    this.gateway = gateway
    this.judgment = judgmentEngine
    this.verifier = verifier
    this.evidenceChain = evidenceChain
    this.chatBridge = chatBridge
  }

  /**
   * 执行一次运行直到终态或挂起（AWAIT_CLARIFY，chat 专用）。
   * @param {object} p
   * @param {string} p.kind            'forward' | 'compensate' | 'chat'
   * @param {string} p.startState      IDLE / GATHERING / COMPENSATING
   * @param {object} p.taskContext     跨运行共享：意图、补偿清单、降级轮次、查证计数、聊天状态
   */
  async run({ kind, startState, resource, slot, reason, identity, taskContext }) {
    machineGuard(taskContext)
    const machine = taskContext.machine
    machine.begin(startState, kind === 'chat' ? 'forward' : kind)
    taskContext.outcome = null
    if (kind === 'chat') {
      taskContext.identity = identity
      // 首轮用户输入已由 task-runner 放入 taskContext.chat.pendingTurn
      machine.fire('START') // 自然语言入口（第 04 章 §4.1）
    } else if (kind === 'forward') {
      taskContext.slot = slot
      taskContext.identity = identity
      taskContext.reason = reason
      taskContext.originalClassroom = null // 降级基准按运行计：每个资源有自己的"原教室"（§8.1）
      if (startState === 'IDLE') machine.fire('START_STRUCT') // 结构化任务入口（无 LLM 路径，第 03 章 §十）
    }
    return this.#drive({ machine, taskContext, resource, kind })
  }

  /** 挂起恢复：追问后重问理解层（§5.5：不拼接片段，走同样的闸门）。 */
  async resume({ taskContext, replyText }) {
    const machine = taskContext.machine
    this.chatBridge.beginResume({ taskContext, replyText })
    machine.fire('USER_REPLIED') // AWAIT_CLARIFY → UNDERSTANDING
    return this.#drive({ machine, taskContext, kind: 'chat' })
  }

  // 驱动循环：终态或挂起时返回；其余状态逐个交给处理器
  async #drive({ machine, taskContext, resource, kind }) {
    while (!isTerminal(machine.state) && machine.state !== 'AWAIT_CLARIFY') {
      switch (machine.state) {
        case 'UNDERSTANDING': await this.chatBridge.handleUnderstanding({ machine, taskContext }); break
        case 'RESOLVING': await this.#doResolving({ machine, resource, taskContext }); break
        case 'GATHERING': await this.#doGathering({ machine, taskContext }); break
        case 'VALIDATING': await this.#doValidating({ machine, taskContext }); break
        case 'SUBMITTING': await this.#doSubmitting({ machine, taskContext }); break
        case 'JUDGING': this.#doJudging({ machine, taskContext }); break
        case 'VERIFYING': await this.#doVerifying({ machine, taskContext }); break
        case 'DEGRADING': await this.#doDegrading({ machine, taskContext }); break
        case 'COMPENSATING': await this.#doCompensating({ machine, taskContext }); break
        default:
          throw new OrchestrationError(`状态处理器缺失: ${machine.state}`)
      }
    }
    return {
      terminal: isTerminal(machine.state) ? machine.state : null,
      suspended: machine.state === 'AWAIT_CLARIFY',
      message: taskContext.outcome?.message ?? '',
    }
  }

  // ── 实体消解（RESOLVING）：人读名 → 系统标识。列表查询走意图计划声明的候选来源接口 ──
  async #doResolving({ machine, resource, taskContext }) {
    // 目标来自任务上下文：结构化运行由队列播种，聊天运行由桥在归一化后播种
    const classroom = taskContext.currentTarget ?? {}
    if (classroom.classroomId != null) {
      taskContext.currentTarget = { ...classroom }
      machine.fire('ENTITY_RESOLVED', { payload: classroom.classroomId })
      return
    }
    // 查询失败与未找到统一走 ENTITY_UNRESOLVED → REJECTED：尚未产生任何副作用，保守拒绝一致
    // 名字解析来源：resolution.candidatesFrom（解析 ≠ 降级——查询意图不降级但也要解析名字）
    const resolveVia = taskContext.intent.resolution?.candidatesFrom ?? taskContext.intent.degrade?.candidatesFrom
    if (!resolveVia) {
      taskContext.outcome = { message: '意图计划缺少名字解析来源（resolution.candidatesFrom）。' }
      machine.fire('ENTITY_UNRESOLVED', { payload: { reason: 'no-resolution-source' } })
      return
    }
    const r = await this.gateway.call(resolveVia, {
      building: classroom.building,
      minCapacity: 0,
    }, { phase: 'P2' })
    if (r.verdict !== 'SUCCESS') {
      taskContext.outcome = { message: '暂时无法查询教室列表，未能解析您说的教室。' }
      machine.fire('ENTITY_UNRESOLVED', { payload: { reason: 'query-failed' } })
      return
    }
    const wanted = normalizeSpace(classroom.roomNumber)
    const matches = (r.data ?? []).filter((c) => normalizeSpace(c.roomNumber) === wanted)
    if (matches.length === 1) {
      taskContext.currentTarget = {
        classroomId: matches[0].classroomId,
        building: matches[0].building,
        roomNumber: matches[0].roomNumber,
      }
      machine.fire('ENTITY_RESOLVED', { payload: matches[0].classroomId })
      return
    }
    taskContext.outcome = {
      message:
        matches.length === 0
          ? `系统中没有找到房间号为 ${classroom.roomNumber} 的教室（${classroom.building}）。`
          : `「${classroom.building} ${classroom.roomNumber}」匹配到多间教室，请指定具体教室。`,
      candidates: r.data,
    }
    machine.fire('ENTITY_UNRESOLVED', { payload: { candidates: r.data } })
  }

  // ── 事实收集（GATHERING）：F1 先行解析，其余命题依赖的事实随后；全部/部分不可得都进判定 ──
  async #doGathering({ machine, taskContext }) {
    const { facts, identity } = await this.judgment.collectFacts({
      intentId: taskContext.intentId,
      target: { classroom: taskContext.currentTarget, slot: taskContext.slot },
      identity: taskContext.identity,
    })
    taskContext.facts = facts
    // 判定层把发起身份解析成了带数字 id 的形态（Q1 写入者匹配要用）——回写任务上下文，
    // 否则 VERIFYING 里的"写入者=本人"比对会拿不到 userId
    taskContext.identity = identity
    // 以 F1 的解析结果充实当前目标（人读名、容量——降级基准与话术都要用）
    if (facts.F1?.value) {
      taskContext.currentTarget = { ...taskContext.currentTarget, ...facts.F1.value }
      taskContext.originalClassroom ??= { ...facts.F1.value }
    }
    const states = Object.values(facts).map((f) => f.state)
    const allObtained = states.every((s) => s === 'obtained')
    machine.fire(allObtained ? 'FACTS_READY' : 'FACT_UNAVAILABLE', { payload: { states } })
  }

  // ── 命题判定（VALIDATING）：判定层给结论集合，这里只按数据里的特例与优先级选事件 ──
  async #doValidating({ machine, taskContext }) {
    const judgment = this.judgment.judge({
      intentId: taskContext.intentId,
      target: { classroom: taskContext.currentTarget, slot: taskContext.slot },
      identity: taskContext.identity,
      facts: taskContext.facts,
    })
    taskContext.judgment = judgment
    const s = judgment.summary
    const decide = (eventName, ids, message) =>
      this.#decide(taskContext, {
        phase: 'P2',
        action: `decide:${eventName}`,
        input: { ids },
        basis: ids.map((id) => ({ proposition: id })),
        conclusion: { outcome: eventName, summary: message ?? '' },
      })

    // 只读意图：判定给出答案即完成（含"被占/检修"的如实答复），CHECK_ONLY → DONE
    if (taskContext.intent.readOnly) {
      const answer = this.#queryAnswer(judgment)
      decide('CHECK_ONLY', [...s.satisfied, ...s.violated.map((v) => v.id), ...s.unconfirmable.map((u) => u.id)], answer)
      taskContext.outcome = { message: answer }
      machine.fire('CHECK_ONLY')
      return
    }
    // C6 幂等命中：事件与终态由命题数据声明（violatedEvent: ALREADY_DONE）
    if (s.alreadyDone) {
      const hit = judgment.results.find((r) => r.alreadyDone)
      decide('ALREADY_DONE', [hit.id], hit.message)
      taskContext.outcome = { message: hit.message, exempt: [] }
      machine.fire('ALREADY_DONE', { payload: { recordId: hit.matched?.recordId } })
      return
    }
    // 保守拒绝优先于降级：事实不齐不得靠换方案绕过（第 08 章 §八）
    const blocking = s.unconfirmable.filter((u) => u.disposition !== 'exempt-continue')
    if (blocking.length > 0) {
      const message = this.#joinMessages(judgment, blocking.map((u) => u.id))
      decide('PROPOSITIONS_UNCONFIRMED', blocking.map((u) => u.id), message)
      taskContext.outcome = { message }
      machine.fire('PROPOSITIONS_UNCONFIRMED', { payload: { ids: blocking.map((u) => u.id) } })
      return
    }
    const nonDegradable = s.violated.filter((v) => !v.degradable)
    if (nonDegradable.length > 0) {
      const message = this.#joinMessages(judgment, nonDegradable.map((v) => v.id))
      decide('PROPOSITIONS_FAILED', nonDegradable.map((v) => v.id), message)
      taskContext.outcome = { message }
      machine.fire('PROPOSITIONS_FAILED', { payload: { ids: nonDegradable.map((v) => v.id) } })
      return
    }
    if (s.violated.length > 0) {
      const message = this.#joinMessages(judgment, s.violated.map((v) => v.id))
      decide('DEGRADABLE_CONFLICT', s.violated.map((v) => v.id), message)
      taskContext.outcome = { message }
      machine.fire('DEGRADABLE_CONFLICT', { payload: { ids: s.violated.map((v) => v.id) } })
      return
    }
    // C17：豁免继续经 PROPOSITIONS_OK 的豁免载荷进入提交（不新增 SUBMITTING 入边）
    decide('PROPOSITIONS_OK', [...s.satisfied], s.exemptContinue.length > 0 ? '全部命题成立（含 C17 豁免继续）' : '全部命题成立')
    taskContext.outcome = { exempt: s.exemptContinue }
    machine.fire('PROPOSITIONS_OK', { payload: { exempt: s.exemptContinue } })
  }

  // ── 提交（SUBMITTING）：唯一副作用出口。两种目的走同一处理器，接口来自意图计划 ──
  async #doSubmitting({ machine, taskContext }) {
    if (machine.purpose === 'forward') {
      const submitStep = (taskContext.intent.steps ?? []).find((s) => s.role === 'submit')
      if (!submitStep) throw new OrchestrationError(`意图 ${taskContext.intentId} 缺少 role=submit 的步骤`)
      const r = await this.gateway.call(submitStep.interface, {
        classroomId: taskContext.currentTarget.classroomId,
        start: taskContext.slot.start,
        end: taskContext.slot.end,
        ...(taskContext.reason ? { reason: taskContext.reason } : {}),
      }, { phase: 'P3' })
      taskContext.lastCall = r
      if (r.verdict === 'SUCCESS') {
        const recordId = r.data?.recordId ?? null
        taskContext.compensations.push({
          recordId,
          interfaceId: submitStep.interface,
          identityId: taskContext.identity.id,
          label: `${taskContext.currentTarget.building ?? ''} ${taskContext.currentTarget.roomNumber ?? ''}`.trim() || `教室 ${taskContext.currentTarget.classroomId}`,
          slotText: describeRange(taskContext.slot.start, taskContext.slot.end, this.store.getConstants().time),
          evidenceRef: r.evidenceRef,
          revoked: false,
        })
        machine.fire('CALL_SUCCESS', { payload: recordId })
        return
      }
      this.#fireCallOutcome(machine, r)
      return
    }
    // 补偿撤销：撤销动作来自意图计划的 compensation 声明
    const item = taskContext.currentCompensation
    const r = await this.gateway.call(
      taskContext.intent.compensation.action,
      { recordId: item.recordId },
      { initiatorIdentity: item.identityId, phase: 'P5' },
    )
    taskContext.lastCall = r
    this.#fireCallOutcome(machine, r, { recordId: item.recordId })
  }

  // ── 结果定性（JUDGING）：接触层已完成三值判定，这里按目的映射终局事件 ──
  #doJudging({ machine, taskContext }) {
    const r = taskContext.lastCall
    if (machine.purpose === 'forward') {
      if (r.verdict === 'SUCCESS') {
        const item = taskContext.compensations[taskContext.compensations.length - 1]
        taskContext.outcome = { message: `已为您办妥：${item?.label ?? ''}（预约 #${item?.recordId}，${item?.slotText ?? ''}）${taskContext.outcome?.exempt?.length ? '（未能确认是否重复）' : ''}`, recordId: item?.recordId }
        machine.fire('JUDGE_SUCCESS')
      } else {
        taskContext.outcome = { message: `提交未成功（${r.reasonCode}），未产生副作用。` }
        machine.fire('JUDGE_FAILURE')
      }
      return
    }
    // 补偿目的：成功 → 处理清单下一项；失败 → 副作用未收敛，落 UNRESOLVED（不得落 FAILED 抹平）
    if (r.verdict === 'SUCCESS') {
      machine.fire('JUDGE_SUCCESS')
      return
    }
    taskContext.outcome = { message: `撤销预约 #${taskContext.currentCompensation?.recordId} 未成功（${r.reasonCode}），副作用未收敛，需人工介入。` }
    machine.fire('JUDGE_FAILURE')
  }

  // ── 查证（VERIFYING）：UNKNOWN 的唯一去向；重试上限按目的分别计数（§七）──
  async #doVerifying({ machine, taskContext }) {
    const constants = this.store.getConstants()
    if (machine.purpose === 'forward') {
      if (taskContext.counters.forwardVerify >= constants.verification.forwardAttempts) {
        taskContext.outcome = { message: '多次查证仍无法确认提交结果，需人工核实是否已生效。' }
        machine.fire('VERIFY_LIMIT')
        return
      }
      taskContext.counters.forwardVerify += 1
      const v = await this.verifier.verifyForward({
        intent: taskContext.intent,
        target: { classroom: taskContext.currentTarget, slot: taskContext.slot },
        identity: taskContext.identity,
      })
      this.#decide(taskContext, {
        phase: 'P4',
        action: 'decide:verify-forward',
        input: { attempt: taskContext.counters.forwardVerify },
        basis: v.basis,
        conclusion: { outcome: v.outcome, summary: v.summary },
      })
      if (v.outcome === 'FOUND_MINE') {
        taskContext.outcome = { message: `已为您办妥：此事此前已办成（预约 #${v.matched?.recordId}），未重复提交。`, recordId: v.matched?.recordId }
        machine.fire('VERIFY_FOUND', { payload: 'mine' })
      } else if (v.outcome === 'FOUND_OTHERS') {
        taskContext.outcome = { message: '该教室在这段时间已被预约。' }
        machine.fire('VERIFY_FOUND', { payload: 'others' })
      } else if (v.outcome === 'NOT_FOUND') {
        machine.fire('VERIFY_NOT_FOUND', { payload: { attempt: taskContext.counters.forwardVerify } }) // 唯一回到副作用的边=重试
      } else {
        taskContext.outcome = { message: `查证未能收敛：${v.summary}。需人工核实。` }
        machine.fire('VERIFY_INCONCLUSIVE')
      }
      return
    }
    // 补偿查证：按 recordId 定位；重试撤销上限 1 次（D8），超限不再重试
    if (taskContext.counters.compensateVerify >= constants.verification.compensateRetries) {
      taskContext.outcome = { message: '撤销结果无法确认（查证次数已达上限），需人工核实。' }
      machine.fire('VERIFY_LIMIT')
      return
    }
    taskContext.counters.compensateVerify += 1
    const v = await this.verifier.verifyCompensate({ intent: taskContext.intent, recordId: taskContext.currentCompensation?.recordId })
    this.#decide(taskContext, {
      phase: 'P5',
      action: 'decide:verify-compensate',
      input: { attempt: taskContext.counters.compensateVerify, recordId: taskContext.currentCompensation?.recordId },
      basis: v.basis ?? [{ fact: 'F4' }],
      conclusion: { outcome: v.outcome, summary: v.summary },
    })
    if (v.outcome === 'FOUND') {
      machine.fire('VERIFY_FOUND', { payload: { revoked: true } }) // 撤销已生效 → 处理清单下一项
    } else if (v.outcome === 'NOT_FOUND') {
      machine.fire('VERIFY_NOT_FOUND', { payload: { attempt: taskContext.counters.compensateVerify } })
    } else {
      taskContext.outcome = { message: `撤销查证未能收敛：${v.summary}。需人工介入。` }
      machine.fire('VERIFY_INCONCLUSIVE')
    }
  }

  // ── 降级（DEGRADING）：原教室即基准（同楼栋、不降容量），每轮一个候选、事实从零重取（J6）──
  async #doDegrading({ machine, taskContext }) {
    const constants = this.store.getConstants()
    const tried = taskContext.triedCandidates
    const base = taskContext.originalClassroom ?? taskContext.currentTarget
    const note = { tried: [...tried] }
    if (taskContext.degradeRounds >= constants.limits.degradeRounds) {
      taskContext.outcome = { message: this.#degradeExhaustedMessage(base, tried), note }
      machine.fire('DEGRADE_EXHAUSTED')
      return
    }
    const r = await this.gateway.call(taskContext.intent.degrade.candidatesFrom, {
      building: base.building,
      minCapacity: base.capacity ?? 0,
    }, { phase: 'P5' })
    if (r.verdict !== 'SUCCESS') {
      taskContext.outcome = { message: `候选教室暂不可查询（${r.reasonCode}），无法继续换教室。已尝试：${this.#triedText(tried) || '无'}。`, note }
      machine.fire('DEGRADE_EXHAUSTED')
      return
    }
    const limit = constants.degrade.candidateLimit
    const candidates = (r.data ?? [])
      .filter((c) => c.classroomId !== base.classroomId && (c.capacity ?? 0) >= (base.capacity ?? 0) && !tried.includes(c.classroomId))
      .sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))
      .slice(0, limit)
    if (candidates.length === 0) {
      taskContext.outcome = { message: `该时段同楼栋满足容量（≥ ${base.capacity ?? 0} 座）的候选已逐项核验。已尝试：${this.#triedText(tried) || '无其他候选'}。`, note }
      machine.fire('DEGRADE_EXHAUSTED')
      return
    }
    const next = candidates[0]
    tried.push(next.classroomId)
    taskContext.degradeRounds += 1
    taskContext.currentTarget = {
      classroomId: next.classroomId,
      building: next.building,
      roomNumber: next.roomNumber,
      capacity: next.capacity,
    }
    this.#decide(taskContext, {
      phase: 'P5',
      action: 'decide:degrade',
      input: { round: taskContext.degradeRounds, to: next.classroomId, tried: [...tried] },
      basis: [{ fact: 'F1' }],
      conclusion: { outcome: 'DEGRADE_ACCEPTED', summary: `第 ${taskContext.degradeRounds} 轮换教室 → ${next.building} ${next.roomNumber}（${next.capacity ?? '?'} 座）` },
    })
    // 换了教室，事实与全部前置命题必须从零重来（§5.4 注一：降级不等于跳过校验）
    machine.fire('DEGRADE_ACCEPTED', { payload: next.classroomId })
  }

  // ── 补偿（COMPENSATING）：清单逆序逐项；处理完落 FAILED（失败但已收敛，I6）──
  async #doCompensating({ machine, taskContext }) {
    if (taskContext.currentCompensation) {
      taskContext.currentCompensation.revoked = true // 到达本状态 = 上一项撤销已收敛
      taskContext.currentCompensation = null
    }
    const pending = [...taskContext.compensations].reverse().filter((c) => !c.revoked)
    if (pending.length === 0) {
      taskContext.outcome = { message: '已完成回滚。' }
      machine.fire('COMPENSATION_DONE')
      return
    }
    taskContext.currentCompensation = pending[0]
    this.#decide(taskContext, {
      phase: 'P5',
      action: 'decide:compensate',
      input: { recordId: pending[0].recordId, label: pending[0].label, remaining: pending.length },
      basis: pending[0].evidenceRef ? [{ evidence: pending[0].evidenceRef.seq }] : [{ spec: 'intent-plans.yaml#compensation' }],
      conclusion: { outcome: 'COMPENSATION_READY', summary: `回滚已生效副作用：预约 #${pending[0].recordId}（${pending[0].label}）` },
    })
    machine.fire('COMPENSATION_READY', { payload: taskContext.currentCompensation.recordId })
  }

  // ── 私有工具 ──────────────────────────────────────────────────────────────

  // 关键决策留痕（I4/P6）：判定结论→事件、查证结论、降级选择、补偿选择都要能被复述。
  // 任务终态条目会引用最后一条决策（evidence: seq），形成可回溯的链条。
  #decide(taskContext, { action, input, basis, conclusion, phase }) {
    const entry = this.evidenceChain?.record({ action, input, basis, conclusion, phase })
    if (entry) taskContext.lastDecisionSeq = entry.seq
  }

  #fireCallOutcome(machine, r, { recordId } = {}) {
    if (r.verdict === 'FAILURE') machine.fire('CALL_FAILURE', { payload: { reasonCode: r.reasonCode, recordId } })
    else machine.fire(r.ambiguous ? 'CALL_CONFLICT' : 'CALL_UNKNOWN', { payload: { reasonCode: r.reasonCode, recordId } })
  }

  #joinMessages(judgment, ids) {
    return ids
      .map((id) => judgment.results.find((r) => r.id === id)?.message)
      .filter(Boolean)
      .join(' ')
  }

  #queryAnswer(judgment) {
    const violated = judgment.summary.violated.map((v) => v.id)
    if (violated.length > 0) return `该时段不可用：${this.#joinMessages(judgment, violated)}`
    const blocking = judgment.summary.unconfirmable.map((u) => u.id)
    if (blocking.length > 0) return `暂时无法确认：${this.#joinMessages(judgment, blocking)}`
    return '该教室在这个时段可以使用。'
  }

  #triedText(tried) {
    return tried.join('、')
  }

  #degradeExhaustedMessage(base, tried) {
    return `已尝试 ${tried.length} 个候选（${this.#triedText(tried) || '无'}），均未通过校验或不可用。该时段同楼栋满足容量（≥ ${base.capacity ?? 0} 座）的候选已核验。`
  }
}
