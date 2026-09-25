// 理解引擎 —— 第 03 章（职责/三道闸门/格式重试/失败归宿）。
//
// 它是全系统唯一的非确定性入口（约束 C）：本模块之外的任何代码都不得调用 LLM。
// 输出契约（§四）：{ intent, slots（原话片段）, missing, confidence, outOfDomain, clarifyQuestion, reasoning }
// 三道闸门在这里执行：
//   一  intent 属于闭集（schema 校验层已拒；不允许"最接近的意图"兜底）
//   二  置信度达标 → 不达标返回 clarify（列出候选意图让用户选，不是"请再说一遍"）
//   三  槽位缺口由意图计划机械计算（必填槽位 − slots 已提供的键），**不采信模型给的 missing**
// 模型原始输出单独留档（调用方经 evidenceChain.recordModelOutput），绝不进证据链。

import { UnderstandingError } from './understanding-error.js'
import { validateUnderstandingOutput } from './schema.js'
import { buildSystemPrompt, fewShotExamples } from './prompt.js'

const FORMAT_RETRIES = 2 // 格式重试上限（§5.4：共 3 次调用）；网络超时重试同限
const NETWORK_RETRIES = 2

export class UnderstandingEngine {
  /**
   * @param {object} deps
   * @param {import('../config/config-store.js').ConfigStore} deps.configStore
   * @param {import('./llm-client.js').LlmClient} deps.llm
   * @param {object} [deps.evidenceChain] 模型原始输出留档（不进证据链主档）
   */
  constructor({ configStore, llm, evidenceChain = null }) {
    this.store = configStore
    this.llm = llm
    this.evidenceChain = evidenceChain
  }

  #intentContext() {
    const intents = this.store.intentList.map((it) => ({
      id: it.id,
      name: it.name,
      readOnly: it.readOnly === true,
      slots: it.slots,
      slotHints: it.slotHints ?? {},
    }))
    const threshold = this.store.getConstants().understanding?.confidenceThreshold ?? 0.55
    return { intents, intentIds: intents.map((i) => i.id), threshold }
  }

  #systemPrompt() {
    const { intents, threshold } = this.#intentContext()
    return buildSystemPrompt({
      intents,
      confidenceRule: `0 到 1；低于 ${threshold} 视为没有把握，系统会让用户选择意图`,
    })
  }

  /**
   * 理解一次用户输入。
   * @param {object} p
   * @param {string} p.text        用户原话（首次请求或追问的回复）
   * @param {Array}  [p.history]   对话历史 [{role, content}]（追问轮携带）
   * @returns {Promise<{status: 'ok'|'clarify', intent?, slots?, confidence, clarifyQuestion?, candidates?, reason?}>}
   *   status=clarify：置信度不达标（candidates=候选意图）——槽位缺口由编排层按计划机械计算后再判。
   * @throws {UnderstandingError} kind='rate-limited'（限流，交编排层降级）| 'unavailable'（格式重试耗尽/网络失败）
   */
  async understand({ text, history = [] }) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new UnderstandingError('理解层收到空输入')
    }
    const { intents, intentIds, threshold } = this.#intentContext()
    const system = this.#systemPrompt()

    let lastViolations = []
    // 格式重试：把"不合规的具体原因"回灌给模型（§5.4），不是原样重发
    for (let attempt = 0; attempt <= FORMAT_RETRIES; attempt += 1) {
      const messages = this.#messageList(text, history, attempt, lastViolations)
      let llmResult
      try {
        llmResult = await this.#completeWithNetworkRetry(system, messages)
      } catch (err) {
        // 模型原始输出留档（失败也留：调试需要）；留档不属于证据链主档
        this.#archiveModelOutput(text, { error: err.message }, attempt)
        throw err
      }
      const verdict = validateUnderstandingOutput(llmResult.text, intentIds)
      this.#archiveModelOutput(text, verdict.ok ? verdict.value : { violations: verdict.violations, raw: llmResult.text }, attempt)

      if (verdict.ok) {
        const value = verdict.value
        // 闸门二：置信度不达标 → 不猜，列出候选意图让用户选
        if (value.outOfDomain) {
          return { status: 'out-of-domain', confidence: value.confidence, reasoning: value.reasoning }
        }
        if (value.confidence < threshold) {
          return {
            status: 'clarify',
            reason: 'low-confidence',
            confidence: value.confidence,
            slots: value.slots,
            candidates: intents.map((i) => ({ id: i.id, name: i.name })),
            clarifyQuestion:
              value.clarifyQuestion ||
              `您是想${intents.map((i) => `「${i.name}」`).join('，还是')}？请选择或再说清楚一些。`,
          }
        }
        // 闸门三在编排层执行（缺口 = 必填槽位 − slots 键，不采信模型的 missing）
        return {
          status: 'ok',
          intent: value.intent,
          slots: value.slots,
          confidence: value.confidence,
          clarifyQuestion: value.clarifyQuestion,
        }
      }
      lastViolations = verdict.violations
    }
    // 格式重试耗尽：如实上报，不编造意图（§5.4 / §九）
    throw new UnderstandingError(`无法理解该请求（连续 ${FORMAT_RETRIES + 1} 次输出不合规：${lastViolations.join('；')}）`)
  }

  #userContent(text, attempt, violations) {
    if (attempt > 0 && violations.length > 0) {
      return `【纠正】你上一次的输出不合规，具体原因：\n- ${violations.join('\n- ')}\n请严格按输出格式重新输出。\n\n用户说：「${text.trim()}」\n请输出 JSON。`
    }
    return `用户说：「${text.trim()}」\n请输出 JSON。`
  }

  #messageList(text, history, attempt, violations) {
    return [
      ...fewShotExamples(),
      ...history,
      { role: 'user', content: this.#userContent(text, attempt, violations) },
    ]
  }

  async #completeWithNetworkRetry(system, messages) {
    let lastError
    for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt += 1) {
      try {
        // 理解层无副作用，网络失败可安全重试（§九：与写操作相反）
        return await this.llm.complete({ system, messages })
      } catch (err) {
        lastError = err
        if (err.kind === 'rate-limited') throw err // 限流不重试，交编排层降级（E7）
      }
    }
    throw lastError
  }

  #archiveModelOutput(userText, payload, attempt) {
    this.evidenceChain?.recordModelOutput(
      { userText, attempt, ...payload },
      { stage: 'understanding' },
    )
  }
}
