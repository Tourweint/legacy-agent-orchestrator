/**
 * 编排状态机 —— 主执行器。
 *
 * 设计依据：docs/基线文档/智能体设计.md 命题 P1–P6 与 §7.2 运行时形态。
 *
 * 一条贯穿全篇的纪律：**副作用只能从 SUBMITTING 状态发出**（见 states.js canWrite）。
 * 本文件里所有 `call()` 的出现都可以被审计：只有一处是为了写入，其余都是只读收集或查证。
 *
 * 执行顺序：
 *   P1 理解 → 归一化 → 解析教室 → P2 收集事实 → P2 校验命题
 *   → P3 提交 → P4 判定 → （不确定则）查证收敛 → P5 补偿 → P6 汇总证据
 */

import { understand } from '../llm/index.js';
import { getInterface } from '../registry/interfaces.js';
import { getIntent } from '../registry/plans.js';
import { call } from '../gateway/client.js';
import { Verdict } from '../common/tristate.js';
import { Trace, Stage } from '../common/trace.js';
import { collectFacts } from './collectors.js';
import { validate, explainFailures } from '../validator/index.js';
import { normalizeSlots } from './normalize.js';
import { resolveClassroom } from './resolve.js';
import { verify } from './verify.js';
import { compensate } from './compensate.js';
import { toOffsetDateTime, describeRange } from '../common/time.js';
import { State, Event, nextState } from './states.js';

/**
 * 主入口。
 * @param {object} p
 * @param {string} p.utterance 用户自然语言
 * @param {object} [p.history] 已确认槽位
 * @returns {Promise<object>} 结果对象（见文件末尾 buildResult）
 */
export async function run({ utterance, history = {} }) {
  const trace = new Trace();
  let state = State.IDLE;
  /** 状态转移轨迹（与 trace 并行，专记状态变化） */
  const transitions = [];

  const fire = (event, note = '') => {
    const to = transition(state, event);
    transitions.push({ from: state, event, to, note });
    trace.step({
      stage: stageOf(to),
      action: `状态转移：${state} --${event}--> ${to}`,
      evidence: { event, note },
      conclusion: note || '',
    });
    state = to;
    return to;
  };

  // ============================================================
  // P1 理解
  // ============================================================
  state = State.UNDERSTANDING;
  const u = await understand(utterance, history, trace);

  if (!u.ok) {
    fire(Event.PARSE_INCOMPLETE, u.reason);
    return buildResult({ state, ok: false, verdict: u.reason, message: u.clarification, trace, transitions });
  }

  const intentSpec = getIntent(u.intent);

  // ============================================================
  // 归一化槽位（日期、节次）
  // ============================================================
  const norm = normalizeSlots(u.slots);
  if (!norm.ok) {
    fire(Event.RESOLVE_FAIL, norm.reason);
    return buildResult({
      state, ok: false, verdict: 'SLOT_UNPARSEABLE',
      message: `抱歉，${norm.reason}。请换个说法，例如「帮我借明天上午第 1 到 2 节数智楼222」。`,
      trace, transitions,
    });
  }
  const ctx = {
    classroomId: null,
    start: norm.start,
    end: norm.end,
    startIso: toOffsetDateTime(norm.start),
    endIso: toOffsetDateTime(norm.end),
    seatId: u.slots.seatId ?? null,
  };

  // ============================================================
  // 解析教室
  // ============================================================
  fire(Event.PARSE_OK, `识别意图 ${u.intentLabel}，槽位齐备`);

  const resolved = await resolveClassroom(u.slots.classroom);
  trace.step({
    stage: Stage.P1_UNDERSTAND,
    action: `解析教室「${u.slots.classroom}」`,
    evidence: resolved.evidence,
    conclusion: resolved.reason,
  });

  if (!resolved.ok) {
    fire(Event.RESOLVE_FAIL, resolved.reason);
    const hint = resolved.candidates.length
      ? `候选：${resolved.candidates.map((c) => `${c.building ?? ''}${c.room_number}`).join('、')}`
      : (resolved.evidence?.available?.length ? `现有教室：${resolved.evidence.available.join('、')}` : '');
    return buildResult({
      state, ok: false, verdict: 'CLASSROOM_NOT_RESOLVED',
      message: `${resolved.reason}。${hint}`,
      trace, transitions,
    });
  }

  ctx.classroomId = resolved.classroomId;
  fire(Event.RESOLVE_OK, resolved.reason);

  // ============================================================
  // P2 收集事实 + 校验命题（含降级循环）
  // ============================================================
  const writeSpec = findWriteSpec(intentSpec);
  const propositionIds = writeSpec ? writeSpec.preconditions : [];

  const decision = await decide(ctx, resolved, propositionIds, intentSpec, trace, fire);

  if (!decision.ok) {
    return buildResult({
      state, ok: false, verdict: decision.verdict,
      message: decision.message, trace, transitions,
      context: { classroom: decision.classroom ?? resolved },
    });
  }
  ctx.classroomId = decision.classroom?.classroomId ?? ctx.classroomId;

  // 只读意图：到此结束（不经过 SUBMITTING，因此不可能产生任何副作用）
  if (!writeSpec) {
    fire(Event.CHECK_ONLY, '只读意图，命题校验通过即完成');
    return buildResult({
      state, ok: true, verdict: 'CHECK_ONLY',
      message: `查询完成：${describeRange(ctx.start, ctx.end)} ${decision.classroom?.building ?? ''}${decision.classroom?.roomNumber ?? ''} 可以借用。`,
      data: { available: true, propositions: decision.propositions },
      trace, transitions,
    });
  }

  // ============================================================
  // P3 提交（唯一的副作用出口）
  // ============================================================
  // ★ 必须显式经过 SUBMITTING 状态。
  //   转移表不允许从 VALIDATING 直接提交 —— 这条约束把"副作用"收敛到单点，
  //   是状态机最硬的一条纪律，也是"关掉状态机就调不了接口"的保证。
  fire(Event.PROPOSITIONS_OK, '前置命题全部成立，进入提交状态');

  const submitBody = {
    classroom_id: ctx.classroomId,
    start_time: ctx.startIso,
    end_time: ctx.endIso,
    reason: u.slots.purpose || 'Agent 代办',
  };

  trace.step({
    stage: Stage.P3_INVOKE,
    action: `以 ${writeSpec.requiredRole} 身份提交教室借用申请`,
    evidence: { interfaceId: writeSpec.id, body: submitBody, identity: writeSpec.requiredRole },
    conclusion: '已发起写操作（副作用在此发生）',
  });

  const submitted = await call(writeSpec.id, { body: submitBody });

  // ============================================================
  // P4 判定
  // ============================================================
  let verdict;
  let message;
  let writeOutcome = submitted;
  let verifyResult = null;

  if (submitted.verdict === Verdict.SUCCESS) {
    fire(Event.CALL_SETTLED, `提交成功（${submitted.reason}）`);
    fire(Event.JUDGE_SUCCESS, '确认为成功，无待补偿的中间状态');
    verdict = 'SUCCESS';
    message = `已提交：${describeRange(ctx.start, ctx.end)} ${decision.classroom?.building ?? ''}${decision.classroom?.roomNumber ?? ''}。`
      + (norm.notes.length ? `（${norm.notes.join('；')}）` : '');
  } else if (submitted.verdict === Verdict.UNKNOWN || submitted.bizCode === 409) {
    // ⚠️ 关键分支：超时 / 冲突 —— 都不能当失败，必须查证
    const evt = submitted.verdict === Verdict.UNKNOWN ? Event.CALL_UNKNOWN : Event.CALL_CONFLICT;
    fire(evt, submitted.reason);

    verifyResult = await verify({
      key: `${ctx.classroomId}|${ctx.startIso}|${ctx.endIso}`,
      ctx, interfaceId: writeSpec.id, writtenAs: writeSpec.requiredRole,
    });

    trace.step({
      stage: Stage.P4_JUDGE,
      action: '按业务键查证写入是否已生效',
      evidence: verifyResult.evidence,
      conclusion: `查证结论：${verifyResult.status} —— ${verifyResult.detail.reason}`,
    });

    if (verifyResult.status === 'FOUND') {
      fire(Event.VERIFY_FOUND, '副作用已生效，判定成功并禁止重试');
      verdict = 'SUCCESS_AFTER_VERIFY';
      message = '申请已成功（此前未收到响应，经查证确认已生效，**未重复提交**）：'
        + `${describeRange(ctx.start, ctx.end)} ${decision.classroom?.building ?? ''}${decision.classroom?.roomNumber ?? ''}。`;
      writeOutcome = { ...submitted, verdict: Verdict.SUCCESS, data: verifyResult.detail };
    } else if (verifyResult.status === 'NOT_FOUND') {
      fire(Event.VERIFY_NOT_FOUND, '副作用未生效');
      fire(Event.JUDGE_FAILURE, '查证确认未生效，可安全重试');
      verdict = 'FAILED_AFTER_VERIFY';
      message = `申请未成功（已查证确认未生效）：${submitted.reason}。`;
    } else {
      fire(Event.VERIFY_INCONCLUSIVE, '查证接口能力不足，无法判定');
      verdict = 'UNRESOLVED';
      message = `无法确认申请结果（${verifyResult.detail.reason}）。为避免重复提交，系统未自动重试，请人工核查。`;
    }
  } else {
    // 确定失败（400 / 403 / 401 等）—— 无需补偿，因为本次写入未生效
    fire(Event.CALL_SETTLED, `提交失败：${submitted.reason}`);
    fire(Event.JUDGE_FAILURE, '确定失败，且无待补偿的中间状态');
    verdict = 'FAILED';
    message = `申请未成功：${submitted.reason}`;
  }

  // ============================================================
  // P6 汇总
  // ============================================================
  trace.step({
    stage: Stage.P6_EVIDENCE,
    action: '汇总执行证据链',
    evidence: { transitions, propositions: decision.propositions, writeOutcome: { verdict: writeOutcome.verdict, bizCode: writeOutcome.bizCode }, verifyResult },
    conclusion: `最终状态 ${state}（${verdict}）`,
  });

  return buildResult({
    state, ok: state === State.DONE, verdict, message,
    data: {
      classroom: decision.classroom,
      range: { start: ctx.startIso, end: ctx.endIso, human: describeRange(ctx.start, ctx.end) },
      propositions: decision.propositions,
      writeOutcome: { verdict: writeOutcome.verdict, bizCode: writeOutcome.bizCode, reason: writeOutcome.reason },
      verify: verifyResult ? { status: verifyResult.status, detail: verifyResult.detail } : null,
    },
    trace, transitions,
  });
}

// ================================================================
// 内部：P2 决策（含降级）
// ================================================================

/**
 * P2 决策：收集事实 → 校验命题 → （不通过且可降级时）换教室重试。
 *
 * ⚠️ 本函数通过 fire() 真实推进状态机，而不是自己返回一个状态字符串 ——
 *    否则状态转移表就形同虚设（"代码走的路"与"表里画的路"会分叉）。
 */
async function decide(ctx, resolved, propositionIds, intentSpec, trace, fire) {
  let current = resolved;
  let rounds = 0;
  const maxRounds = intentSpec.degrade?.enabled ? (intentSpec.degrade.maxRounds ?? 3) : 0;

  while (true) {
    ctx.classroomId = current.classroomId;

    const { facts, failures } = await collectFacts(propositionIds, ctx, trace);

    if (failures.length > 0) {
      // 事实缺口：不得假设其成立 → 保守终止（判定原则 2）
      fire(Event.FACT_UNAVAILABLE, `${failures.length} 项事实取不到`);
      return {
        ok: false, verdict: 'FACT_UNAVAILABLE',
        message: `无法获取判定所需事实，已保守终止（未产生任何写入）：`
          + failures.map((f) => `${f.key}（${f.reason}）`).join('；'),
      };
    }

    fire(Event.FACTS_READY, `事实齐备（${Object.keys(facts).length} 项）`);

    const v = validate(propositionIds, facts, ctx, trace);

    if (v.ok) {
      return { ok: true, classroom: current, propositions: v.results };
    }

    // ★ 幂等的第一道防线：若"本人此前已提交过相同申请"，给出**准确**提示。
    //   不能笼统地说"教室不可用" —— 那样占用者其实是用户自己，提示会误导他去换教室。
    const dup = v.failures.find((f) => f.id === 'P-NOT-ALREADY-MINE');
    if (dup) {
      fire(Event.PROPOSITIONS_FAIL, '检测到本人重复申请');
      return {
        ok: false,
        verdict: 'DUPLICATE_REQUEST',
        message: `${dup.reason}。`,
        classroom: current,
        propositions: v.results,
      };
    }

    // 命题不成立 → 判断能否降级换教室
    const degradable = v.failures.every((f) => f.id === 'P-SLOT-FREE' || f.id === 'P-NOT-UNDER-MAINTENANCE');
    const exhausted = rounds >= maxRounds;

    if (!degradable || exhausted) {
      fire(Event.PROPOSITIONS_FAIL, v.failures.map((f) => f.id).join('、'));
      const reason = v.failures.map((f) => f.reason).join('；');
      return {
        ok: false,
        verdict: exhausted && maxRounds > 0 ? 'DEGRADE_EXHAUSTED' : 'PRECONDITION_FAILED',
        message: exhausted && maxRounds > 0
          ? `已尝试 ${rounds} 间替代教室均不可用，未能完成申请。原因：${reason}`
          : `无法办理：\n${v.failures.map((f) => `✗ ${f.label} —— ${f.reason}`).join('\n')}`,
        classroom: current,
        propositions: v.results,
      };
    }

    // ---- 尝试降级：换一间可用的教室 ----
    rounds += 1;
    fire(Event.DEGRADE_AVAILABLE, `第 ${rounds}/${maxRounds} 轮降级`);
    trace.step({
      stage: Stage.P2_DECIDE,
      action: `目标教室不可用，尝试第 ${rounds}/${maxRounds} 轮降级`,
      evidence: { failed: v.failures.map((f) => f.id) },
      conclusion: `按策略 ${intentSpec.degrade.strategy} 寻找替代教室`,
    });

    const alt = await findAlternative(current, ctx, propositionIds);
    if (!alt) {
      fire(Event.DEGRADE_EXHAUSTED, '未找到可替代的空闲教室');
      return {
        ok: false, verdict: 'DEGRADE_EXHAUSTED',
        message: `目标教室不可用（${v.failures.map((f) => f.reason).join('；')}），且未找到可替代的空闲教室。`,
        classroom: current,
        propositions: v.results,
      };
    }

    fire(Event.RESOLVE_OK, `改用 ${alt.building ?? ''}${alt.roomNumber ?? ''}`);
    trace.step({
      stage: Stage.P2_DECIDE,
      action: '找到替代教室，重新收集事实',
      evidence: { from: current.classroomId, to: alt.classroomId, reason: alt.reason },
      conclusion: `改用 ${alt.building ?? ''}${alt.roomNumber ?? ''}（id=${alt.classroomId}），${alt.reason}`,
    });
    current = alt;
  }
}

/** 降级策略：同楼栋、容量达标、时段空闲的教室 */
async function findAlternative(current, ctx, propositionIds) {
  const res = await call('edu.classroom.available', {
    // ⚠️ min_capacity 必填（缺失会返回 500），传 0 表示不限制
    query: { min_capacity: 0, ...(current.building ? { building: current.building } : {}) },
  });
  if (res.verdict !== Verdict.SUCCESS) return null;

  const data = res.data;
  const list = Array.isArray(data) ? data
    : (Array.isArray(data?.list) ? data.list : (Array.isArray(data?.records) ? data.records : []));

  const need = current.classroom?.capacity ?? 0;

  for (const c of list) {
    if (String(c.id) === String(current.classroomId)) continue;
    if (need && Number(c.capacity ?? 0) < need) continue;

    const probe = { ...ctx, classroomId: c.id };
    const { facts, failures } = await collectFacts(propositionIds, probe, null);
    if (failures.length > 0) continue;
    const v = validate(propositionIds, facts, probe, null);
    if (v.ok) {
      return {
        ok: true,
        classroomId: c.id,
        building: c.building,
        roomNumber: String(c.room_number ?? c.roomNumber ?? ''),
        classroom: c,
        reason: `容量 ${c.capacity} 达标且时段空闲`,
      };
    }
  }
  return null;
}

// ================================================================
// 辅助
// ================================================================

/** 找出意图里的写操作接口（若有） */
function findWriteSpec(intentSpec) {
  for (const step of intentSpec.steps) {
    if (step.kind === 'invoke' && step.interfaceId) return getInterface(step.interfaceId);
  }
  return null;
}

/**
 * 查转移表并校验合法性。
 * 非法转移直接抛错 —— 不允许静默跳过：没走过的路，往往就是缺陷藏身处。
 */
function transition(from, event) {
  const to = nextState(from, event);
  if (to == null) throw new Error(`非法状态转移：${from} 不接受事件「${event}」`);
  return to;
}

function stageOf(state) {
  switch (state) {
    case State.UNDERSTANDING:
    case State.AWAIT_CLARIFY:
    case State.RESOLVING:
      return Stage.P1_UNDERSTAND;
    case State.GATHERING:
    case State.VALIDATING:
    case State.REJECTED:
    case State.DEGRADING:
      return Stage.P2_DECIDE;
    case State.SUBMITTING:
      return Stage.P3_INVOKE;
    case State.JUDGING:
    case State.VERIFYING:
      return Stage.P4_JUDGE;
    case State.COMPENSATING:
      return Stage.P5_RECOVER;
    default:
      return Stage.P6_EVIDENCE;
  }
}

function buildResult({ state, ok, verdict, message, data = null, trace, transitions, context = null }) {
  return {
    state,
    ok,
    verdict,
    message,
    data,
    context,
    transitions,
    trace: trace.toView(),
    archive: trace.toArchive(),
  };
}

/**
 * 回滚已完成的写入（**多步写入场景**使用）。
 *
 * 当前主场景（单次写入）不会触发本函数：只写一次，失败即失败，没有中间状态需要撤销。
 * 需要它的典型场景是"批量借教室"——第一间提交成功、第二间失败时，
 * 必须撤销第一间，否则用户以为整体失败了、系统里却占着一间教室（破坏不变量 I6）。
 *
 * 补偿顺序：**逆序回滚**（后提交的先撤销）。这是 Saga 的标准形态。
 * 本函数明确不保证全部成功：任一项失败都会带上 requiresManualIntervention，
 * 由上层显式上报，绝不静默。
 *
 * @param {Array<{spec: object, result: object}>} completed 已成功的写入（按完成顺序）
 * @returns {Promise<{ok: boolean, items: object[], problems: string[]}>}
 */
export async function rollbackCompleted(completed) {
  const items = [];
  const problems = [];

  for (const { spec, result } of [...completed].reverse()) {
    const r = await compensate({
      writtenInterfaceId: spec.id,
      writtenResult: result,
      reason: '后续步骤失败，回滚此前已完成的写入',
    });
    items.push({ interfaceId: spec.id, ok: r.ok, detail: r.detail });
    if (!r.ok) problems.push(`${spec.id}: ${r.detail.reason}`);
  }

  return { ok: problems.length === 0, items, problems };
}

