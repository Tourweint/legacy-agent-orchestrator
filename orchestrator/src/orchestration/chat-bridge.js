// 聊天桥 —— 理解层与状态机的接线（第 03 章三道闸门 + 第 04 章 UNDERSTANDING/AWAIT_CLARIFY 态）。
//
// 闸门一（意图闭集）在 schema 校验层已执行；这里执行：
//   闸门二：置信度不达标 → 列出候选意图让用户选（不是"请再说一遍"）
//   闸门三：槽位缺口 = 必填槽位 − slots 已提供键，机械计算，**不采信模型给的 missing**
// 追问（§8.1）：必填缺失 → 问；归一化规则外表达 → 问（不静默丢弃）；追问轮次 ≤3（§8.2）。
// 归一化（§7.1/§7.3）在这里试算：成功也带"请确认"注记；失败（规则外）→ 问，不猜。
//
// 模型原始输出已由理解引擎单独留档（不进证据链）；这里落链的是**结构化决策**（P1 段）。

import { parseClassroomName } from '../canonical/classroom-name.js'
import { resolveRelativeRange, checkLegacyTimeConstraints } from '../canonical/time.js'
import { authorizeIntent, roleLabel } from './intent-authorizer.js'

export class ChatBridge {
  constructor({ configStore, understandingEngine, evidenceChain = null }) {
    this.store = configStore
    this.understanding = understandingEngine
    this.evidenceChain = evidenceChain
  }

  /** UNDERSTANDING 态处理器（chat 运行专用）。 */
  async handleUnderstanding({ machine, taskContext }) {
    const turn = taskContext.chat.pendingTurn
    let understanding
    try {
      understanding = await this.understanding.understand({
        text: turn.text,
        history: taskContext.chat.history,
      })
    } catch (err) {
      if (err.kind === 'rate-limited') {
        // 限流/配额：不重试，降级为"按钮式选择"（决策 E7）——给出意图候选，绕过模型
        this.#clarify(machine, taskContext, {
          kind: 'intent-choice',
          question: `理解服务暂时不可用，请直接选择要办的事：${this.store.intentList.map((i) => `「${i.name}」`).join('、')}`,
          candidates: this.store.intentList.map((i) => ({ id: i.id, name: i.name })),
        })
        return
      }
      // 格式重试耗尽 / 网络失败：如实上报，不编造意图（§5.4/§九）
      taskContext.outcome = { message: `无法理解该请求：${err.message}` }
      machine.fire('UNDERSTAND_FAILED')
      return
    }

    const intentIds = this.store.intentList.map((i) => i.id)
    void intentIds
    // P1 决策留痕：依据 = 意图计划闭集（模型原始输出不在证据链——非确定性不作依据）
    this.#decide(taskContext, {
      action: `decide:understand`,
      input: { status: understanding.status, confidence: understanding.confidence },
      basis: [{ spec: 'intent-plans.yaml' }],
      conclusion: {
        outcome: understanding.status === 'ok' ? 'INTENT_RESOLVED' : understanding.status.toUpperCase(),
        summary:
          understanding.status === 'ok'
            ? this.#understandSummary(understanding)
            : understanding.clarifyQuestion ?? understanding.reasoning ?? understanding.status,
      },
    })

    if (understanding.status === 'out-of-domain') {
      taskContext.outcome = {
        message: '这件事超出了我能代办的范围（我可以帮忙查询与预约校园教室），恕不能办理。',
      }
      machine.fire('OUT_OF_DOMAIN')
      return
    }
    if (understanding.status === 'clarify') {
      // 闸门二：低置信 → 候选意图让用户选（E5）
      this.#clarify(machine, taskContext, {
        kind: 'intent-choice',
        question: understanding.clarifyQuestion,
        candidates: understanding.candidates,
      })
      return
    }

    // 闸门三：缺口机械计算（不采信模型的 missing）
    taskContext.slots = { ...taskContext.slots, ...understanding.slots }
    const intent = this.store.getIntent(understanding.intent)
    taskContext.intent = intent
    taskContext.intentId = intent.id

    // 闸门四（本次新增）：按角色判权限——**在任何调用之前**（决定 5 / I5）。
    // 放在槽位追问之前：权限不对时不该先去问"哪间教室"——那是多余且误导的交互。
    const denial = authorizeIntent({ intent, identity: taskContext.identity })
    if (denial) {
      taskContext.outcome = { message: denial.message }
      this.#decide(taskContext, {
        action: 'decide:intent-forbidden',
        initiator: taskContext.identity?.id ?? null,
        actingIdentity: '本人身份',
        input: {
          intentId: intent.id,
          requiredRole: roleLabel(denial.required),
          actualRole: roleLabel(denial.actual),
          callsMade: 0,
        },
        basis: [{ spec: 'login-permission-plan#decision-5' }],
        conclusion: { outcome: 'INTENT_FORBIDDEN', summary: denial.message },
      })
      machine.fire('INTENT_FORBIDDEN') // UNDERSTANDING → REJECTED（未发出任何调用）
      return
    }
    const missing = (intent.slots?.required ?? []).filter(
      (key) => taskContext.slots[key] === undefined || taskContext.slots[key] === '',
    )
    if (missing.length > 0) {
      this.#clarify(machine, taskContext, {
        kind: 'missing-slots',
        missing,
        question: understanding.clarifyQuestion || this.#missingQuestion(missing),
      })
      return
    }

    // C7：目标不是教室的意图（"我订了哪些教室"/"把周三那间退了"）不做教室名与时段归一化。
    // 理由：这类意图的目标是"我自己的记录"，说教室/日期只是**可选的定位提示**——
    // 强制归一化会把"什么都不用说也能办"变成"必须说清楚才行"。
    const requiredSlots = intent.slots?.required ?? []
    const needsClassroom = requiredSlots.includes('classroomName')
    const needsTime = requiredSlots.some((s) => ['datePhrase', 'timeSegment'].includes(s))
    if (!needsClassroom && !needsTime) {
      taskContext.chat.resources = [{ classroom: {} }]
      taskContext.slot = null
      taskContext.currentTarget = {}
      // 已识别到的原话槽位留在 taskContext.slots，供记录定位（run-engine #filterMyReservations）使用
      machine.fire('INTENT_RESOLVED', { payload: intent.id })
      return
    }
    if (!needsClassroom) {
      // C8 改期：只需要解析**目标时段**——目标教室来自"我的预约"里定位到的那条记录，
      // 不能拿空教室名去解析（那会把"改到周四下午"变成"解析教室失败"）。
      let range
      try {
        range = resolveRelativeRange(
          { datePhrase: taskContext.slots.datePhrase, segmentName: taskContext.slots.timeSegment },
          new Date(),
          this.store.getConstants().time,
        )
      } catch {
        this.#clarify(machine, taskContext, {
          kind: 'unparseable-slot',
          question: `「${taskContext.slots.datePhrase ?? ''} ${taskContext.slots.timeSegment ?? ''}」我没看懂要改到什么时候——请换个说法（例如：周四下午）。`,
        })
        return
      }
      const check = checkLegacyTimeConstraints(range, new Date(), this.store.getConstants().time)
      if (!check.ok) {
        this.#clarify(machine, taskContext, {
          kind: 'unparseable-slot',
          question: `${check.violations.join('；')}。您想改到哪个时段？`,
        })
        return
      }
      taskContext.chat.resources = [{ classroom: {} }]
      taskContext.slot = range
      taskContext.currentTarget = {}
      taskContext.confirmNotes = range.explanations // §7.3：推算结果必须展示并标注"请确认"
      machine.fire('INTENT_RESOLVED', { payload: intent.id })
      return
    }

    // 归一化试算（规则集外 → 追问；可行域违反 → 追问；两者都不猜）
    let normalized
    try {
      normalized = this.#normalizeSlots(taskContext.slots)
    } catch (err) {
      this.#clarify(machine, taskContext, {
        kind: 'unparseable-slot',
        question: err.userMessage,
      })
      return
    }
    taskContext.chat.resources = normalized.resources
    taskContext.slot = normalized.slot
    taskContext.confirmNotes = normalized.explanations // §7.3：推算结果必须展示并标注"请确认"
    taskContext.currentTarget = { ...normalized.resources[0].classroom }
    machine.fire('INTENT_RESOLVED', { payload: intent.id })
  }

  /** AWAIT_CLARIFY 恢复：记录回复、重进理解（§5.5：追问后重问理解层，而非拼接片段）。 */
  beginResume({ taskContext, replyText }) {
    taskContext.chat.history.push({ role: 'assistant', content: taskContext.chat.clarify?.question ?? '' })
    taskContext.chat.history.push({ role: 'user', content: replyText })
    taskContext.chat.pendingTurn = { text: replyText }
  }

  #clarify(machine, taskContext, clarify) {
    const maxRounds = this.store.getConstants().limits.clarifyRounds
    if (taskContext.chat.clarifyRounds >= maxRounds) {
      // 追问轮次耗尽：终止并给出结构化说明（§8.2）。事件用 UNDERSTAND_FAILED——
      // CLARIFY_LIMIT 在表上只从 AWAIT_CLARIFY 出（用户在挂起中放弃），此处是理解阶段的失败
      taskContext.outcome = {
        message: `要办这件事，我还需要知道：${this.#outstandingSummary(taskContext, clarify)}。已追问 ${maxRounds} 轮，先到这里——请重新发起并一次说清。`,
      }
      machine.fire('UNDERSTAND_FAILED')
      return
    }
    taskContext.chat.clarifyRounds += 1
    taskContext.chat.clarify = clarify
    taskContext.chat.history.push({ role: 'assistant', content: clarify.question })
    this.#decide(taskContext, {
      phase: 'P1',
      action: `ask:clarify`,
      input: { kind: clarify.kind, round: taskContext.chat.clarifyRounds, missing: clarify.missing ?? [] },
      basis: [{ spec: 'intent-plans.yaml#slots' }],
      conclusion: { outcome: 'INPUT_REQUIRED', summary: clarify.question },
    })
    machine.fire('SLOTS_INCOMPLETE', { payload: { kind: clarify.kind } })
  }

  #normalizeSlots(slots) {
    const rooms = parseClassroomName(slots.classroomName)
    if (rooms.length === 0) {
      const err = new Error('classroomName 无法解析')
      err.userMessage = `「${slots.classroomName}」里我没找到教室号——请说明楼栋和房间号（例如：数智楼222）。`
      throw err
    }
    let range
    try {
      range = resolveRelativeRange(
        { datePhrase: slots.datePhrase, segmentName: slots.timeSegment },
        new Date(),
        this.store.getConstants().time,
      )
    } catch {
      const err = new Error('datePhrase/timeSegment 规则外表达')
      err.userMessage = `「${slots.datePhrase} ${slots.timeSegment}」我没看懂——请换个说法（例如：周三下午、明天上午八点到十点）。`
      throw err
    }
    const check = checkLegacyTimeConstraints(range, new Date(), this.store.getConstants().time)
    if (!check.ok) {
      // 可行域违反（过去/跨自然日/超窗口）：如实追问，让用户改约
      const err = new Error(check.violations.join('；'))
      err.userMessage = `${check.violations.join('；')}。您想改约哪个时段？`
      throw err
    }
    return {
      resources: rooms.map((r) => ({ classroom: { building: r.building, roomNumber: r.roomNumber } })),
      slot: { start: range.start, end: range.end },
      explanations: range.explanations,
    }
  }

  #missingQuestion(missing) {
    const hints = {
      classroomName: '哪间教室？',
      datePhrase: '哪一天？',
      timeSegment: '什么时段？',
    }
    return `要办这件事，我还需要知道：${missing.map((m) => hints[m] ?? m).join('，')}。`
  }

  #outstandingSummary(taskContext, clarify) {
    if (clarify.kind === 'intent-choice') return '您想办哪件事'
    if (clarify.missing?.length) return clarify.missing.join('、')
    return clarify.question ?? '补充信息'
  }

  /**
   * 理解结果的展示文案（零术语 P1-3）：用业务名（"借教室"）与中文槽位短名，
   * 不把 intentId（query-my-reservations）与英文键名（classroomName）甩到界面上。
   */
  #understandSummary(understanding) {
    const plan = (this.store.intentList ?? []).find((i) => i.id === understanding.intent)
    const labels = this.store.getGlossary().slots
    const parts = Object.entries(understanding.slots ?? {})
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${labels[key] ?? key}=${value}`)
    const name = plan?.name ?? understanding.intent
    return parts.length > 0 ? `识别为「${name}」；条件：${parts.join('、')}` : `识别为「${name}」`
  }

  #decide(taskContext, { action, input, basis, conclusion, phase = 'P1', initiator, actingIdentity }) {
    // initiator/actingIdentity：越权拒绝这类"没有调用但必须能回答是谁发起"的条目也要带上
    const entry = this.evidenceChain?.record({ phase, action, input, basis, conclusion, initiator, actingIdentity })
    if (entry) taskContext.lastDecisionSeq = entry.seq
  }
}
