/**
 * LLM 调用与解析 —— 带 Schema 校验的重试。
 *
 * 设计依据：docs/基线文档/智能体设计.md §7.3 推论 1
 *   「LLM 输出必须过 Schema 校验，字段缺失或类型不符一律拒绝该次输出，重试解析。」
 *
 * 重试策略与网关重试的区别（很重要）：
 *   网关重试是"认证过期"，重试**同一个副作用**，只允许一次；
 *   这里重试的是"解析"，**没有任何副作用**，且可以把校验错误回填给模型让它自我修正。
 *   → 前者危险，后者安全。所以两者必须分开实现，不能共用一套重试逻辑。
 */

import config from '../common/config.js';
import { IntentError } from '../common/errors.js';
import { INTENT_OUTPUT_SCHEMA, validateSchema } from './schema.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';

/** 从可能夹带 markdown 的文本中抽出 JSON */
function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 单次调用大模型 */
async function callModel(messages) {
  if (!config.llm.apiKey) {
    throw new IntentError('未配置大模型 API Key（环境变量 DASHSCOPE_API_KEY）');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.llm.timeoutMs);
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        temperature: 0,               // 解析任务不需要创造性，温度压到 0 换取稳定性
        response_format: { type: 'json_object' },
        max_tokens: 512,
      }),
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new IntentError(`大模型调用失败（HTTP ${res.status}）：${body?.error?.message || body?.message || '未知错误'}`);
    }
    return body?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析用户输入为结构化意图。
 *
 * @param {string} utterance 用户原话
 * @param {object} history   已确认的槽位上下文
 * @param {import('../common/trace.js').Trace} trace
 * @returns {Promise<{intent: string, slots: object, confidence: number, reason: string, attempts: number}>}
 */
export async function parse(utterance, history = {}, trace = null) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(utterance, history) },
  ];

  let lastErrors = [];
  const maxAttempts = Math.max(1, config.llm.maxParseAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const raw = await callModel(messages);
    const parsed = extractJson(raw);

    if (!parsed) {
      lastErrors = ['输出不是合法 JSON'];
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: '上一个输出不是合法 JSON。请只输出一个 JSON 对象，不要任何其他文字。' });
      if (trace) trace.llmRaw({ prompt: messages[1].content, raw, parsed: null, accepted: false, reason: lastErrors.join(';') });
      continue;
    }

    const check = validateSchema(parsed, INTENT_OUTPUT_SCHEMA);
    if (!check.ok) {
      lastErrors = check.errors;
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `上一个输出不符合格式要求，问题如下：\n${check.errors.join('\n')}\n请修正后重新只输出 JSON。`,
      });
      if (trace) trace.llmRaw({ prompt: messages[1].content, raw, parsed, accepted: false, reason: lastErrors.join(';') });
      continue;
    }

    if (trace) trace.llmRaw({ prompt: messages[1].content, raw, parsed, accepted: true, reason: '通过 Schema 校验' });
    return {
      intent: parsed.intent,
      slots: parsed.slots ?? {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reason: parsed.reason ?? '',
      attempts: attempt,
    };
  }

  if (trace) {
    trace.step({
      stage: 'P1_UNDERSTAND',
      action: `解析用户输入（重试 ${maxAttempts} 次）`,
      evidence: { errors: lastErrors },
      conclusion: 'LLM 输出始终未通过 Schema 校验，终止解析',
    });
  }
  throw new IntentError(`无法解析用户输入（已重试 ${maxAttempts} 次）：${lastErrors.join('；')}`, { errors: lastErrors });
}
