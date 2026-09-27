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

// 归一化失败时的追问附录：**列出系统真正支持的说法**。
// 只写"请换个说法"等于把猜测成本推给用户（体验问题，2026-09-26 反馈）。
/**
 * 追问话术里**不得出现**"业务结论/事实断言"（03 章 §九 禁忌 9）。
 * 为什么要有这道关卡：模型的话术是自由文本，契约校验管不到它——它可能在追问里说
 * "这间教室周三下午是空的"，凭空造出一个业务结论（结论只能来自事实与判定）。
 * 这是**关卡**不是解析：命中就不用它、改用编排层组装句（有兜底，所以宁可误判也不放过）。
 */
const BUSINESS_CLAIM_PATTERN =
  /(空的|空着|空闲|可用|不可用|被占|占用|有人用|没人用|冲突|可以借|不能借|已被?预订|已被?预约|维修|停用)/

const TIME_PHRASE_HINT =
  '日期可以说：今天、明天、后天、周三、下周三、10月1日；时间可以说：上午、下午、晚上，或者"14点到16点""下午两点到四点"。'

export class ChatBridge {
  constructor({ configStore, understandingEngine, evidenceChain = null }) {
    this.store = configStore
    this.understanding = understandingEngine
    this.evidenceChain = evidenceChain
  }

  /** UNDERSTANDING 态处理器（chat 运行专用）。 */
  async handleUnderstanding({ machine, taskContext }) {
    const turn = taskContext.chat.pendingTurn
    // 追问轮才可能有"上一轮已确定的意图"：判断来源（沿用/改口）与自相矛盾检测都以它为基准
    const priorIntentId = taskContext.intentId ?? taskContext.intent?.id ?? null
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

    // 本轮原话进历史（每轮恰一条）：追问轮的下一次理解必须看得到"上一轮用户说了什么"。
    // 此前历史里只有追问句、用户原话丢失，模型无从判断这次是在补什么（03 章 §8.4）
    taskContext.chat.history.push({ role: 'user', content: turn.text })

    const intentIds = this.store.intentList.map((i) => i.id)
    void intentIds

    if (understanding.status === 'out-of-domain') {
      // P1 决策留痕：依据 = 意图计划闭集（模型原始输出不在证据链——非确定性不作依据）
      this.#decideUnderstand(taskContext, understanding, null, priorIntentId)
      taskContext.outcome = {
        message: '这件事超出了我能代办的范围（我可以帮忙查询与预约校园教室），恕不能办理。',
      }
      machine.fire('OUT_OF_DOMAIN')
      return
    }
    if (understanding.status === 'clarify') {
      // 闸门二：低置信 → 候选意图让用户选（E5）
      this.#decideUnderstand(taskContext, understanding, null, priorIntentId)
      // 候选收窄：用模型"真正拿不准的那几个"（闭集内、≥2 个才用），否则回退全量（03 章 §8.5）
      const candidates = this.#narrowCandidates(understanding)
      this.#clarify(machine, taskContext, {
        kind: 'intent-choice',
        question: this.#intentChoiceQuestion(understanding, candidates),
        candidates,
      })
      return
    }

    // 闸门三：缺口机械计算（不采信模型的 missing）
    taskContext.slots = { ...taskContext.slots, ...understanding.slots }
    const intent = this.store.getIntent(understanding.intent)
    taskContext.intent = intent
    taskContext.intentId = intent.id

    // P1 决策留痕（带结构化载荷）：合并后的槽位才是"即将执行"的那份（跨追问轮累积），
    // 前端据此渲染"理解卡"（intentName/slots/confidence）
    this.#decideUnderstand(taskContext, understanding, taskContext.slots, priorIntentId)

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
        question: this.#missingSlotsQuestion(understanding, missing),
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
      } catch (err) {
        this.#clarify(machine, taskContext, {
          kind: 'unparseable-slot',
          question:
            err.kind === 'range-incomplete'
              ? `「${taskContext.slots.timeSegment}」只说了开始时间——您要改到几点到几点？（例如：14点到16点）`
              : `「${this.#phraseText(taskContext.slots.datePhrase, taskContext.slots.timeSegment)}」我没看懂要改到什么时候。${TIME_PHRASE_HINT}`,
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

  /**
   * AWAIT_CLARIFY 恢复：记录回复、重进理解（§5.5：追问后重问理解层，而非拼接片段）。
   *
   * ★ 追问轮的上下文由编排层供给（2026-09-27 判断外移 · 03 章 §8.4）：
   *   回复要重新走一遍理解层，此前历史里只有"追问句 + 回复"——模型看不到**已经确定到哪一步**，
   *   实测把"补时间槽位"的回复（"下午三点到四点"）判成了新意图「查询教室可用性」。
   *   现在把"已确定的意图 + 已收槽位 + 机械算出的缺口"以结构化摘要交回模型（与少样本同形）：
   *   **材料由系统保证齐备，沿用还是改口由模型判断**（`intentSource`），系统只校验与留痕。
   *   （追问句本身已由 #clarify 落进历史，这里不再重复推一遍。）
   */
  beginResume({ taskContext, replyText }) {
    const anchor = this.#anchor(taskContext)
    if (anchor) taskContext.chat.history.push({ role: 'assistant', content: JSON.stringify(anchor) })
    taskContext.chat.pendingTurn = { text: replyText }
  }

  /**
   * 追问轮的上下文锚点：把"已经确定到哪一步、还缺什么"整理成结构化摘要
   * （与提示词少样本里的助手摘要同形：intent / slots / missing）。
   * 还没有已确定的意图（例如上一轮是"让用户选意图"）时返回 null——那种情况历史里的追问句已够用。
   */
  #anchor(taskContext) {
    const intentId = taskContext.intentId ?? taskContext.intent?.id ?? null
    if (!intentId) return null
    const slots = { ...(taskContext.slots ?? {}) }
    const required = taskContext.intent?.slots?.required ?? []
    const missing = required.filter((key) => slots[key] === undefined || slots[key] === '')
    return {
      intent: intentId,
      intentName: (this.store.intentList ?? []).find((i) => i.id === intentId)?.name ?? intentId,
      slots,
      missing,
      outOfDomain: false,
    }
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

  /** 把用户原话里的日期/时间片段拼成一句可读的引用（避免出现 "undefined undefined"）。 */
  #phraseText(...parts) {
    return parts.filter((p) => typeof p === 'string' && p.trim()).join(' ') || '您说的时间'
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
    } catch (cause) {
      const err = new Error('datePhrase/timeSegment 规则外表达')
      err.kind = cause.kind
      err.userMessage =
        cause.kind === 'range-incomplete'
          ? `「${slots.timeSegment}」只说了开始时间——您要从几点用到几点？（例如：14点到16点）`
          : `「${this.#phraseText(slots.datePhrase, slots.timeSegment)}」我没听懂。${TIME_PHRASE_HINT}`
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

  /**
   * 缺槽位时的追问话术（03 章 §8.5：模型出素材，编排层组装）。三级链：
   *   ① 模型的话术——过了"不含业务结论"这一关就用它（自然语言更自然）；
   *   ② 组装句——机械缺口（判定权在系统）+ 模型给的原话例子（"比如「下午三点到四点」"）；
   *   ③ 静态话术——无模型路径（链路仍要能跑，03 章 §一）。
   */
  #missingSlotsQuestion(understanding, missing) {
    return (
      this.#usableQuestion(understanding?.clarifyQuestion) ||
      this.#missingQuestion(missing, understanding?.slotExamples ?? {})
    )
  }

  /**
   * 模型的话术能不能用？03 章 §九 禁忌 9：它的自由文本可能在追问里编造业务结论
   * （"这间教室周三下午是空的"）——那是事实性断言，模型没有依据。
   * 命中就**不用它**（换组装句），不去解析它、也不去改写它（改写等于长出第二份判断）。
   */
  #usableQuestion(text) {
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (!trimmed) return ''
    return BUSINESS_CLAIM_PATTERN.test(trimmed) ? '' : trimmed
  }

  /** 低置信追问的话术：同一条链——模型话术可用就用它，否则按**收窄后**的候选组装。 */
  #intentChoiceQuestion(understanding, candidates) {
    return (
      this.#usableQuestion(understanding?.clarifyQuestion) ||
      `您是想${candidates.map((c) => `「${c.name}」`).join('，还是')}？请选择或再说清楚一些。`
    )
  }

  /**
   * 候选收窄：模型"真正拿不准的"那几个（必须落在闭集内；**至少 2 个才采信**），
   * 否则回退"所有意图"——宁可多列几个，也不能只给一个把用户带偏（03 章 §8.5）。
   */
  #narrowCandidates(understanding) {
    const all = understanding?.candidates ?? []
    const picked = (understanding?.candidateIds ?? []).filter((id) => all.some((c) => c.id === id))
    if (picked.length < 2) return all
    return picked.map((id) => all.find((c) => c.id === id))
  }

  #missingQuestion(missing, slotExamples = {}) {
    const hints = {
      classroomName: '哪间教室？',
      datePhrase: '哪一天？',
      timeSegment: '什么时间（"下午"或"14点到16点"都行）？',
    }
    // 模型给了例子就附上（例子是原话形态，不替用户换算）——问句更具体，用户更容易答
    const withExample = (hint, example) => (example ? `${hint.replace(/？$/, '')}（比如「${example}」）？` : hint)
    const exampleOf = (key) => (typeof slotExamples[key] === 'string' ? slotExamples[key].trim() : '')
    return `要办这件事，我还需要知道：${missing
      .map((m) => withExample(hints[m] ?? m, exampleOf(m)))
      .join('，')}。`
  }

  #outstandingSummary(taskContext, clarify) {
    if (clarify.kind === 'intent-choice') return '您想办哪件事'
    if (clarify.missing?.length) return clarify.missing.join('、')
    return clarify.question ?? '补充信息'
  }

  /**
   * P1 理解决策留痕。mergedSlots 非空时带结构化载荷（intentName/slots/confidence），
   * 供前端渲染"理解卡"；clarify/out-of-domain 不带（追问/拒绝不走卡片）。
   *
   * priorIntentId：追问**之前**已确定的意图——用于给"沿用/改口"留痕（判断外移 · 2026-09-27）。
   * 意图在追问轮被换掉时，"为什么换了"必须答得上（I4）；模型自称沿用但意图确实变了也照实登记。
   */
  #decideUnderstand(taskContext, understanding, mergedSlots, priorIntentId = null) {
    const payload = this.#understandPayload(understanding, mergedSlots)
    const intentSource = understanding.intentSource ?? null
    const contradicted =
      understanding.status === 'ok' &&
      intentSource === 'resumed' &&
      priorIntentId !== null &&
      understanding.intent !== priorIntentId
    this.#decide(taskContext, {
      action: 'decide:understand',
      input: {
        status: understanding.status,
        confidence: understanding.confidence,
        ...(intentSource ? { intentSource } : {}),
        ...(priorIntentId ? { priorIntentId } : {}),
        ...(contradicted ? { intentSourceContradicted: true } : {}),
      },
      basis: [{ spec: 'intent-plans.yaml' }],
      conclusion: {
        outcome: understanding.status === 'ok' ? 'INTENT_RESOLVED' : understanding.status.toUpperCase(),
        summary: payload.text,
        ...(mergedSlots ? { structured: payload } : {}),
      },
    })
  }

  /**
   * 理解结果的人话与结构化载荷（同一份格式化逻辑：text 与 slots 同源同序，不另起第二套）。
   * 槽位来自**合并后**的 taskContext.slots（跨追问轮累积）——那才是"即将执行"的那份。
   * 零术语（P1-3）：用业务名（"借教室"）与中文槽位短名，不把 intentId 与英文键名甩到界面上。
   */
  #understandPayload(understanding, mergedSlots) {
    const plan = (this.store.intentList ?? []).find((i) => i.id === understanding.intent)
    const labels = this.store.getGlossary().slots
    const pairs = Object.entries(mergedSlots ?? {})
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => ({ key, label: labels[key] ?? key, value }))
    const name = plan?.name ?? understanding.intent
    const text =
      pairs.length > 0
        ? `识别为「${name}」；条件：${pairs.map((p) => `${p.label}=${p.value}`).join('、')}`
        : `识别为「${name}」`
    return {
      text,
      intentId: understanding.intent,
      intentName: name,
      slots: pairs,
      confidence: understanding.confidence,
    }
  }

  #decide(taskContext, { action, input, basis, conclusion, phase = 'P1', initiator, actingIdentity }) {
    // initiator/actingIdentity：越权拒绝这类"没有调用但必须能回答是谁发起"的条目也要带上
    const entry = this.evidenceChain?.record({ phase, action, input, basis, conclusion, initiator, actingIdentity })
    if (entry) taskContext.lastDecisionSeq = entry.seq
  }
}
