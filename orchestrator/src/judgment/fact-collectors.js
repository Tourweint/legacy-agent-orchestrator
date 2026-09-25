// 事实收集与加工 —— 第 08 章 §二（六事实）/§三（三态）/§2.2（加工口径，禁止别处另定）。
//
// 事实不是一个值，是带状态的对象：
//   obtained       拿到了，且口径已归一（可带 meta.ambiguous 附加标记——歧义不是第四种状态）
//   unobtainable   尝试了拿不到（查询失败）——不得当作"不成立"，也不得当作"成立"
//   not-applicable 该场景下本来就不需要（如教室未解析时，依赖教室 id 的事实）
//
// 收集顺序（§6.3）：F1 串行（一切的前提）；F3/F4/F5/F6 相互独立可并发（数量固定有界，M5）。
// 判定层不发任何写请求——只读也统一经接触层（决策 A3）。

import { normalizeSpace } from './predicates.js'

function obtained(value, meta = {}) {
  return { state: 'obtained', value, meta }
}
function unobtainable(result, summary, reasonCode) {
  return { state: 'unobtainable', value: null, meta: {}, reasonCode: reasonCode ?? result?.reasonCode ?? 'unknown', summary }
}
function notApplicable(summary) {
  return { state: 'not-applicable', value: null, meta: {}, summary }
}

export class FactCollector {
  constructor({ configStore, gateway, evidenceChain = null }) {
    this.store = configStore
    this.gateway = gateway
    this.evidenceChain = evidenceChain
  }

  /**
   * @param {object} params
   * @param {string[]} params.factIds            要收集的事实（由命题依赖驱动）
   * @param {object} params.target               { classroom: {classroomId?|building+roomNumber?}, slot, seatId? }
   * @param {object} params.identity             { id, userId }
   * @param {object} [params.precollected]       已有事实快照（J6 轮内共用；跳过重复收集）
   */
  async collect({ factIds, target, identity, precollected = {} }) {
    const facts = {}
    const pending = []

    // F1 串行在前：其余依赖教室 id 的事实以它为前提（§6.3）
    if (factIds.includes('F1')) {
      facts.F1 = precollected.F1 ?? (await this.#collectOne('F1', { target, identity, facts }))
    }
    for (const id of factIds) {
      if (id === 'F1') continue
      if (precollected[id]) {
        facts[id] = precollected[id]
        continue
      }
      pending.push([id, this.#collectOne(id, { target, identity, facts })])
    }
    // 数量固定（≤5）且有界，不做无界并发（第 01 章 M5）
    for (const [id, promise] of pending) {
      facts[id] = await promise
    }
    for (const id of factIds) {
      if (!facts[id]) facts[id] = notApplicable('未列入收集清单')
    }
    this.#recordEvidence(facts, factIds)
    return { facts }
  }

  async #collectOne(id, { target, identity, facts }) {
    switch (id) {
      case 'F1': return this.#collectClassroomDetail(target)
      case 'F2': return this.#collectSeatLayout(target, facts)
      case 'F3': return this.#collectOccupiedSeats(target, facts)
      case 'F4': return this.#collectAdminReservations()
      case 'F5': return this.#collectMyReservations(identity)
      case 'F6': return this.#collectMaintenanceWindows(target, facts)
      default: return notApplicable(`未知事实 ${id}`)
    }
  }

  // F1 教室详情（实体消解落点）：有 id 直接查；只有人读名时经 available_list 按楼栋拉列表再匹配房间号。
  // 已知局限（如实登记）：available_list 只返回启用教室——"存在但停用"的教室会表现为"未找到"，
  // 两种情形都被 EXISTS 拒绝，结局保守一致；话术里的"现有教室"来自同一次列表。
  async #collectClassroomDetail(target) {
    const classroom = target.classroom ?? {}
    if (classroom.classroomId != null) {
      const r = await this.gateway.call('edu.classroom.detail', { classroomId: classroom.classroomId }, { phase: 'P2' })
      if (r.verdict !== 'SUCCESS') return unobtainable(r, '教室详情查询未成功')
      return obtained(
        {
          classroomId: r.data.classroomId,
          building: r.data.building,
          roomNumber: r.data.roomNumber,
          capacity: r.data.capacity,
          status: r.data.status,
        },
        { resolved: true, via: 'id' },
      )
    }
    if (classroom.building && classroom.roomNumber) {
      const r = await this.gateway.call('edu.classroom.available', {
        building: classroom.building,
        minCapacity: 0,
      }, { phase: 'P2' })
      if (r.verdict !== 'SUCCESS') return unobtainable(r, '教室列表查询未成功')
      const candidates = r.data ?? []
      const wanted = normalizeSpace(classroom.roomNumber)
      const matches = candidates.filter((c) => normalizeSpace(c.roomNumber) === wanted)
      if (matches.length === 1) {
        const d = await this.gateway.call('edu.classroom.detail', { classroomId: matches[0].classroomId }, { phase: 'P2' })
        if (d.verdict !== 'SUCCESS') return unobtainable(d, '教室详情查询未成功')
        return obtained(
          {
            classroomId: d.data.classroomId,
            building: d.data.building,
            roomNumber: d.data.roomNumber,
            capacity: d.data.capacity,
            status: d.data.status,
          },
          { resolved: true, via: 'name-lookup' },
        )
      }
      // 0 个（或防御性的多个）匹配：查询成功但解析未果 → obtained + 未解析。
      // 这是"找到=查到了但结果是负的"，不是"查不到"——EXISTS 据此拒绝并列出可用项（§5.1 话术）
      return obtained(null, {
        resolved: false,
        via: 'name-lookup',
        ambiguousMatches: matches.length > 1,
        candidates,
      })
    }
    return unobtainable(null, '缺少教室标识（id 或 楼栋+房间号）', 'no-target-identifier')
  }

  // F2 座位布局（非主链路，默认不收集；形状宽容提取，提取不出按"不可得"保守处理）
  async #collectSeatLayout(target, facts) {
    const classroomId = facts.F1?.value?.classroomId
    if (!classroomId) return notApplicable('需要先解析出教室 id（F1）')
    const r = await this.gateway.call('edu.classroom.seats', { classroomId }, { phase: 'P2' })
    if (r.verdict !== 'SUCCESS') return unobtainable(r, '座位布局查询未成功')
    const raw = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.seats) ? r.data.seats : null
    if (raw === null) return unobtainable(null, '座位布局响应形状未知', 'seat-layout-shape-unknown')
    return obtained(
      { seats: raw.map((s) => ({ seatId: s.id ?? s.seatId, seatNumber: s.seatNumber, status: s.status })) },
      {},
    )
  }

  // F3 该时段被占座位：读写粒度不一致——返回座位 id 数组，占用数 > 0 即视为整间不可用（§2.2）；
  // 占用数 ≥ 容量（返回全量座位）原因二义，必须带歧义标记（容量未知时保守：有占用即标记）
  async #collectOccupiedSeats(target, facts) {
    const classroomId = facts.F1?.value?.classroomId
    if (!classroomId) return notApplicable('需要先解析出教室 id（F1）')
    const r = await this.gateway.call('edu.classroom.reservedSeats', {
      classroomId,
      start: target.slot.start,
      end: target.slot.end,
    }, { phase: 'P2' })
    if (r.verdict !== 'SUCCESS') return unobtainable(r, '时段占用查询未成功')
    const capacity = facts.F1?.value?.capacity
    const count = r.data.occupiedSeatCount
    return obtained(
      { seatIds: r.data.seatIds, occupiedSeatCount: count },
      { ambiguous: capacity != null ? count >= capacity : count > 0, capacityKnown: capacity != null },
    )
  }

  // F4 跨身份预约列表（查证支点）：不带 keyword（基线实测，适配器层已硬禁）；
  // 安全阈值（C5/§五.4）：超阈仍比对，但"未命中"不得当作"空闲"——由命题的 satisfiedDowngradeWhen 消化
  async #collectAdminReservations() {
    const r = await this.gateway.call('logi.reservation.list', {}, { phase: 'P2' })
    if (r.verdict !== 'SUCCESS') return unobtainable(r, '跨身份预约列表查询未成功')
    const threshold = this.store.getConstants().verification.listSafetyThreshold
    const rows = r.data ?? []
    return obtained(rows, {
      total: rows.length,
      activeCount: rows.filter((x) => x.status === 'ACTIVE').length,
      thresholdExceeded: rows.length >= threshold,
      threshold,
      attribution: 'SEAT 行经 resourceName 前缀匹配归并（基线 §8.4），CLASSROOM 行按 resourceId',
    })
  }

  // F5 我的预约：只含当前身份的 ACTIVE 记录——查证必须用发起写入时的同一身份（initiator）
  async #collectMyReservations(identity) {
    if (!identity?.id) return unobtainable(null, '缺少发起时身份', 'no-initiator-identity')
    const r = await this.gateway.call('edu.reservation.mine', {}, { phase: 'P2' })
    if (r.verdict !== 'SUCCESS') return unobtainable(r, '我的预约查询未成功')
    return obtained(r.data ?? [], { total: (r.data ?? []).length })
  }

  // F6 维修窗口：生效中的判定（失效集合排除法）在谓词层做——这里原样保留全部行
  async #collectMaintenanceWindows(target, facts) {
    const classroomId = facts.F1?.value?.classroomId
    if (!classroomId) return notApplicable('需要先解析出教室 id（F1）')
    const r = await this.gateway.call('logi.maintenance.list', { classroomId }, { phase: 'P2' })
    if (r.verdict !== 'SUCCESS') return unobtainable(r, '维修窗口查询未成功')
    return obtained(r.data ?? [], { total: (r.data ?? []).length })
  }

  // 每次收集尝试入证据链（I4）：依据=事实标识；结论=三态。值本身不进链（可能很大）
  #recordEvidence(facts, factIds) {
    if (!this.evidenceChain) return
    for (const id of factIds) {
      const fact = facts[id]
      if (!fact) continue
      this.evidenceChain.record({
        phase: 'P2',
        action: `collect-fact:${id}`,
        input: { fact: id },
        basis: [{ fact: id }],
        conclusion: {
          outcome: fact.state.toUpperCase(),
          summary: fact.summary ?? fact.reasonCode ?? (fact.state === 'obtained' ? '已获得' : ''),
        },
        metadata: { ...fact.meta },
      })
    }
  }
}
