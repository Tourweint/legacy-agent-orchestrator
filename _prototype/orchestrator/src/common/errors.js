/**
 * 统一错误类型。
 *
 * 分层约定：
 *   - OrchesError 及其子类 = 编排层自身的错误（可被前端友好呈现）
 *   - 底层抛出的原生 Error  = 未被预期的错误（应被网关/状态机捕获后转译为上述类型）
 */

export class OrchesError extends Error {
  constructor(message, { code = 'ORCHES_ERROR', detail = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.detail = detail;
  }
}

/** 意图无法识别 / 超出业务范围（对应命题 P1） */
export class IntentError extends OrchesError {
  constructor(message, detail) {
    super(message, { code: 'INTENT_UNRESOLVED', detail });
  }
}

/** 槽位缺失，需要向用户追问（对应命题 P1） */
export class SlotMissingError extends OrchesError {
  constructor(missing, detail) {
    super(`缺少必要信息：${missing.join('、')}`, { code: 'SLOT_MISSING', detail: { missing } });
    this.missing = missing;
  }
}

/** 前置条件不满足，请求被拦截（对应命题 P2 / 不变量 I1） */
export class PreconditionError extends OrchesError {
  constructor(proposition, message, detail) {
    super(message, { code: 'PRECONDITION_FAILED', detail: { proposition, ...detail } });
    this.proposition = proposition;
  }
}

/** 无可用身份（对应命题 P3 / 不变量 I5） */
export class IdentityError extends OrchesError {
  constructor(message, detail) {
    super(message, { code: 'IDENTITY_UNAVAILABLE', detail });
  }
}

/** 结果无法收敛：查证后仍无法判定（对应命题 P4 / 不变量 I3） */
export class UnresolvedOutcomeError extends OrchesError {
  constructor(interfaceId, detail) {
    super(`调用结果无法收敛：${interfaceId}`, { code: 'OUTCOME_UNRESOLVED', detail: { interfaceId, ...detail } });
  }
}

/** 补偿失败（对应命题 P5 / 不变量 I6）—— 不视为异常，必须显式上报 */
export class CompensationError extends OrchesError {
  constructor(interfaceId, message, detail) {
    super(message, { code: 'COMPENSATION_FAILED', detail: { interfaceId, ...detail } });
  }
}
