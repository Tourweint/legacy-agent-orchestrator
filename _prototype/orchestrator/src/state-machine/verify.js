/**
 * 业务键查证 —— 把"不确定"收敛为"确定"。
 *
 * 设计依据：docs/基线文档/智能体设计.md 不变量 I3
 *   「每次调用结束后，系统必须能给出唯一确定的结论；'不确定'必须被继续收敛，不得悬空。」
 *
 * 这是整个项目最有答辩价值的一段逻辑，因为它回答了：
 *   "超时了怎么办？" —— 不猜，去查。
 *
 * 存量系统的查证能力实测如下（均不理想，正是难点所在）：
 *   - `GET /reservations`（我的预约）：只返回**当前身份**的预约，需拉全量后内存比对；
 *   - `GET /admin/reservations`（管理端）：**跨身份可见**（这是关键优势），且**不带参数时返回全量**；
 *     ⚠️ 但它的 `keyword` 参数语义模糊（实测 keyword=4 会命中 resourceId=6 的记录），
 *     **不可用于精确过滤**，因此本模块刻意不带 keyword 查询，改为拉全量后在内存精确比对；
 *     ⚠️ 该接口**无分页参数**，数据量大时无法保证全量（当前 87 条，风险已登记）。
 *
 * 查证结果的三种归宿：
 *   命中    → 副作用已生效 → 判定为成功，**禁止重试**（保护不变量 I2）
 *   未命中  → 副作用未生效 → 可安全重试或判定失败
 *   查不清  → 无法判定 → 进入 UNRESOLVED，**显式上报，不静默**（不变量 I3/I6）
 */

import { call } from '../gateway/client.js';
import { fromLocalDateTime, overlaps, describeRange } from '../common/time.js';
import { Verdict } from '../common/tristate.js';

/** 全量列表的安全阈值：超过则怀疑被截断，结论降级为"查不清" */
const FULL_LIST_SAFETY_LIMIT = 500;

/** 从任意响应形态中取出数组 */
function extractList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of ['list', 'records', 'rows', 'items', 'content', 'reservations', 'reservationVOS']) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/**
 * 按业务键查证"这次写入是否已生效"。
 *
 * @param {object} p
 * @param {string} p.key      业务键（形如 "4|2026-09-30T01:00:00Z|2026-09-30T02:00:00Z"）
 * @param {object} p.ctx      上下文（classroomId / start / end / seatId）
 * @param {string} p.interfaceId 原写入接口 ID（决定用哪条查证路径）
 * @param {object} p.writtenAs 发起写入时使用的身份角色（某些查证路径必须同身份）
 * @returns {Promise<{status: 'FOUND'|'NOT_FOUND'|'INCONCLUSIVE', detail: object, evidence: object}>}
 */
export async function verify({ key, ctx, interfaceId, writtenAs }) {
  // 查证路径一：管理端全量列表（跨身份可见，作为首选）
  // ⚠️ 刻意不带 keyword：其实测语义模糊（会命中非目标记录），全量拉取后内存精确过滤才可靠
  const admin = await call('logi.reservation.list', {});
  if (admin.verdict === Verdict.SUCCESS) {
    const list = extractList(admin.data);
    const hit = list.find((r) => {
      const rid = String(r.classroom_id ?? r.classroomId ?? r.resource_id ?? r.resourceId ?? '');
      if (rid !== String(ctx.classroomId)) return false;
      const s = fromLocalDateTime(r.start_time ?? r.startTime);
      const e = fromLocalDateTime(r.end_time ?? r.endTime);
      if (!s || !e) return false;
      // 时段必须重叠，且状态不是已取消
      const st = String(r.status ?? '').toUpperCase();
      if (st === 'CANCELLED' || st === 'CANCELED') return false;
      return overlaps(ctx.start, ctx.end, s, e);
    });

    if (hit) {
      return {
        status: 'FOUND',
        detail: { reservationId: hit.id, range: describeRange(hit.start_time ?? hit.startTime, hit.end_time ?? hit.endTime), status: hit.status },
        evidence: {
          path: 'logi.reservation.list',
          queriedBy: 'ADMIN',
          scanned: list.length,
          note: '管理端列表跨身份可见 —— 这是幂等机制的关键支点',
          matched: { id: hit.id },
        },
      };
    }

    // 全量拉到了、但没有匹配项 → 可以比较有把握地说"未生效"
    if (list.length >= FULL_LIST_SAFETY_LIMIT) {
      return {
        status: 'INCONCLUSIVE',
        detail: { reason: `查证列表规模达 ${list.length} 条，且接口无分页参数，无法确认是否为全量` },
        evidence: { path: 'logi.reservation.list', scanned: list.length, truncatedRisk: true },
      };
    }
    return {
      status: 'NOT_FOUND',
      detail: { reason: `扫描全量 ${list.length} 条预约，无与教室 ${ctx.classroomId} 时段重叠的有效记录` },
      evidence: { path: 'logi.reservation.list', scanned: list.length, truncatedRisk: false },
    };
  }

  // 查证路径二：我的预约（必须与写入时同一身份）
  const mine = await call('edu.reservation.mine', {});
  if (mine.verdict === Verdict.SUCCESS) {
    const list = extractList(mine.data);
    const hit = list.find((r) => {
      const rid = String(r.classroom_id ?? r.classroomId ?? r.resource_id ?? r.resourceId ?? '');
      if (ctx.classroomId != null && rid !== String(ctx.classroomId)) return false;
      const s = fromLocalDateTime(r.start_time ?? r.startTime);
      const e = fromLocalDateTime(r.end_time ?? r.endTime);
      if (!s || !e) return false;
      const st = String(r.status ?? '').toUpperCase();
      if (st === 'CANCELLED' || st === 'CANCELED') return false;
      return overlaps(ctx.start, ctx.end, s, e);
    });
    if (hit) {
      return {
        status: 'FOUND',
        detail: { reservationId: hit.id, range: describeRange(hit.start_time ?? hit.startTime, hit.end_time ?? hit.endTime) },
        evidence: { path: 'edu.reservation.mine', queriedBy: writtenAs ?? 'TEACHER' },
      };
    }
    return {
      status: 'INCONCLUSIVE',
      detail: { reason: '管理端查证不可用，且"我的预约"仅覆盖当前身份，无法排除其他身份写入' },
      evidence: { path: 'edu.reservation.mine', returned: list.length },
    };
  }

  return {
    status: 'INCONCLUSIVE',
    detail: { reason: `两条查证路径均不可用：admin=${admin.verdict}, mine=${mine.verdict}` },
    evidence: { adminVerdict: admin.verdict, mineVerdict: mine.verdict },
  };
}

/**
 * 展示查证能力的局限（用于文档与答辩说明，也是"接口能力不足"的显式登记）。
 */
export const VERIFY_LIMITATIONS = Object.freeze([
  '无"按教室 + 时段"精确查询接口，只能拉全量列表后在内存比对',
  '管理端 keyword 参数语义模糊（实测 keyword=4 会命中 resourceId=6 的记录），不可用于精确过滤',
  '管理端列表接口无分页参数，数据量增大后无法保证全量',
  '"我的预约"仅覆盖当前身份，不能作为跨身份写入的反证',
  '查证只能确认"存在"，无法确认"这条正是本次调用产生的"—— 因此幂等依赖业务键（教室+时段）而非调用 ID',
]);
