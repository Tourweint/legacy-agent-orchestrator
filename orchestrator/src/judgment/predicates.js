// 判定算子库 —— 命题的"技术词表"（第 08 章 §六：事实→命题是数据关系）。
// 新增算子 = 代码（需要有新的事实形状/比较方式时）；新增命题 = propositions.yaml 加一节（零代码）。
//
// 求值结果：{ satisfied, label?, matched?, value? }——
//   label    失败叶子的 as 标签，用于路由命题的分支失败话术（violatedMessages）
//   matched  命中的记录（重叠记录/维修窗口），供话术渲染与 J2 追加条件使用

import { rangesOverlap, describeRange } from '../canonical/time.js'
import { JudgmentError } from './judgment-error.js'

export function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * SEAT 行到目标教室的归属判定（基线 §8.4 登记的口径）：
 * 列表响应不含 classroom_id，SEAT 行的教室只能经 resourceName 得到——
 * 源码拼接格式为 `building + ' ' + roomNumber + ' ' + seatNumber`（AdminServiceImpl），
 * 故用目标教室的 building+roomNumber 做前缀匹配（后随空格或行尾，避免 '12' 误配 '123'）。
 * 派生路径必须随证据链留档。
 */
export function seatRowAttribution(row, classroom) {
  if (!classroom?.building || !classroom?.roomNumber) return false
  const prefix = normalizeSpace(`${classroom.building} ${classroom.roomNumber}`)
  const name = normalizeSpace(row.resourceName)
  return name === prefix || name.startsWith(prefix + ' ')
}

function dotted(obj, path) {
  return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

function getFact(ctx, factId) {
  const fact = ctx.facts[factId]
  if (!fact) throw new JudgmentError(`事实未收集: ${factId}`)
  return fact
}

function asLabel(expr, inner) {
  return expr.as ?? inner?.label
}

/**
 * 目标记录的编号（C7）：编排层把"当前目标"挂在 target.classroom 下（教室型意图的历史形状），
 * 记录型意图的 recordId 也在其中；两种写法都认，避免算子依赖某一种挂法。
 */
function targetRecordId(ctx) {
  return ctx.target?.classroom?.recordId ?? ctx.target?.recordId ?? null
}

/**
 * 求值谓词表达式。表达式是纯数据（来自 propositions.yaml），算子是封闭集合。
 * 组合算子（all/any/not）直接以键名出现，不带 op 字段——如 {all: [...]}、{not: {...}}。
 */
export function evaluatePredicate(expr, ctx) {
  if (!expr || typeof expr !== 'object') {
    throw new JudgmentError(`谓词表达式非法: ${JSON.stringify(expr)}`)
  }
  const key = expr.op ?? ('all' in expr ? 'all' : 'any' in expr ? 'any' : 'not' in expr ? 'not' : null)
  if (!key) {
    throw new JudgmentError(`谓词表达式非法（缺算子）: ${JSON.stringify(expr)}`)
  }
  const handler = HANDLERS[key]
  if (!handler) throw new JudgmentError(`未知的判定算子: ${key}（新增算子须走代码与变更记录）`)
  const result = handler(expr, ctx)
  // 自身的 as 标签随结果传播——失败叶子的标签用于路由命题的分支失败话术
  return { ...result, label: result.label ?? expr.as }
}

const HANDLERS = {
  // ── 组合 ──────────────────────────────────────────────────────────────────
  all: (expr, ctx) => {
    for (const child of expr.all) {
      const result = evaluatePredicate(child, ctx)
      if (!result.satisfied) {
        return { satisfied: false, label: asLabel(child, result), matched: result.matched, value: result.value }
      }
    }
    return { satisfied: true }
  },
  any: (expr, ctx) => {
    let last = { satisfied: false }
    for (const child of expr.any) {
      const result = evaluatePredicate(child, ctx)
      if (result.satisfied) return { satisfied: true, matched: result.matched }
      last = result
    }
    return { satisfied: false, label: asLabel(expr, last) }
  },
  not: (expr, ctx) => {
    const inner = evaluatePredicate(expr.not, ctx)
    // matched 穿透：not(overlap-exists) 失败时，命中的记录正是话术需要的
    return { satisfied: !inner.satisfied, label: asLabel(expr, inner), matched: inner.matched }
  },

  // ── 事实状态 ──────────────────────────────────────────────────────────────
  'fact-obtained': (expr, ctx) => ({ satisfied: getFact(ctx, expr.fact).state === 'obtained' }),
  'classroom-known': (_expr, ctx) => {
    const f1 = ctx.facts.F1
    return { satisfied: f1?.state === 'obtained' && f1.value?.classroomId != null }
  },
  'classroom-unknown': (_expr, ctx) => {
    const f1 = ctx.facts.F1
    return { satisfied: f1?.state === 'obtained' && f1.value?.classroomId == null }
  },

  // ── 值比较 ────────────────────────────────────────────────────────────────
  // 教室 status 的"未标注视为启用"（C1）：null 与 '' 等价后参与集合 membership
  'value-in-set': (expr, ctx) => {
    const raw = dotted(getFact(ctx, expr.fact).value, expr.path)
    const set = dotted(ctx.constants, expr.set) ?? []
    const normalized = raw ?? ''
    return { satisfied: set.includes(normalized), value: raw }
  },
  'value-at-least': (expr, ctx) => {
    const value = dotted(getFact(ctx, expr.fact).value, expr.path)
    return { satisfied: typeof value === 'number' && value >= expr.value }
  },

  // ── 占用与重叠（第 06 章 §6.4：严格不等号；第 08 章 §2.2：J3 过滤口径）────────
  'seat-count-nonzero': (expr, ctx) => {
    const f3 = getFact(ctx, 'F3')
    return { satisfied: f3.state === 'obtained' && (f3.value?.occupiedSeatCount ?? 0) > 0 }
  },
  'overlap-exists': (expr, ctx) => {
    const fact = getFact(ctx, expr.fact)
    if (fact.state !== 'obtained') throw new JudgmentError(`算子 overlap-exists 要求 ${expr.fact} 已获得`)
    const writer = expr.writer ?? 'any'
    if (writer === 'self' && ctx.identity?.userId == null) {
      // 没有发起身份的数字 id 就无法做"写入者=本人"比对——宁可无法确认，不可误判成立
      throw new JudgmentError('缺少发起身份的 userId，无法做写入者匹配（Q1）')
    }
    for (const row of fact.value ?? []) {
      if (row.status !== 'ACTIVE') continue // J3：仅计 ACTIVE，已撤销/已过期一律排除
      if (!rangesOverlap(row.start, row.end, ctx.target.slot.start, ctx.target.slot.end)) continue
      const attributed =
        row.resourceType === 'CLASSROOM'
          ? row.resourceId === ctx.target.classroom?.classroomId
          : seatRowAttribution(row, ctx.target.classroom)
      if (!attributed) continue
      const isSelf = writer === 'self' ? row.userId == null || row.userId === ctx.identity.userId : true
      if (isSelf) return { satisfied: true, matched: row }
    }
    return { satisfied: false }
  },
  // C7：目标记录在"我的记录"里（撤销前的守卫——只能撤自己的，且必须是生效中的那条）
  // 与 overlap-exists 的区别：它问的是"这条记录是不是我的、还生效吗"，不是"这个时段被占了吗"。
  'record-in-mine': (expr, ctx) => {
    const fact = getFact(ctx, expr.fact)
    if (fact.state !== 'obtained') throw new JudgmentError(`算子 record-in-mine 要求 ${expr.fact} 已获得`)
    const recordId = targetRecordId(ctx)
    if (recordId == null) throw new JudgmentError('算子 record-in-mine 需要目标记录已定位（recordId）')
    const row = (fact.value ?? []).find((r) => r.recordId === recordId)
    return { satisfied: Boolean(row) && row.status === 'ACTIVE', matched: row ?? null }
  },
  'record-unknown': (_expr, ctx) => targetRecordId(ctx) == null,
  // C8：目标时段是否可办——**排除本人待改期的那条记录**（否则会被自己判成"被占"）。
  // satisfied = 没有冲突（命题成立）。
  'no-overlap-excluding-self': (expr, ctx) => {
    const fact = getFact(ctx, expr.fact)
    if (fact.state !== 'obtained') throw new JudgmentError(`算子 no-overlap-excluding-self 要求 ${expr.fact} 已获得`)
    const selfRecordId = targetRecordId(ctx)
    const classroom = ctx.target?.classroom ?? {}
    const classroomId = classroom.resourceId ?? classroom.classroomId ?? null
    const slot = ctx.target?.slot
    if (!slot?.start || !slot?.end) throw new JudgmentError('算子 no-overlap-excluding-self 需要目标时段（slot）')
    for (const row of fact.value ?? []) {
      if (row.status !== 'ACTIVE') continue // J3：仅计 ACTIVE
      if (selfRecordId != null && row.recordId === selfRecordId) continue // ★ 排除自己那条
      if (classroomId != null && row.resourceType === 'CLASSROOM' && row.resourceId !== classroomId) continue
      if (rangesOverlap(row.start, row.end, slot.start, slot.end)) return { satisfied: false, matched: row }
    }
    return { satisfied: true }
  },
  'maintenance-overlaps': (expr, ctx) => {
    const fact = getFact(ctx, expr.fact)
    if (fact.state !== 'obtained') throw new JudgmentError(`算子 maintenance-overlaps 要求 ${expr.fact} 已获得`)
    const invalidSet = dotted(ctx.constants, 'maintenanceInvalidStates') ?? []
    for (const window of fact.value ?? []) {
      // 排除法（保守优先）：不在失效集合中即视为生效中——存量系统新增状态时未登记即拦
      if (invalidSet.includes(window.status)) continue
      if (!rangesOverlap(window.start, window.end, ctx.target.slot.start, ctx.target.slot.end)) continue
      const attributed =
        window.classroomId === ctx.target.classroom?.classroomId ||
        (window.resourceType === 'CLASSROOM' && window.resourceId === ctx.target.classroom?.classroomId)
      if (attributed) return { satisfied: true, matched: window }
    }
    return { satisfied: false }
  },

  // ── 座位粒度（非主链路）────────────────────────────────────────────────────
  'seat-present': (_expr, ctx) => {
    const f2 = ctx.facts.F2
    const seatId = ctx.target.seatId
    return { satisfied: f2?.state === 'obtained' && (f2.value?.seats ?? []).some((s) => s.seatId === seatId) }
  },
  'seat-free': (_expr, ctx) => {
    const f3 = ctx.facts.F3
    return {
      satisfied: f3?.state === 'obtained' && !(f3.value?.seatIds ?? []).includes(ctx.target.seatId),
    }
  },

  // ── 附加条件 ──────────────────────────────────────────────────────────────
  // J2：申请区间超出已有时段（部分重叠未覆盖）——只在前置命题 violated 且有 matched 记录时求值
  'slot-exceeds-matched': (_expr, ctx) => {
    const matched = ctx.matched
    if (!matched?.start || !matched?.end) return { satisfied: false }
    return {
      satisfied:
        ctx.target.slot.start.getTime() < matched.start.getTime() ||
        ctx.target.slot.end.getTime() > matched.end.getTime(),
    }
  },
  'list-threshold-exceeded': (expr, ctx) => {
    return { satisfied: getFact(ctx, expr.fact).meta?.thresholdExceeded === true }
  },
}

/** 话术渲染：{{路径}} 占位符（点路径取值；缺失渲染为"(未知)"）。 */
export function renderTemplate(template, vars) {
  return String(template ?? '').replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const value = dotted(vars, path)
    return value === undefined || value === null ? '(未知)' : String(value)
  })
}

/** 已有记录的人可读时段（J2：幂等命中话术必须完整给出已有记录的时段）。 */
export function matchedSlotText(matched, timeOptions) {
  if (!matched?.start || !matched?.end) return '(未知时段)'
  return describeRange(matched.start, matched.end, timeOptions)
}
