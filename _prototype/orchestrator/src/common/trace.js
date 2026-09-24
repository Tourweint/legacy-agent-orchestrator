/**
 * 执行轨迹（Trace）—— 可解释性的载体。
 *
 * 设计依据：docs/基线文档/智能体设计.md 不变量 I4
 *   「系统必须能回答：为什么做了这一步 / 为什么拒绝 / 依据什么事实」
 *
 * 记录纪律（与基线文档 §7.3 一致）：
 *   1. 每一步都必须记录「依据」—— 无依据的步骤视为设计缺陷，不允许出现；
 *   2. LLM 的原始输出**单独留档**（llmRaw），不进入证据链，
 *      因为它非确定性、不可作为判定依据；
 *   3. 轨迹只追加，不修改。任何"事后修正轨迹"的行为都是伪造证据。
 */

/** 命题阶段，与 智能体设计.md §六 的 P1–P6 一一对应 */
export const Stage = Object.freeze({
  P1_UNDERSTAND: 'P1_UNDERSTAND', // 理解意图、识别槽位缺口
  P2_DECIDE: 'P2_DECIDE',         // 聚合事实、校验前置命题
  P3_INVOKE: 'P3_INVOKE',         // 选择身份、适配协议、发起调用
  P4_JUDGE: 'P4_JUDGE',           // 判定结果（三值），收敛不确定态
  P5_RECOVER: 'P5_RECOVER',       // 补偿与恢复
  P6_EVIDENCE: 'P6_EVIDENCE',     // 结论与证据汇总
});

export class Trace {
  #steps = [];
  #llmRaw = [];
  #startedAt = Date.now();

  /**
   * 记录一步。
   * @param {object} p
   * @param {string} p.stage    命题阶段
   * @param {string} p.action   做了什么（动宾短语，如"查询教室时段占用"）
   * @param {object} p.evidence 依据（接口返回、校验结论等）—— 必填，可为空对象但不可省略
   * @param {string} p.conclusion 得出什么结论
   */
  step({ stage, action, evidence = null, conclusion = '' }) {
    if (evidence === undefined) {
      throw new Error('trace.step 必须提供 evidence 字段（可为 null，但不可省略）');
    }
    this.#steps.push({
      seq: this.#steps.length + 1,
      stage,
      action,
      evidence,
      conclusion,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - this.#startedAt,
    });
    return this;
  }

  /** LLM 原始输出单独留档（不进入证据链） */
  llmRaw({ prompt, raw, parsed, accepted, reason }) {
    this.#llmRaw.push({ at: new Date().toISOString(), prompt, raw, parsed, accepted, reason });
    return this;
  }

  get steps() {
    return [...this.#steps];
  }

  get llmRawLog() {
    return [...this.#llmRaw];
  }

  /** 面向用户的执行轨迹（前端展示 + 答辩演示用） */
  toView() {
    return this.#steps.map((s) => ({
      seq: s.seq,
      stage: s.stage,
      action: s.action,
      conclusion: s.conclusion,
      elapsedMs: s.elapsedMs,
    }));
  }

  /** 完整留档（含证据与 LLM 原始输出） */
  toArchive() {
    return {
      startedAt: new Date(this.#startedAt).toISOString(),
      totalMs: Date.now() - this.#startedAt,
      steps: this.steps,
      llmRaw: this.llmRawLog,
    };
  }
}
