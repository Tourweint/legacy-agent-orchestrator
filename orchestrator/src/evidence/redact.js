// 凭证剔除与片段截断 —— 证据层契约的一部分（第 13 章 阶段 0 交付物 6 禁止项 ②：
// 证据链不得记录凭证；C16：原始响应片段保留前若干字符，且先剔除凭证字段再截断）。

const DEFAULT_PATTERNS = ['token', 'authorization', 'password', 'secret', 'credential']
const DEFAULT_MAX_LENGTH = 500

function matchesSensitiveKey(key, patterns) {
  const lower = String(key).toLowerCase()
  return patterns.some((p) => lower.includes(p))
}

function truncate(text, maxLength) {
  if (typeof text !== 'string' || text.length <= maxLength) return text
  return text.slice(0, maxLength) + `…(截断，原始长度 ${text.length})`
}

/**
 * 深拷贝并净化：命中凭证字段名的值替换为占位符；超长字符串按上限截断。
 * 数组/普通对象递归；Date 等非普通对象原样保留。
 */
export function redactDeep(value, { patterns = DEFAULT_PATTERNS, maxLength = DEFAULT_MAX_LENGTH } = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, { patterns, maxLength }))
  }
  if (value instanceof Date) return value
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (matchesSensitiveKey(key, patterns)) {
        out[key] = '[已剔除凭证字段]'
      } else {
        out[key] = redactDeep(val, { patterns, maxLength })
      }
    }
    return out
  }
  return truncate(value, maxLength)
}

/** 从常量集合（constants.yaml 的 evidence 节）构造净化器；缺省时用规格值兜底。 */
export function makeRedactor(evidenceConstants) {
  const patterns = evidenceConstants?.redactFieldPatterns?.length
    ? evidenceConstants.redactFieldPatterns
    : DEFAULT_PATTERNS
  const maxLength = evidenceConstants?.rawFragmentMaxLength ?? DEFAULT_MAX_LENGTH
  return {
    redact: (value) => redactDeep(value, { patterns, maxLength }),
  }
}

// 原始响应文本里的凭证形态：键值对形态（"token":"…"）与 JWT 形态（eyJ… 三段式）
const SECRET_TEXT_PATTERNS = [
  [/"(token|access[_-]?token|refresh[_-]?token|authorization|password|secret)"\s*:\s*"[^"]*"/gi, '"$1":"[已剔除]"'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT已剔除]'],
]

/**
 * 对"原始响应片段"这类文本做凭证清洗（第 05 章 §八：evidence 不得包含凭证）。
 * 结构化对象走 redactDeep（按键名剔除）；文本片段里的凭证值只能靠形态匹配剔除。
 */
export function scrubTextSecrets(text) {
  if (typeof text !== 'string') return text
  let out = text
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}
