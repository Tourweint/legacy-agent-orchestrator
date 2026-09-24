/**
 * 事实收集器 —— 把"注册表声明的依赖"翻译成"实际要调哪个接口、取哪一段数据"。
 *
 * 设计依据：docs/基线文档/智能体设计.md 不变量 I1
 *   「任何有副作用的调用发出前，其前置条件所依赖的事实必须已被收集且已判定为满足。」
 *
 * 关键点：**收集清单来自命题的 requires 字段**，不是手写的。
 *   validator/propositions.js 里 P-NOT-UNDER-MAINTENANCE 声明 requires: ['maintenanceWindows']，
 *   而维护窗口只能通过后勤域（需 ADMIN）取到 ——
 *   于是"必须跨权限域聚合"这件事，是**从命题自动推出来的**，不是硬编码的流程步骤。
 */

import { call } from '../gateway/client.js';
import { requiredFacts, getProposition } from '../validator/propositions.js';
import { Verdict } from '../common/tristate.js';

/** 从任意响应形态中取出数组 */
function asList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of ['list', 'records', 'rows', 'items', 'content', 'seatVOS', 'seats', 'reservations', 'maintenanceVOS']) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/**
 * factsKey → 收集方案。
 * 每个方案声明：调哪个接口、怎么传参、怎么从响应里取出事实。
 */
export const COLLECTORS = Object.freeze({
  classroom: {
    interfaceId: 'edu.classroom.detail',
    buildArgs: (ctx) => ({ pathParams: { classroomId: ctx.classroomId } }),
    pick: (data) => data,
    describe: (v) => (v ? `教室 ${v.building ?? ''}${v.room_number ?? v.roomNumber ?? ''}（状态 ${v.status ?? '未标注'}）` : '未取到教室信息'),
  },

  occupiedSeats: {
    interfaceId: 'edu.classroom.reservedSeats',
    buildArgs: (ctx) => ({
      pathParams: { classroomId: ctx.classroomId },
      // ⚠️ 存量系统入参是 OffsetDateTime（带 Z），由 toOffsetDateTime 保证形态
      query: { start_time: ctx.startIso, end_time: ctx.endIso },
    }),
    pick: (data) => asList(data).map((s) => (typeof s === 'object' ? (s.id ?? s.seatId ?? s.seat_id) : s)).filter((x) => x != null),
    describe: (v) => `该时段占用座位 ${Array.isArray(v) ? v.length : 0} 个`,
  },

  maintenanceWindows: {
    interfaceId: 'logi.maintenance.list', // ⚠️ ADMIN 身份 —— 跨权限域
    buildArgs: (ctx) => ({ query: { classroomId: ctx.classroomId } }),
    pick: (data) => asList(data),
    describe: (v) => `维修窗口 ${Array.isArray(v) ? v.length : 0} 条`,
  },

  occupiedClassroomReservations: {
    // ⚠️ 存量系统没有"按教室 + 时段"的查询接口，只能拉全量后内存比对。
    // 刻意不带 keyword：其实测语义模糊（keyword=4 会命中 resourceId=6 的记录），不可用作精确过滤。
    interfaceId: 'logi.reservation.list',
    buildArgs: () => ({}),
    pick: (data) => asList(data),
    describe: (v) => `全量预约 ${Array.isArray(v) ? v.length : 0} 条（需内存比对）`,
  },

  myReservations: {
    // 用**提交时同一身份**查"我的预约"（该接口按身份可见，这正是它可用于自查的原因）
    interfaceId: 'edu.reservation.mine',
    buildArgs: () => ({}),
    pick: (data) => asList(data),
    describe: (v) => `本人预约 ${Array.isArray(v) ? v.length : 0} 条`,
  },

  seat: {
    interfaceId: 'edu.classroom.seats',
    buildArgs: (ctx) => ({ pathParams: { classroomId: ctx.classroomId } }),
    pick: (data, ctx) => asList(data).find((s) => String(s.id ?? s.seatId) === String(ctx.seatId)) ?? null,
    describe: (v) => (v ? `座位 ${v.seatNumber ?? v.seat_number ?? v.id}` : '未取到座位信息'),
  },
});

/**
 * 按命题声明的 requires 收集事实（并行）。
 *
 * @param {string[]} propositionIds
 * @param {object} ctx
 * @param {import('../common/trace.js').Trace} trace
 * @returns {Promise<{facts: object, failures: object[], traceRows: object[]}>}
 */
export async function collectFacts(propositionIds, ctx, trace) {
  const keys = requiredFacts(propositionIds);
  const facts = {};
  const failures = [];
  const traceRows = [];

  const tasks = keys.map(async (key) => {
    const col = COLLECTORS[key];
    if (!col) {
      failures.push({ key, reason: `没有为事实「${key}」配置收集方案（注册表与命题不一致）` });
      return;
    }
    const res = await call(col.interfaceId, col.buildArgs(ctx));
    if (res.verdict !== Verdict.SUCCESS) {
      // 事实取不到 → 明确登记缺口，**不得假设其成立**（判定原则 2）
      failures.push({ key, interfaceId: col.interfaceId, verdict: res.verdict, reason: res.reason });
      traceRows.push({ key, interfaceId: col.interfaceId, ok: false, note: res.reason });
      return;
    }
    facts[key] = col.pick(res.data, ctx);
    traceRows.push({ key, interfaceId: col.interfaceId, ok: true, note: col.describe(facts[key]) });
  });

  await Promise.all(tasks);

  if (trace) {
    trace.step({
      stage: 'P2_DECIDE',
      action: `收集判定所需事实（${keys.length} 项，由命题 requires 自动推导）`,
      evidence: { required: keys, rows: traceRows },
      conclusion: failures.length === 0
        ? `事实齐备：${traceRows.map((r) => `${r.key}=${r.note}`).join('；')}`
        : `有 ${failures.length} 项事实取不到：${failures.map((f) => f.key).join('、')}`,
    });
  }

  return { facts, failures, traceRows };
}

/** 说明每个事实的归属域，用于文档与答辩（"为什么必须跨域"） */
export function factDomains(propositionIds) {
  return requiredFacts(propositionIds).map((key) => ({
    fact: key,
    interfaceId: COLLECTORS[key]?.interfaceId ?? null,
    domain: getProposition(
      propositionIds.find((p) => (getProposition(p).requires ?? []).includes(key)),
    )?.domain ?? null,
  }));
}
