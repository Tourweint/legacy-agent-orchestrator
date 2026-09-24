/**
 * LLM 输出契约与校验 —— 隔离非确定性的第一道闸门。
 *
 * 设计依据：docs/基线文档/智能体设计.md §7.3
 *   「LLM 输出必须过 Schema 校验，字段缺失或类型不符一律拒绝该次输出，重试解析。」
 *
 * 为什么这一层必须存在：
 *   LLM 是本系统唯一的非确定性来源。如果它的输出能不经校验直接进入执行链，
 *   那么"可复现、可解释"就全部失效（不变量 I3/I4）。
 *   把校验做成**声明式**的额外好处是：新增意图只改 schema，不改校验代码。
 */

/** 本系统支持的结构化输出契约（JSON Schema 子集） */
export const INTENT_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['intent', 'slots', 'confidence'],
  additionalProperties: true,
  properties: {
    /** 意图 ID，必须是注册表里已登记的意图之一，或 'UNKNOWN'（无法归入任何业务） */
    intent: { type: 'string', pattern: '^[a-z][a-z0-9.]*$|^UNKNOWN$' },
    /** 槽位：值是用户原话里的原始表述（如"数智楼222""周三"），不做解释，解释交给状态机 */
    slots: { type: 'object' },
    /** 置信度 0~1；低于阈值应触发澄清追问而非直接执行 */
    confidence: { type: 'number', min: 0, max: 1 },
    /** 若无法确定意图，说明原因（用于向用户提示可支持的业务） */
    reason: { type: 'string' },
  },
});

/**
 * 极简 JSON Schema 子集校验器（零依赖）。
 * 支持：type / required / properties / enum / pattern / min / max / items
 * 不支持：$ref / oneOf / anyOf / allOf / dependencies —— 刻意不做，避免校验器本身成为复杂度来源。
 *
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSchema(value, schema, path = '$') {
  const errors = [];

  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: [`${path}: 期望 object，实际 ${typeName(value)}`] };
    }
    for (const k of schema.required ?? []) {
      if (value[k] === undefined) errors.push(`${path}.${k}: 必填字段缺失`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (value[k] !== undefined) {
        const r = validateSchema(value[k], sub, `${path}.${k}`);
        errors.push(...r.errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in (schema.properties ?? {}))) errors.push(`${path}.${k}: 不允许的额外字段`);
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return { ok: false, errors: [`${path}: 期望 array，实际 ${typeName(value)}`] };
    }
    if (schema.items) {
      value.forEach((v, i) => {
        const r = validateSchema(v, schema.items, `${path}[${i}]`);
        errors.push(...r.errors);
      });
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return { ok: false, errors: [`${path}: 期望 string，实际 ${typeName(value)}`] };
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: 取值必须在 ${schema.enum.join('|')} 内，实际 "${value}"`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: 不匹配模式 ${schema.pattern}`);
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return { ok: false, errors: [`${path}: 期望 number，实际 ${typeName(value)}`] };
    }
    if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: 期望整数`);
    if (schema.min !== undefined && value < schema.min) errors.push(`${path}: 不得小于 ${schema.min}`);
    if (schema.max !== undefined && value > schema.max) errors.push(`${path}: 不得大于 ${schema.max}`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: 期望 boolean，实际 ${typeName(value)}`);
  }

  if (schema.enum && schema.type !== 'string' && !schema.enum.includes(value)) {
    errors.push(`${path}: 取值必须在 ${JSON.stringify(schema.enum)} 内`);
  }

  return { ok: errors.length === 0, errors };
}

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** 置信度阈值：低于该值不执行，转为澄清追问 */
export const CONFIDENCE_THRESHOLD = 0.55;
