/**
 * 业务命题定义 —— 把"业务规则"表达成"可校验命题"。
 *
 * 设计依据：docs/基线文档/智能体设计.md 命题 P2
 *   「这件事现在能不能办？依据是什么事实？」
 *
 * 为什么要有这一层，而不是把判断写在提交前的一堆 if 里：
 *   1. **可枚举**：命题有名字、有编号，能被文档引用、被测试逐个覆盖；
 *   2. **可解释**：每条命题都产出"依据哪条事实"的结论，直接服务不变量 I4；
 *   3. **可拦截**：命题在写操作**发起之前**失败即终止，保护存量系统不被写入脏数据（不变量 I1）；
 *   4. **可扩展**：新增业务规则 = 新增一条命题，不改调用链。
 *
 * ⚠️ 跨域命题（P-SLOT-FREE 中的整间预约部分、P-NOT-UNDER-MAINTENANCE）
 *    必须依赖**另一个权限域**的事实才能判定 —— 这正是编排层不可替代的证明。
 */

import { fromLocalDateTime, overlaps, describeRange } from '../common/time.js';

/**
 * 维修窗口中视为"已失效"的状态。
 * 采用**排除法**而非白名单：除明确失效的状态外，一律视为生效中。
 * 理由是保守优先 —— 漏放一个"其实在维修"的教室，会往存量系统写入脏数据；
 * 而多拦一次，用户只是被提示换时段。
 */
const INACTIVE_MAINTENANCE_STATUS = new Set(['CANCELLED', 'CANCELED', 'FINISHED', 'EXPIRED', 'CLOSED']);

/** 教室可用的 status 集合 */
const ENABLED_CLASSROOM_STATUS = new Set(['AVAILABLE', 'ENABLED', 'NORMAL', null, undefined]);

/**
 * @typedef {object} Proposition
 * @property {string} id
 * @property {string} label           人类可读的命题陈述
 * @property {string[]} requires      依赖的事实键（决定 gather 步骤必须收集什么）
 * @property {string} domain          判定所需事实的归属域（edu | logi | cross）
 * @property {(facts: object, ctx: object) => {ok: boolean, reason: string, evidence: any}} evaluate
 */

/** @type {Proposition[]} */
export const PROPOSITIONS = [
  {
    id: 'P-CLASSROOM-EXISTS',
    label: '目标教室存在于系统中',
    requires: ['classroom'],
    domain: 'edu',
    evaluate(facts) {
      const c = facts.classroom;
      if (!c || c.id == null) {
        return { ok: false, reason: '未找到该教室（可能名称有误）', evidence: facts.classroomSearch ?? null };
      }
      return { ok: true, reason: `教室存在：${c.building ?? ''}${c.room_number ?? c.roomNumber ?? ''}（id=${c.id}）`, evidence: { id: c.id } };
    },
  },
  {
    id: 'P-CLASSROOM-ENABLED',
    label: '目标教室处于启用状态',
    requires: ['classroom'],
    domain: 'edu',
    evaluate(facts) {
      const status = facts.classroom?.status;
      if (!ENABLED_CLASSROOM_STATUS.has(status)) {
        return { ok: false, reason: `教室当前状态为 ${status}，不可借用`, evidence: { status } };
      }
      return { ok: true, reason: `教室状态正常（${status ?? '未标注'}）`, evidence: { status } };
    },
  },
  {
    id: 'P-NOT-ALREADY-MINE',
    label: '同一申请此前未被本人提交过',
    requires: ['myReservations'],
    domain: 'edu',
    evaluate(facts, ctx) {
      const mine = facts.myReservations ?? [];
      const hit = mine.find((r) => {
        const type = String(r.resource_type ?? r.resourceType ?? '').toUpperCase();
        if (type && type !== 'CLASSROOM') return false;
        const rid = String(r.resource_id ?? r.resourceId ?? r.classroom_id ?? r.classroomId ?? '');
        if (rid !== String(ctx.classroomId)) return false;
        const st = String(r.status ?? '').toUpperCase();
        if (st !== 'ACTIVE') return false;
        const s = fromLocalDateTime(r.start_time ?? r.startTime);
        const e = fromLocalDateTime(r.end_time ?? r.endTime);
        return s && e && overlaps(ctx.start, ctx.end, s, e);
      });
      if (hit) {
        return {
          ok: false,
          reason: `您此前已提交过完全相同的申请（预约 id=${hit.id}，`
            + `${describeRange(hit.start_time ?? hit.startTime, hit.end_time ?? hit.endTime)}），无需重复提交`,
          evidence: { existingReservationId: hit.id, status: hit.status },
        };
      }
      return { ok: true, reason: '本人无同教室同时段的有效预约', evidence: { scanned: mine.length } };
    },
  },
  {
    id: 'P-SLOT-FREE',
    label: '目标时段该教室未被占用',
    requires: ['occupiedSeats', 'occupiedClassroomReservations'],
    domain: 'cross',
    evaluate(facts, ctx) {
      const seats = facts.occupiedSeats ?? [];
      const cap = Number(facts.classroom?.capacity ?? 0);
      const fullBySeats = cap > 0 && seats.length >= cap;

      // ★ 本项目最重要的一处真实语义陷阱 —— 已核实到源码级（ReservationServiceImpl:182-188）：
      //
      //     if (整间教室预约冲突 || 维修窗口冲突) {
      //         return 该教室的全部座位;
      //     }
      //
      //   即：**"整间教室被预约"与"教室在维修中"被合并成同一个返回值**。
      //   从这个接口看不出到底是哪种原因 —— 而两者的应对方式完全不同
      //   （被订了 → 换教室/换时段；在维修 → 该教室一段时间内都不可用）。
      //
      //   要区分，只能换 ADMIN 身份去后勤域查维修窗口。
      //   → 这就是"跨权限域聚合"的**技术必然性**，不是设计偏好。见 P-NOT-UNDER-MAINTENANCE。
      if (seats.length > 0) {
        const reason = fullBySeats
          ? `该时段教室被完全占用（接口返回全部 ${seats.length} 个座位）`
            + '；⚠️ 此信号可能是"整间教室已被预约"，也可能是"教室正在维修中"'
            + '——存量接口把两种原因合并返回，无法区分，须由后勤域事实交叉判定'
          : `该时段已有 ${seats.length}/${cap || '?'} 个座位被占用（座位粒度；而写操作是整间教室粒度）`;
        return {
          ok: false,
          reason,
          evidence: {
            occupiedSeatCount: seats.length,
            capacity: cap || null,
            signalIsAmbiguous: fullBySeats,
            ambiguityNote: fullBySeats
              ? 'reserved_seats 返回全量座位 = 整间预约 OR 维修中（源码将两者 || 合并）'
              : null,
          },
        };
      }

      // 座位层面空闲，再核对整间教室预约（接口无此查询，只能内存比对全量列表）
      const rooms = facts.occupiedClassroomReservations ?? [];
      const hit = rooms.find((r) => {
        const type = String(r.resource_type ?? r.resourceType ?? '').toUpperCase();
        if (type && type !== 'CLASSROOM') return false;
        const rid = String(r.classroom_id ?? r.classroomId ?? r.resource_id ?? r.resourceId ?? '');
        if (rid !== String(ctx.classroomId)) return false;
        const st = String(r.status ?? '').toUpperCase();
        if (st !== 'ACTIVE') return false;
        const s = fromLocalDateTime(r.start_time ?? r.startTime);
        const e = fromLocalDateTime(r.end_time ?? r.endTime);
        return s && e && overlaps(ctx.start, ctx.end, s, e);
      });
      if (hit) {
        return {
          ok: false,
          reason: `该时段教室已被占用（预约 id=${hit.id}，${describeRange(hit.start_time ?? hit.startTime, hit.end_time ?? hit.endTime)}）`,
          evidence: { reservationId: hit.id, start: hit.start_time ?? hit.startTime, end: hit.end_time ?? hit.endTime },
        };
      }

      return { ok: true, reason: '该时段无座位占用、无整间预约', evidence: { occupiedSeatCount: 0, matchedReservation: null } };
    },
  },
  {
    id: 'P-NOT-UNDER-MAINTENANCE',
    label: '目标时段该教室不处于维修窗口内',
    requires: ['maintenanceWindows'],
    domain: 'logi', // ⚠️ 依赖后勤域事实，且需 ADMIN 身份才能读到
    evaluate(facts, ctx) {
      const wins = facts.maintenanceWindows ?? [];
      // 维修窗口的出参是 camelCase（resourceType/resourceId/startTime），入参却是 snake_case
      const relevant = wins.filter((w) => {
        const rid = String(w.classroom_id ?? w.classroomId ?? w.resource_id ?? w.resourceId ?? '');
        return rid === String(ctx.classroomId);
      });
      const active = relevant.filter((w) => {
        const st = String(w.status ?? '').toUpperCase();
        return !INACTIVE_MAINTENANCE_STATUS.has(st);
      });
      const hit = active.find((w) => {
        const s = fromLocalDateTime(w.start_time ?? w.startTime);
        const e = fromLocalDateTime(w.end_time ?? w.endTime);
        return s && e && overlaps(ctx.start, ctx.end, s, e);
      });
      if (hit) {
        return {
          ok: false,
          reason: `该时段教室处于维修窗口（原因：${hit.reason || '未说明'}）——`
            + '此事实只有后勤域可见，这正是教务侧身份无法独立完成判定的原因',
          evidence: { maintenanceId: hit.id, reason: hit.reason ?? null, start: hit.start_time ?? hit.startTime, end: hit.end_time ?? hit.endTime },
        };
      }
      return {
        ok: true,
        reason: `该教室在该时段无生效中的维修窗口（该教室共 ${relevant.length} 条记录，其中生效中 ${active.length} 条）`,
        evidence: { totalForRoom: relevant.length, active: active.length },
      };
    },
  },
  {
    id: 'P-SEAT-EXISTS',
    label: '目标座位存在于该教室',
    requires: ['seat'],
    domain: 'edu',
    evaluate(facts) {
      if (!facts.seat || facts.seat.id == null) {
        return { ok: false, reason: '未找到该座位', evidence: null };
      }
      return { ok: true, reason: `座位存在（id=${facts.seat.id}）`, evidence: { id: facts.seat.id } };
    },
  },
  {
    id: 'P-SEAT-SLOT-FREE',
    label: '目标座位在该时段未被占用',
    requires: ['occupiedSeats'],
    domain: 'edu',
    evaluate(facts, ctx) {
      const seats = facts.occupiedSeats ?? [];
      if (seats.map(String).includes(String(ctx.seatId))) {
        return { ok: false, reason: '该座位在该时段已被占用', evidence: { seatId: ctx.seatId } };
      }
      return { ok: true, reason: '该座位该时段空闲', evidence: { seatId: ctx.seatId } };
    },
  },
];

const BY_ID = new Map(PROPOSITIONS.map((p) => [p.id, p]));

export function getProposition(id) {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`未登记的命题：${id}`);
  return p;
}

/**
 * 由接口的 preconditions 反推"必须收集哪些事实"。
 * 这是"注册表声明前置条件 → 状态机自动生成 gather 步骤"的接口，
 * 保证**新增命题不需要改调用链代码**。
 */
export function requiredFacts(propositionIds) {
 const keys = new Set();
  for (const id of propositionIds) {
    for (const k of getProposition(id).requires) keys.add(k);
  }
  return [...keys];
}
