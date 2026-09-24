/**
 * 状态定义与转移表 —— 显式的、可审查的、可测试的。
 *
 * 设计依据：docs/基线文档/智能体设计.md §七
 *   「状态机负责决策与执行；LLM 只负责理解。」
 *
 * 为什么用表驱动而不是 if-else 链：
 *   1. **可枚举**：任一时刻系统处于什么状态、能接受什么事件、会走向哪里，全部列在下表；
 *   2. **可测试**：转移表是纯数据，可以断言"不存在通往 SUBMITTING 的旁路"；
 *   3. **可解释**：每次转移都进 trace，构成证据链；
 *   4. **可演示**：这张表就是答辩时展示的那张状态图，代码与图同源。
 *
 * ⚠️ 纪律：**任何写操作只能从 SUBMITTING 状态发出**。
 *    这条约束把"副作用"收敛到单点，是可验证性（尤其混沌测试）的前提。
 */

/** 状态枚举 */
export const State = Object.freeze({
  IDLE: 'IDLE',
  UNDERSTANDING: 'UNDERSTANDING',   // P1：解析意图与槽位
  AWAIT_CLARIFY: 'AWAIT_CLARIFY',   // 挂起：等待用户补充信息
  RESOLVING: 'RESOLVING',           // 把人类可读的教室名解析成系统标识
  GATHERING: 'GATHERING',           // 收集判定所需事实（可跨权限域）
  VALIDATING: 'VALIDATING',         // P2：校验前置命题
  REJECTED: 'REJECTED',             // 终态：命题不成立，可解释地拒绝
  SUBMITTING: 'SUBMITTING',         // P3：发起写操作（**唯一的副作用出口**）
  JUDGING: 'JUDGING',               // P4：判定调用结果（三值）
  VERIFYING: 'VERIFYING',           // P4：收敛不确定态（业务键查证）
  DEGRADING: 'DEGRADING',           // 降级：目标不可用时尝试替代教室
  COMPENSATING: 'COMPENSATING',     // P5：补偿已产生的副作用
  DONE: 'DONE',                     // 终态：完成
  FAILED: 'FAILED',                 // 终态：失败（原因明确）
  UNRESOLVED: 'UNRESOLVED',         // 终态：无法收敛，需人工介入（**必须显式出现，不得静默**）
});

/** 事件枚举 */
export const Event = Object.freeze({
  PARSE_OK: 'PARSE_OK',
  PARSE_INCOMPLETE: 'PARSE_INCOMPLETE',
  RESOLVE_OK: 'RESOLVE_OK',
  RESOLVE_FAIL: 'RESOLVE_FAIL',
  FACTS_READY: 'FACTS_READY',
  FACT_UNAVAILABLE: 'FACT_UNAVAILABLE',
  PROPOSITIONS_OK: 'PROPOSITIONS_OK',
  PROPOSITIONS_FAIL: 'PROPOSITIONS_FAIL',
  CHECK_ONLY: 'CHECK_ONLY',
  DEGRADE_AVAILABLE: 'DEGRADE_AVAILABLE',
  DEGRADE_EXHAUSTED: 'DEGRADE_EXHAUSTED',
  CALL_SETTLED: 'CALL_SETTLED',
  CALL_UNKNOWN: 'CALL_UNKNOWN',
  CALL_CONFLICT: 'CALL_CONFLICT',
  JUDGE_SUCCESS: 'JUDGE_SUCCESS',
  JUDGE_FAILURE: 'JUDGE_FAILURE',
  VERIFY_FOUND: 'VERIFY_FOUND',
  VERIFY_NOT_FOUND: 'VERIFY_NOT_FOUND',
  VERIFY_INCONCLUSIVE: 'VERIFY_INCONCLUSIVE',
  NEED_COMPENSATE: 'NEED_COMPENSATE',
  COMPENSATION_DONE: 'COMPENSATION_DONE',
  COMPENSATION_FAILED: 'COMPENSATION_FAILED',
});

/**
 * 转移表：from → { event → to }
 * guard 字段是文字说明，写明该转移成立的**判断依据**（服务于可解释性 I4）。
 */
export const TRANSITIONS = Object.freeze({
  [State.IDLE]: {
    [Event.PARSE_OK]: { to: State.RESOLVING, guard: 'LLM 输出通过 Schema 校验、意图已登记、必填槽位齐全、置信度达标' },
    [Event.PARSE_INCOMPLETE]: { to: State.AWAIT_CLARIFY, guard: '槽位缺失 / 意图未登记 / 置信度低于阈值' },
  },
  [State.AWAIT_CLARIFY]: {
    // 挂起态：下一次用户输入重新进入 UNDERSTANDING（由上层驱动）
  },
  [State.UNDERSTANDING]: {
    [Event.PARSE_OK]: { to: State.RESOLVING, guard: '同上' },
    [Event.PARSE_INCOMPLETE]: { to: State.AWAIT_CLARIFY, guard: '同上' },
  },
  [State.RESOLVING]: {
    [Event.RESOLVE_OK]: { to: State.GATHERING, guard: '教室名唯一匹配到系统内的教室标识' },
    [Event.RESOLVE_FAIL]: { to: State.REJECTED, guard: '教室名未匹配到任何教室，或匹配到多个（歧义）' },
  },
  [State.GATHERING]: {
    [Event.FACTS_READY]: { to: State.VALIDATING, guard: '判定所需事实全部收集完毕（缺一不可，见注册表声明的 preconditions）' },
    [Event.FACT_UNAVAILABLE]: { to: State.REJECTED, guard: '关键事实取不到 —— 不得假设其成立，只能保守终止（判定原则 2）' },
  },
  [State.VALIDATING]: {
    [Event.PROPOSITIONS_OK]: { to: State.SUBMITTING, guard: '全部前置命题成立 → 进入唯一的副作用出口' },
    [Event.PROPOSITIONS_FAIL]: { to: State.REJECTED, guard: '存在命题不成立' },
    [Event.CHECK_ONLY]: { to: State.DONE, guard: '只读意图：命题校验通过即已完成，不经过 SUBMITTING' },
    [Event.DEGRADE_AVAILABLE]: { to: State.DEGRADING, guard: '命题不成立但原因属于"资源被占/维修中"，且降级策略开启且未超轮次' },
    [Event.DEGRADE_EXHAUSTED]: { to: State.REJECTED, guard: '降级轮次用尽' },
  },
  [State.DEGRADING]: {
    [Event.RESOLVE_OK]: { to: State.GATHERING, guard: '找到替代教室，重新收集事实' },
    [Event.DEGRADE_EXHAUSTED]: { to: State.REJECTED, guard: '无可用替代教室' },
  },
  [State.SUBMITTING]: {
    [Event.CALL_SETTLED]: { to: State.JUDGING, guard: '调用返回确定结果（SUCCESS / FAILURE）' },
    [Event.CALL_UNKNOWN]: { to: State.VERIFYING, guard: '调用返回 UNKNOWN（响应丢失/超时/5xx）—— **不得当作失败**' },
    [Event.CALL_CONFLICT]: { to: State.VERIFYING, guard: '调用返回 409 冲突——歧义信号，**不得当作失败**' },
  },
  [State.JUDGING]: {
    [Event.JUDGE_SUCCESS]: { to: State.DONE, guard: '已确认成功，且无待补偿的中间状态' },
    [Event.JUDGE_FAILURE]: { to: State.FAILED, guard: '已确认失败，且无需补偿' },
    [Event.NEED_COMPENSATE]: { to: State.COMPENSATING, guard: '已确认失败，但此前已产生副作用，需要撤销' },
  },
  [State.VERIFYING]: {
    [Event.VERIFY_FOUND]: { to: State.DONE, guard: '业务键查证命中：副作用**已生效**，视为成功，禁止重试' },
    [Event.VERIFY_NOT_FOUND]: { to: State.JUDGING, guard: '业务键查证未命中：副作用未生效，可安全重试或判定失败' },
    [Event.VERIFY_INCONCLUSIVE]: { to: State.UNRESOLVED, guard: '查证接口能力不足，无法判定（如仅能拉全量列表且列表不含目标）' },
  },
  [State.COMPENSATING]: {
    [Event.COMPENSATION_DONE]: { to: State.FAILED, guard: '补偿成功，系统已恢复到可解释状态' },
    [Event.COMPENSATION_FAILED]: { to: State.UNRESOLVED, guard: '**补偿本身失败** —— 必须显式上报，不得静默（不变量 I6）' },
  },
  // 终态
  [State.DONE]: {},
  [State.FAILED]: {},
  [State.REJECTED]: {},
  [State.UNRESOLVED]: {},
});

/** 终态集合 */
export const TERMINAL_STATES = new Set([State.DONE, State.FAILED, State.REJECTED, State.UNRESOLVED]);

/**
 * 挂起态集合 —— 被动等待外部输入后才继续，没有自动出边。
 *
 * 与"死状态"的本质区别：
 *   死状态 = 走进去就出不来的设计缺陷；
 *   挂起态 = 设计上就该停下来等用户（AWAIT_CLARIFY 等用户补充信息）。
 * 自检据此区分二者，避免把正常设计判成缺陷、也避免把缺陷判成正常设计。
 */
export const SUSPENDED_STATES = new Set([State.AWAIT_CLARIFY]);

/** 查询一次转移是否被允许 */
export function nextState(from, event) {
  const row = TRANSITIONS[from];
  if (!row) throw new Error(`未知状态：${from}`);
  const t = row[event];
  return t ? t.to : null;
}

/** 某个状态是否允许发起写操作（唯一副作用出口的机器校验） */
export function canWrite(state) {
  return state === State.SUBMITTING;
}

/** 转移表自检：终态不得有出边；非终态不得是死状态（挂起态除外） */
export function auditTransitions() {
  const problems = [];
  for (const [from, row] of Object.entries(TRANSITIONS)) {
    const isTerminal = TERMINAL_STATES.has(from);
    const hasEdge = Object.keys(row).length > 0;
    if (isTerminal && hasEdge) problems.push(`终态 ${from} 不应有出边`);
    if (!isTerminal && !hasEdge && !SUSPENDED_STATES.has(from)) {
      problems.push(`非终态 ${from} 没有任何出边（死状态）`);
    }
  }
  return problems;
}
