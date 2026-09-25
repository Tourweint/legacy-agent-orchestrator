// 证据层 —— 第 13 章阶段 0 交付物 6（I4 可解释的落点，P6）
//
// 契约（第 13 章 阶段 0 证据层）：
//   ① 每个有后果的动作必须携带依据引用，缺失即报错 —— record() 的 basis 必填非空
//   ② 证据链可独立导出，且不含任何凭证 —— 写入时即净化（redact.js），导出天然干净
//   ③ 分两档：结构化结果（进证据链）与模型原始输出（单独留档，不进证据链）
// 禁止：把模型原始输出写进证据链；记录凭证；让证据链只写不读（getEntries 供界面消费）。
//
// 验收口径（第 13 章 §六）：任取一次拒绝，能答出"依据哪条事实、哪条命题、什么时刻"——
// entry.basis[].fact / entry.basis[].proposition / entry.at 三个字段直接回答。

import { makeRedactor } from './redact.js'

export class EvidenceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EvidenceError'
  }
}

export class EvidenceChain {
  /**
   * @param {object} options
   * @param {string} options.taskId       任务标识（证据链按任务组织，多次运行共享编号）
   * @param {() => Date} [options.now]    时钟注入（测试可复现；默认取当前时刻）
   * @param {object} [options.evidenceConstants] constants.yaml 的 evidence 节
   */
  constructor({ taskId, now = () => new Date(), evidenceConstants } = {}) {
    if (!taskId) throw new EvidenceError('证据链必须绑定 taskId')
    this.taskId = taskId
    this.now = now
    this.redactor = makeRedactor(evidenceConstants)
    this.#seq = 0
    this.#entries = []
    this.#modelOutputs = []
  }

  #seq
  #entries
  #modelOutputs
  #listeners = new Set()

  /**
   * 追加监听（阶段 4：事件流"边执行边推送"的管线）。每落一条证据，监听器立即收到该条目。
   * 监听器不得修改条目、不得抛错影响任务执行（由调用方保证）。
   */
  onAppend(fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /**
   * 记录一条结构化结果（进证据链）。有后果的动作必须携带依据，缺失即报错（契约①）。
   *
   * @param {object} entry
   * @param {string} entry.action     动作名（如 "verify-slot" / "reject-task" / "submit-reservation"）
   * @param {*}      [entry.input]    动作输入（写入时净化）
   * @param {Array<{fact?: string, proposition?: string, rule?: string, detail?: string}>} entry.basis
   *                                   依据引用：哪条事实（F#）、哪条命题（P-#）、哪条判定规则行
   *                                   （W#/R#，阶段 1 起接触层判定依据），或补充说明
   * @param {{outcome: string, summary: string}} entry.conclusion
   *                                   结论：唯一确定的 outcome + 面向用户/证据的一句话
   * @param {*}      [entry.metadata] 附加档位（如协议级信号与已清洗的原始响应片段）；
   *                                   仅随证据条目留档，不参与判定（阶段 1 增补）
   * @param {string} [entry.phase]    轨迹阶段标记（P1–P6，与第 10 章 §6.3 事件流同源；
   *                                   阶段 4 增补——界面想看的信息补在证据链上，§6.1）
   */
  record({ action, input, basis, conclusion, metadata, phase }) {
    if (!action) throw new EvidenceError('证据条目缺 action')
    if (!Array.isArray(basis) || basis.length === 0) {
      // 为什么强制：I4——"为什么做了这一步"必须永远可回答；没有依据的动作不允许发生
      throw new EvidenceError(`动作 "${action}" 缺依据引用（basis 不得为空，I4）`)
    }
    for (const ref of basis) {
      if (!ref || typeof ref !== 'object' || (!ref.fact && !ref.proposition && !ref.rule && ref.evidence === undefined && !ref.spec)) {
        throw new EvidenceError(`动作 "${action}" 的依据引用必须指向事实（F#）、命题（P-#）、判定规则行（W#/R#）、另一条证据条目（evidence: seq）或设计规格（spec: 文件#节）`)
      }
      if (ref.rule && !/^[WR]\d{1,2}$/.test(ref.rule)) {
        throw new EvidenceError(`动作 "${action}" 的规则行号格式非法: ${ref.rule}（C15：W/R + 稳定编号）`)
      }
      if (ref.evidence !== undefined && (!Number.isInteger(ref.evidence) || ref.evidence < 1)) {
        throw new EvidenceError(`动作 "${action}" 的证据条目引用非法: ${ref.evidence}`)
      }
      if (ref.spec && !/^[\w.\-#§]+$/.test(ref.spec)) {
        throw new EvidenceError(`动作 "${action}" 的规格引用非法: ${ref.spec}`)
      }
    }
    if (!conclusion || !conclusion.outcome) {
      throw new EvidenceError(`动作 "${action}" 缺唯一确定的结论（conclusion.outcome，I3）`)
    }
    this.#seq += 1
    const entry = {
      seq: this.#seq,
      taskId: this.taskId,
      at: this.now().toISOString(), // 时刻：绝对时刻记录，展示层再转本地（第 06 章 §6.3）
      action,
      input: this.redactor.redact(input ?? null),
      basis: this.redactor.redact(basis),
      conclusion: this.redactor.redact(conclusion),
      ...(metadata !== undefined ? { metadata: this.redactor.redact(metadata) } : {}),
      ...(phase ? { phase } : {}),
    }
    this.#entries.push(entry)
    for (const fn of this.#listeners) {
      try {
        fn(entry)
      } catch {
        // 监听器异常不阻断任务执行（推送是展示管线，不是流程的一部分）
      }
    }
    return entry
  }

  /**
   * 模型原始输出单独留档（契约③）。它不进证据链——非确定性输出不能作为依据
   * （第 02 章 P6 / 第 03 章 §一：同一输入重跑可能得到不同措辞）。
   */
  recordModelOutput(raw, meta = {}) {
    this.#modelOutputs.push({
      taskId: this.taskId,
      at: this.now().toISOString(),
      meta,
      raw: this.redactor.redact(raw),
    })
  }

  /** 只写不读是被禁止的（禁止项③）：界面/复核方从这里消费（第 10 章 §6.1 同源要求）。 */
  getEntries() {
    return [...this.#entries]
  }

  getModelOutputs() {
    return [...this.#modelOutputs]
  }

  /**
   * 独立导出（契约②）。写入时已净化，这里不再携带任何原始凭证；
   * modelOutputs 附带导出但保持"档位分离"，消费方不得把它当依据。
   */
  exportChain() {
    return {
      taskId: this.taskId,
      exportedAt: this.now().toISOString(),
      entryCount: this.#entries.length,
      entries: this.getEntries(),
      modelOutputs: this.getModelOutputs(),
    }
  }
}
