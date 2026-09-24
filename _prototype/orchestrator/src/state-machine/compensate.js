/**
 * 补偿执行 —— 命题 P5 的落地。
 *
 * 设计依据：docs/基线文档/智能体设计.md 不变量 I6
 *   「产生了副作用而任务未完成时，副作用必须被补偿或显式登记为不可补偿。」
 *
 * 两条与"乐观实现"不同的设计选择：
 *   1. **不假设补偿一定成功**。实测 `DELETE /reservations/{id}` 在记录已进入
 *      不可撤销状态时会失败。补偿失败不是异常，是必须被表达的正常结果。
 *   2. **不做分布式事务**。存量系统不可能配合 2PC，因此只能采用**编排式 Saga**：
 *      正向操作 + 显式补偿，且补偿动作由接口注册表声明，不由调用方硬编码。
 */

import { call } from '../gateway/client.js';
import { getInterface } from '../registry/interfaces.js';
import { CompensationError } from '../common/errors.js';
import { Verdict } from '../common/tristate.js';

/**
 * 为一次已生效的写入执行补偿。
 *
 * @param {object} p
 * @param {string} p.writtenInterfaceId 正向接口 ID
 * @param {object} p.writtenResult      正向调用的结果（含 reservationId 等）
 * @param {string} p.reason             为什么要补偿（进证据链）
 * @returns {Promise<{ok: boolean, detail: object, evidence: object}>}
 */
export async function compensate({ writtenInterfaceId, writtenResult, reason }) {
  const spec = getInterface(writtenInterfaceId);

  if (!spec.compensate) {
    // 注册表没声明补偿动作 → 显式登记为"不可补偿"，绝不静默
    return {
      ok: false,
      detail: { reason: `接口 ${writtenInterfaceId} 未声明补偿动作，副作用无法撤销`, uncompensable: true },
      evidence: { writtenInterfaceId, compensate: null, reason },
    };
  }

  const cSpec = getInterface(spec.compensate);
  const reservationId = extractReservationId(writtenResult);

  if (reservationId == null) {
    return {
      ok: false,
      detail: { reason: '无法从写入结果中提取记录 ID，补偿无法执行', uncompensable: true },
      evidence: { writtenInterfaceId, writtenResult: writtenResult?.data ?? null },
    };
  }

  const res = await call(spec.compensate, { pathParams: { reservationId } });

  if (res.verdict === Verdict.SUCCESS) {
    return {
      ok: true,
      detail: { reservationId, compensateInterface: spec.compensate },
      evidence: { compensateInterface: spec.compensate, verdict: res.verdict, reason, result: res.data ?? null },
    };
  }

  // 补偿失败：区分"不确定"与"确定失败"，但两者都必须上报
  const err = new CompensationError(spec.compensate,
    `补偿失败（${res.verdict}）：${res.reason}`,
    { reservationId, writtenInterfaceId, reason });

  return {
    ok: false,
    detail: {
      reason: `补偿失败：${res.reason}`,
      verdict: res.verdict,
      reservationId,
      /** ⚠️ 关键：补偿失败时系统处于"已写入且未撤销"的不可解释状态，必须人工介入 */
      requiresManualIntervention: true,
    },
    evidence: { compensateInterface: spec.compensate, verdict: res.verdict, error: err.message },
  };
}

/** 从写入结果里找出记录 ID（兼容多种字段命名 —— 存量系统命名并不统一） */
function extractReservationId(result) {
  const d = result?.data;
  if (d == null) return null;
  if (typeof d === 'number' || typeof d === 'string') return d;
  for (const k of ['id', 'reservationId', 'reservation_id', 'reservationID']) {
    if (d[k] != null) return d[k];
  }
  return null;
}

/** 供文档引用的补偿矩阵说明 */
export const COMPENSATION_MATRIX_NOTE =
  '补偿动作由接口注册表的 compensate 字段声明。既有的正向写入接口一旦新增，'
  + '必须在注册表中同时声明 verifyBy 与 compensate，否则启动自检会报错（见 registry/index.js selfCheck）。';
