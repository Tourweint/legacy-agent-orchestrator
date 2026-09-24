/**
 * 接口注册表门面。
 *
 * 对外只暴露两件事：
 *   1. 接口元信息（interfaces.js）—— 边界的事实来源
 *   2. 意图 → 任务链模板（plans.js）—— 确定性映射
 *
 * 启动时做一次自检：任何"有副作用但不可查证/不可补偿"的接口都必须被暴露出来，
 * 因为这类接口在异常发生时会让系统失去收敛能力（不变量 I3 / I6）。
 */

import { INTERFACES, getInterface, hasInterface, sideEffectInterfaces, auditRegistry, Role } from './interfaces.js';
import { INTENTS, getIntent, hasIntent, sideEffectSteps, allSlotKeys, StepKind } from './plans.js';

export {
  INTERFACES, getInterface, hasInterface, sideEffectInterfaces, Role,
  INTENTS, getIntent, hasIntent, sideEffectSteps, allSlotKeys, StepKind,
};

/**
 * 对注册表做一致性自检。
 * @returns {{ok: boolean, problems: string[]}}
 */
export function selfCheck() {
  const problems = [...auditRegistry()];

  // 检查 1：任务链引用的接口必须已登记
  for (const intent of INTENTS) {
    for (const step of intent.steps) {
      if (step.interfaceId && !hasInterface(step.interfaceId)) {
        problems.push(`意图 ${intent.id} 的步骤 ${step.id} 引用了未登记的接口 ${step.interfaceId}`);
      }
    }
  }

  // 检查 2：任务链依赖的命题必须有校验步骤兜住
  for (const intent of INTENTS) {
    const hasValidate = intent.steps.some((s) => s.kind === StepKind.VALIDATE);
    const hasInvoke = intent.steps.some((s) => s.kind === StepKind.INVOKE);
    if (hasInvoke && !hasValidate) {
      problems.push(`意图 ${intent.id} 含写操作但缺少 VALIDATE 步骤 —— 违反不变量 I1`);
    }
  }

  // 检查 3：只读意图不得含写步骤（这是"查询类请求不产生副作用"的硬保证）
  for (const intent of INTENTS) {
    const isReadOnly = intent.id.endsWith('.check') || intent.id.endsWith('.query');
    if (isReadOnly && sideEffectSteps(intent.id).length > 0) {
      problems.push(`意图 ${intent.id} 名称表明只读，却含写步骤`);
    }
  }

  return { ok: problems.length === 0, problems };
}
