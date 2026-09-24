/**
 * 提示词构造 —— 从接口注册表生成，不硬编码。
 *
 * 设计依据：docs/基线文档/智能体设计.md §7.3
 *   「LLM 无权决定调用哪个接口」→ 提示词里只给它**意图清单与槽位说明**，
 *     绝不告诉它任何接口地址、HTTP 方法或参数结构。
 *
 * 这条纪律的作用是双向的：
 *   1. LLM 即使"想"越权也没有信息可用；
 *   2. 提示词随注册表自动同步 —— 新增意图只改 plans.js，提示词自动带上。
 */

import { INTENTS } from '../registry/plans.js';

/** 意图清单（只有 ID、名称、说明、槽位，没有接口信息） */
function renderIntents() {
  return INTENTS.map((it) => {
    const slots = it.slots
      .map((s) => `    - ${s.key}（${s.label}${s.required ? '，必填' : '，可选'}）：${s.hint}`)
      .join('\n');
    return `- ${it.id}｜${it.label}：${it.description}\n  槽位：\n${slots}`;
  }).join('\n\n');
}

export const SYSTEM_PROMPT = `你是一个校园事务系统的意图解析器。

你的唯一职责是：把用户的一句自然语言，解析成"意图 + 槽位"的结构化 JSON。

严格遵守以下规则：

1. **你只做理解，不做执行**。你不决定调用任何接口，不判断业务可行性，不给出操作建议。
2. **槽位值原样保留用户说法**。用户说"数智楼222"，你就输出"数智楼222"，不要翻译、不要推测 ID、不要补全。
3. **没说的不要编**。用户没说哪一周，就不要假设"下周三"；不确定的槽位直接不输出该键。
   缺失的槽位由后续流程负责追问，不归你处理。
4. **无法归入下列意图时**，intent 输出 "UNKNOWN"，并在 reason 里简述原因。
5. 只输出 JSON，不要任何解释文字、不要 markdown 代码块。

可识别的意图清单：

${renderIntents()}

输出格式：
{
  "intent": "意图ID 或 UNKNOWN",
  "slots": { "槽位名": "用户原话中的原始表述" },
  "confidence": 0.0~1.0,
  "reason": "仅当 intent 为 UNKNOWN 时说明原因"
}`;

/**
 * 构造用户消息。
 * @param {string} utterance 用户原话
 * @param {object} [history] 多轮上下文（已确认的槽位），用于补全
 */
export function buildUserMessage(utterance, history = {}) {
  if (!history || Object.keys(history).length === 0) return utterance;
  return `【已知上下文（此前已确认的槽位，可据此补全，但不得覆盖本轮新说法）】\n`
    + `${JSON.stringify(history, null, 2)}\n\n【用户本轮输入】\n${utterance}`;
}

/**
 * 追问话术（槽位缺失时使用）。
 * 由状态机调用，不由 LLM 生成 —— 追问必须确定、可测。
 */
export function askForSlots(missingKeys, intentLabel) {
  const it = INTENTS.find((i) => i.label === intentLabel);
  const desc = missingKeys.map((k) => {
    const s = it?.slots.find((x) => x.key === k);
    return s ? `${s.label}（${s.hint}）` : k;
  });
  return `您想办理「${intentLabel}」，还需要补充：${desc.join('、')}。`;
}
