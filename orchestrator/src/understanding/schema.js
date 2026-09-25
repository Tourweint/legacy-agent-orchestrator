// 输出契约校验 —— 第 03 章 §四（字段表 + 三条格式纪律）。
//
// 这是理解层输出的唯一准入点：
//   · intent 必须属于已登记闭集（闸门一在 schema 层的执行）
//   · slots 值必须是原话片段——出现 ISO 形态的日期/时间即拒绝（验收③：模型输出 ISO 时间
//     被契约校验拒绝。理由：那是模型"自己算出来的值"，算错时不报错，是本项目明令禁止的
//     不报错错误源）
//   · 字段缺失/类型错 → 违规清单（供格式重试回灌给模型，§5.4）

import { UnderstandingError } from './understanding-error.js'

// 模型自己"算出"的时间形态（ISO 日期、ISO 时刻、HH:mm 时钟）。中文原话（"下周三""下午两点"）不受影响
const COMPUTED_TIME_PATTERNS = [
  [/\d{4}-\d{2}-\d{2}/, 'ISO 日期'],
  [/\d{4}\/\d{1,2}\/\d{1,2}/, '斜杠日期'],
  [/\b\d{1,2}:\d{2}\b/, '时钟时刻'],
]

function violationsFor(value, path, violations, intentIds) {
  if (path === 'intent') {
    if (typeof value !== 'string' || !value) {
      violations.push('intent 缺失或不是字符串')
      return
    }
    if (!intentIds.includes(value)) {
      violations.push(`intent "${value}" 不在已登记的意图闭集内（不允许"最接近的意图"兜底）`)
    }
    return
  }
  if (path === 'confidence') {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
      violations.push('confidence 必须是 0 到 1 的数字')
    }
    return
  }
  if (path === 'outOfDomain') {
    if (typeof value !== 'boolean') violations.push('outOfDomain 必须是布尔值')
    return
  }
  if (path === 'slots') {
    if (value === null || value === undefined) return // slots 允许为空（表示为缺）
    if (typeof value !== 'object' || Array.isArray(value)) {
      violations.push('slots 必须是对象')
      return
    }
    for (const [key, slotValue] of Object.entries(value)) {
      if (typeof slotValue !== 'string') {
        violations.push(`slots.${key} 必须是原话片段字符串`)
        continue
      }
      for (const [pattern, label] of COMPUTED_TIME_PATTERNS) {
        if (pattern.test(slotValue)) {
          violations.push(`slots.${key} 出现了${label}形态（"${slotValue}"）——槽位必须存用户原话片段，禁止输出换算后的时间`)
        }
      }
    }
    return
  }
  // missing / clarifyQuestion / reasoning：类型宽松（missing 会被闸门三重新机械计算，不采信）
}

/**
 * 校验理解层输出。
 * @param {string} rawText            LLM 原始文本（容忍 ```json 围栏）
 * @param {string[]} intentIds        意图闭集
 * @returns {{ok: true, value: object} | {ok: false, violations: string[], parsed: object|null}}
 */
export function validateUnderstandingOutput(rawText, intentIds) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, violations: ['输出为空'], parsed: null }
  }
  const stripped = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  let parsed
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return { ok: false, violations: ['输出不是合法 JSON（只能输出一个 JSON 对象，不要有其他文字）'], parsed: null }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, violations: ['输出必须是 JSON 对象'], parsed: null }
  }
  const violations = []
  for (const field of ['slots', 'confidence', 'outOfDomain']) {
    if (!(field in parsed)) {
      violations.push(`缺少字段 ${field}`)
      continue
    }
    violationsFor(parsed[field], field, violations, intentIds)
  }
  // 超域输出没有意图（示例即 intent: null）——仅非超域时校验闭集归属
  if (parsed.outOfDomain !== true) {
    if (!('intent' in parsed)) {
      violations.push('缺少字段 intent')
    } else {
      violationsFor(parsed.intent, 'intent', violations, intentIds)
    }
  }
  if (violations.length > 0) return { ok: false, violations, parsed }
  return {
    ok: true,
    value: {
      intent: parsed.intent ?? null,
      slots: parsed.slots ?? {},
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
      confidence: parsed.confidence,
      outOfDomain: parsed.outOfDomain,
      clarifyQuestion: typeof parsed.clarifyQuestion === 'string' ? parsed.clarifyQuestion : '',
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    },
  }
}

export { UnderstandingError }
