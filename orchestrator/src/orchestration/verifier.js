// 查证谓词 —— 第 06 章 §三（查证要回答两个问题）/§五（三条路径及优先级）/§8.1（补偿语境按 recordId）。
//
// 正向查证（提交后消解歧义）：
//   首选 ADMIN 全量列表（跨身份可见，能同时回答 Q1 谁写的 + Q2 是否重叠）；
//   降级 mine 只能证明"我写过"——它的未命中【不得】当"未生效"，只出 INCONCLUSIVE（保守）。
// 补偿查证（撤销后）：
//   按 recordId 定位（不得按业务键——重叠会让另一条记录误命中，二审红线 31）：
//   记录消失或非 ACTIVE = 撤销已生效（FOUND）；仍 ACTIVE = 撤销未生效（NOT_FOUND，可重试撤销 D8）。
// 安全阈值（C5/§五.4）：超阈仍比对，未命中 → INCONCLUSIVE，绝不当"未生效"。

import { rangesOverlap } from '../canonical/time.js'
import { seatRowAttribution } from '../judgment/predicates.js'

export class Verifier {
  constructor({ configStore, gateway }) {
    this.store = configStore
    this.gateway = gateway
  }

  #verificationPlan(intent) {
    return intent.verification
  }

  /**
   * 正向查证。返回 {outcome: 'FOUND_MINE'|'FOUND_OTHERS'|'NOT_FOUND'|'INCONCLUSIVE', matched?, basis, summary}
   */
  async verifyForward({ intent, target, identity }) {
    const plan = this.#verificationPlan(intent)
    const primary = await this.gateway.call(plan.primary.interface, {}, { initiatorIdentity: plan.primary.identity === 'initiator' ? identity.id : undefined })
    const basis = [{ fact: 'F4' }]

    if (primary.verdict === 'SUCCESS') {
      const rows = primary.data ?? []
      const threshold = this.store.getConstants().verification.listSafetyThreshold
      const hit = this.#scanForward(rows, target, identity.userId)
      if (hit) {
        return { outcome: hit.writer === 'self' ? 'FOUND_MINE' : 'FOUND_OTHERS', matched: hit, basis, summary: `admin 列表命中记录 #${hit.recordId}（${hit.userId === identity.userId ? '本人' : '他人'}）` }
      }
      // 未命中：超阈 → 查不清（绝不当"未生效"）；未超阈 → 确定未生效
      if (rows.length >= threshold) {
        return { outcome: 'INCONCLUSIVE', basis, summary: `全量列表 ${rows.length} 条超过安全阈值 ${threshold}，未命中不得当作"未生效"` }
      }
      return { outcome: 'NOT_FOUND', basis, summary: '全量列表未命中且未超阈值——确定未生效' }
    }

    // 首选路径失败 → 降级 mine（发起时身份）：未命中不能作结论（§五——它看不见别人的记录）
    const fallback = await this.gateway.call(plan.fallback.interface, {}, { initiatorIdentity: identity.id })
    if (fallback.verdict === 'SUCCESS') {
      const hit = this.#scanForward(fallback.data ?? [], target, identity.userId, { selfOnly: true })
      if (hit) {
        return { outcome: 'FOUND_MINE', matched: hit, basis: [{ fact: 'F5' }], summary: `mine 命中本人记录 #${hit.recordId}` }
      }
      return { outcome: 'INCONCLUSIVE', basis: [{ fact: 'F5' }], summary: 'mine 未命中——但它看不见别人的记录，不足以判"未生效"，保守查不清' }
    }
    return { outcome: 'INCONCLUSIVE', basis, summary: '查证路径（admin 列表与 mine）均不可用' }
  }

  /**
   * 补偿查证：按 recordId 定位（红线 31）。recordId 未知时调用方必须直接判 INCONCLUSIVE（不得猜）。
   * 返回 {outcome: 'FOUND'|'NOT_FOUND'|'INCONCLUSIVE', ...}——FOUND = 撤销已生效。
   */
  async verifyCompensate({ intent, recordId }) {
    if (recordId == null) {
      return { outcome: 'INCONCLUSIVE', summary: 'recordId 未知（提交时响应丢失）——不得猜，直接查不清（第 06 章 §8.1）' }
    }
    const plan = this.#verificationPlan(intent)
    const primary = await this.gateway.call(plan.primary.interface, {})
    if (primary.verdict !== 'SUCCESS') {
      return { outcome: 'INCONCLUSIVE', summary: '补偿查证列表不可用' }
    }
    const row = (primary.data ?? []).find((r) => r.recordId === recordId)
    if (!row || row.status !== 'ACTIVE') {
      // 查无此 id 或已 CANCELLED/EXPIRED——副作用已收敛，"撤销已生效"（§8.1 J3/D10 口径）
      return { outcome: 'FOUND', matched: row ?? null, basis: [{ fact: 'F4' }], summary: row ? `记录 #${recordId} 状态 ${row.status}（非生效中）` : `全量列表查无记录 #${recordId}` }
    }
    return { outcome: 'NOT_FOUND', matched: row, basis: [{ fact: 'F4' }], summary: `记录 #${recordId} 仍为 ACTIVE——撤销未生效` }
  }

  // Q1（写入者）+ Q2（时段重叠）同时成立才判"我此前已成功"；SEAT 行按 resourceName 前缀归并
  #scanForward(rows, target, userId, { selfOnly = false } = {}) {
    for (const row of rows) {
      if (row.status !== 'ACTIVE') continue
      if (!rangesOverlap(row.start, row.end, target.slot.start, target.slot.end)) continue
      const attributed =
        row.resourceType === 'CLASSROOM'
          ? row.resourceId === target.classroom.classroomId
          : seatRowAttribution(row, target.classroom)
      if (!attributed) continue
      const isSelf = row.userId === userId
      if (selfOnly && !isSelf) continue
      return { ...row, writer: isSelf ? 'self' : 'others' }
    }
    return null
  }
}
