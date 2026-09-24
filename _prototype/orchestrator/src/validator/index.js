/**
 * 命题校验执行器 —— 命题 P2 的运行时。
 *
 * 一条纪律：**本层只判定，不调用、不修复**。
 * 校验失败即返回，由状态机决定是终止、追问还是降级重试。
 * 这样"能否办"与"怎么办"彻底分离，可分别测试。
 */

import { getProposition } from './propositions.js';
import { Trace, Stage } from '../common/trace.js';

/**
 * @param {string[]} propositionIds 待校验命题
 * @param {object} facts            已收集的事实集合
 * @param {object} ctx              上下文（classroomId / start / end / seatId 等）
 * @param {Trace} [trace]           执行轨迹（可选，传入则记录）
 * @returns {{ok: boolean, results: object[], failures: object[]}}
 */
export function validate(propositionIds, facts, ctx, trace = null) {
  const results = [];
  for (const id of propositionIds) {
    const p = getProposition(id);
    let r;
    try {
      r = p.evaluate(facts, ctx);
    } catch (e) {
      // 命题自身异常 → 保守判定为不通过（不得因评估异常而放行写入）
      r = { ok: false, reason: `命题评估异常：${e.message}`, evidence: null };
    }
    results.push({
      id,
      label: p.label,
      domain: p.domain,
      ok: !!r.ok,
      reason: r.reason,
      evidence: r.evidence ?? null,
    });
  }

  const failures = results.filter((r) => !r.ok);

  if (trace) {
    trace.step({
      stage: Stage.P2_DECIDE,
      action: `校验 ${propositionIds.length} 条前置命题`,
      evidence: results.map((r) => ({ id: r.id, ok: r.ok, evidence: r.evidence })),
      conclusion: failures.length === 0
        ? '全部前置命题成立，可以发起写操作'
        : `存在 ${failures.length} 条命题不成立：${failures.map((f) => f.id).join('、')}`,
    });
  }

  return { ok: failures.length === 0, results, failures };
}

/** 把失败命题整理成面向用户的解释（可解释性 I4 的对外形态） */
export function explainFailures(failures) {
  if (!failures.length) return '所有前置条件均满足。';
  return failures.map((f) => `✗ ${f.label}：${f.reason}`).join('\n');
}
