/**
 * 调用结果的三值语义 —— 整个编排层的支点。
 *
 * 设计依据：docs/基线文档/智能体设计.md 不变量 I3
 *   「每次调用结束后，系统必须能给出唯一确定的结论：成功 / 失败 / 不确定；
 *     不确定必须被继续收敛，不得悬空。」
 *
 * 为什么必须是三值而不是两值：
 *   存量系统实测存在「服务端已写库、响应在返回途中丢失」的场景。
 *   两态语义下这种情况只能被猜成"失败"，进而触发重试 → 重复记录（破坏 I2）；
 *   或者被猜成"成功" → 用户被误报（破坏 I3）。
 *   三值语义承认"不知道"，并强制把它导向查证流程。
 */

/** 三值枚举（冻结，防止运行时被改写） */
export const Verdict = Object.freeze({
  /** 确定成功：已拿到权威证据表明副作用已生效 */
  SUCCESS: 'SUCCESS',
  /** 确定失败：已拿到权威证据表明副作用未生效 */
  FAILURE: 'FAILURE',
  /** 不确定：调用已发出，但无法判定副作用是否生效 —— 必须查证 */
  UNKNOWN: 'UNKNOWN',
});

/**
 * 构造一次调用的结果。
 * 所有网关调用必须返回本结构，禁止返回裸响应体 —— 裸响应体会诱使上层去看 HTTP 状态码，
 * 而存量系统的业务错误全部是 HTTP 200（见 智能体设计.md §2.2 S6）。
 *
 * @param {object} p
 * @param {string} p.verdict     三值之一
 * @param {string} p.interfaceId 接口注册表 ID
 * @param {number|null} p.httpStatus HTTP 状态码（仅作留痕，不作判定依据）
 * @param {string|null} p.bizCode    业务码（存量系统 body.code）
 * @param {any} p.data               业务数据（成功时有意义）
 * @param {string} p.reason          判定理由（人类可读，进证据链）
 * @param {number} p.elapsedMs       耗时
 */
export function outcome({ verdict, interfaceId, httpStatus = null, bizCode = null, data = null, reason = '', elapsedMs = 0 }) {
  if (!Object.values(Verdict).includes(verdict)) {
    throw new Error(`非法 verdict: ${verdict}`);
  }
  return Object.freeze({ verdict, interfaceId, httpStatus, bizCode, data, reason, elapsedMs });
}

/** 便捷判断 */
export const isSuccess = (o) => o.verdict === Verdict.SUCCESS;
export const isFailure = (o) => o.verdict === Verdict.FAILURE;
export const isUnknown = (o) => o.verdict === Verdict.UNKNOWN;
