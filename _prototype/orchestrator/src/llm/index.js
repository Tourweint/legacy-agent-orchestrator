/**
 * 命题 P1 门面：理解用户意图、识别槽位缺口。
 *
 * 设计依据：docs/基线文档/智能体设计.md 命题 P1
 *   「用户到底要办什么事？还缺什么信息？」
 *
 * 本层做三件事，且只做这三件：
 *   1. 调 LLM 拿结构化意图（parser）
 *   2. 用**注册表**校验意图是否已登记（LLM 可能编出一个不存在的意图名）
 *   3. 用**注册表**比对必填槽位，算出缺口（缺口判定不交给 LLM —— 必须确定、可测）
 *
 * 第 2、3 点是"LLM 只做理解"的关键体现：
 * LLM 说什么不算数，最终以注册表为准。
 */

import { parse } from './parser.js';
import { hasIntent, getIntent } from '../registry/plans.js';
import { CONFIDENCE_THRESHOLD } from './schema.js';
import { askForSlots } from './prompt.js';
import { IntentError } from '../common/errors.js';
import { Trace, Stage } from '../common/trace.js';

/**
 * @param {string} utterance
 * @param {object} history
 * @param {Trace} [trace]
 * @returns {Promise<{
 *   ok: boolean, intent: string|null, intentLabel: string|null,
 *   slots: object, missing: string[], confidence: number,
 *   clarification: string|null, reason: string
 * }>}
 */
export async function understand(utterance, history = {}, trace = null) {
  const t = trace ?? new Trace();
  const parsed = await parse(utterance, history, t);

  t.step({
    stage: Stage.P1_UNDERSTAND,
    action: 'LLM 解析用户输入',
    evidence: { intent: parsed.intent, slots: parsed.slots, confidence: parsed.confidence, attempts: parsed.attempts },
    conclusion: `识别意图 ${parsed.intent}（置信度 ${parsed.confidence}）`,
  });

  // ---- 闸门 1：意图必须已登记（以注册表为准，不以 LLM 为准） ----
  if (!hasIntent(parsed.intent)) {
    const msg = parsed.intent === 'UNKNOWN'
      ? (parsed.reason || '这句话不属于当前支持的业务范围。')
      : `识别到的意图「${parsed.intent}」未在系统中登记，已拒绝执行。`;
    t.step({
      stage: Stage.P1_UNDERSTAND,
      action: '校验意图是否已登记',
      evidence: { llmIntent: parsed.intent, registered: false },
      conclusion: `意图未登记，终止（${msg}）`,
    });
    return {
      ok: false, intent: null, intentLabel: null, slots: parsed.slots,
      missing: [], confidence: parsed.confidence, clarification: msg, reason: 'INTENT_NOT_REGISTERED',
    };
  }

  const spec = getIntent(parsed.intent);

  // ---- 闸门 2：置信度过低时不执行，转为澄清 ----
  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    t.step({
      stage: Stage.P1_UNDERSTAND,
      action: '校验置信度',
      evidence: { confidence: parsed.confidence, threshold: CONFIDENCE_THRESHOLD },
      conclusion: '置信度低于阈值，转为澄清追问（不执行）',
    });
    return {
      ok: false, intent: parsed.intent, intentLabel: spec.label, slots: parsed.slots,
      missing: [], confidence: parsed.confidence,
      clarification: `我不太确定您的意思。您是想办理「${spec.label}」吗？请补充说明。`,
      reason: 'LOW_CONFIDENCE',
    };
  }

  // ---- 闸门 3：必填槽位缺口（由注册表计算，不由 LLM 声明） ----
  const missing = spec.slots
    .filter((s) => s.required && (parsed.slots[s.key] === undefined || parsed.slots[s.key] === null || parsed.slots[s.key] === ''))
    .map((s) => s.key);

  t.step({
    stage: Stage.P1_UNDERSTAND,
    action: '比对注册表必填槽位',
    evidence: { required: spec.slots.filter((s) => s.required).map((s) => s.key), got: Object.keys(parsed.slots), missing },
    conclusion: missing.length === 0 ? '槽位完整，可以进入判定阶段' : `缺少槽位：${missing.join('、')}`,
  });

  if (missing.length > 0) {
    return {
      ok: false, intent: parsed.intent, intentLabel: spec.label, slots: parsed.slots,
      missing, confidence: parsed.confidence,
      clarification: askForSlots(missing, spec.label), reason: 'SLOT_MISSING',
    };
  }

  return {
    ok: true, intent: parsed.intent, intentLabel: spec.label, slots: parsed.slots,
    missing: [], confidence: parsed.confidence, clarification: null, reason: 'OK',
  };
}

export { parse };
export * from './prompt.js';
export * from './schema.js';
