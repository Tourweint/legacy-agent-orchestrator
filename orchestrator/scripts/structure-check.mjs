// 结构自检入口 —— 第 13 章阶段 0 交付物 7（第 04 章 §十一 的 8 条，逐字对齐三审定稿表）
//
// 它们检查"结构是否仍符合设计"，而不是"功能是否正常"——功能测试会报错，
// 结构被悄悄破坏不会报错，所以必须单独检查（第 04 章 §十一）。
// 执行时机：每次改动后（决策 B6）。自检不过不允许继续开发。
//
// 用法：node scripts/structure-check.mjs   （或 npm run check）

import { pathToFileURL } from 'node:url'
import { ConfigStore } from '../src/config/config-store.js'

const CHECKS = [
  '每个状态都能从初始态到达',
  '每个非终态都有出边（忽略型无边不算没有出边，§5.6/§5.9）',
  '每个 (状态 × 目的 × 载荷) 的出边事件不重复',
  '终态没有任何出边（含忽略型无边也不出现在终态）',
  '提交态的入边恰好三条，且每条可追溯到一次显式决策事件',
  '没有由 CALL_* 事件直通 DONE 的边（VERIFY_FOUND 经查证落 DONE 是刻意的，§5.3 注三）',
  '每个终态都至少有一条入边',
  '被标记"禁止自动编排"的接口不被任何计划引用',
]

// 提交态的三条入边（第 04 章 §六 约束一）：每条对应一次显式决策事件
const EXPECTED_SUBMITTING_IN_EDGES = new Set([
  'VALIDATING|PROPOSITIONS_OK', // I1：全部前置命题成立
  'VERIFYING|VERIFY_NOT_FOUND', // I2：已确定此前未生效
  'COMPENSATING|COMPENSATION_READY', // I6：已确定需要且可以撤销
])

function realEdges(sm) {
  return (sm.edges || []).filter((e) => !e.ignore)
}

function edgeKey(e) {
  return `${e.from}|${e.purpose ?? '*'}|${e.payload ?? '*'}|${e.event}`
}

function collectPlanReferences(plans) {
  const refs = []
  for (const intent of plans.intents || []) {
    const push = (id, where) => id && refs.push({ intent: intent.id, interface: id, where })
    for (const step of intent.steps || []) push(step.interface, 'steps')
    if (intent.verification) {
      push(intent.verification.primary?.interface, 'verification.primary')
      push(intent.verification.fallback?.interface, 'verification.fallback')
    }
    push(intent.compensation?.action, 'compensation.action')
  }
  return refs
}

/**
 * 执行 8 条结构自检。输入是纯数据（状态机表 / 注册表 / 意图计划），
 * 便于测试在内存中构造变异体验证"查得出违规"。
 */
export function runStructureChecks({ stateMachine, registry, plans }) {
  const sm = stateMachine
  const states = Object.keys(sm.states || {})
  const terminals = states.filter((s) => sm.states[s]?.class === 'terminal')
  const edges = realEdges(sm)
  const registryById = new Map((registry.interfaces || []).map((it) => [it.id, it]))
  const results = []

  const report = (no, pass, details = []) => {
    results.push({ no, name: CHECKS[no - 1], pass, details })
  }

  // 1. 每个状态都能从初始态到达
  {
    const adjacency = new Map(states.map((s) => [s, []]))
    for (const e of edges) adjacency.get(e.from)?.push(e.to)
    const visited = new Set([sm.initial])
    const queue = [sm.initial]
    while (queue.length > 0) {
      const current = queue.shift()
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next)
          queue.push(next)
        }
      }
    }
    const orphans = states.filter((s) => !visited.has(s))
    report(1, orphans.length === 0, orphans.map((s) => `孤立状态: ${s}`))
  }

  // 2. 每个非终态都有出边（"忽略型无边"不算没有出边：只看真实出边）
  {
    const dead = states
      .filter((s) => !terminals.includes(s))
      .filter((s) => !edges.some((e) => e.from === s))
    report(2, dead.length === 0, dead.map((s) => `死状态（无真实出边）: ${s}`))
  }

  // 3. 每个 (状态 × 目的 × 载荷) 的出边事件不重复
  {
    const groups = new Map()
    for (const e of edges) {
      const key = `${e.from}|${e.purpose ?? '*'}|${e.payload ?? '*'}`
      if (!groups.has(key)) groups.set(key, new Map())
      const byEvent = groups.get(key)
      byEvent.set(e.event, (byEvent.get(e.event) || 0) + 1)
    }
    const duplicates = []
    for (const [key, byEvent] of groups) {
      for (const [event, count] of byEvent) {
        if (count > 1) duplicates.push(`${key} × ${event} 出现 ${count} 次`)
      }
    }
    report(3, duplicates.length === 0, duplicates)
  }

  // 4. 终态没有任何出边（含忽略型无边也不出现在终态）
  {
    const violations = (sm.edges || []).filter((e) => terminals.includes(e.from))
    report(
      4,
      violations.length === 0,
      violations.map((e) => `终态 ${e.from} 出现边 ${e.event}`),
    )
  }

  // 5. SUBMITTING 的入边恰好三条，且每条可追溯到一次显式决策事件
  {
    const inEdges = edges.filter((e) => e.to === 'SUBMITTING')
    const distinct = new Set(inEdges.map((e) => `${e.from}|${e.event}`))
    const details = []
    if (distinct.size !== 3) details.push(`入边决策来源数为 ${distinct.size}（应为 3）`)
    for (const key of distinct) {
      if (!EXPECTED_SUBMITTING_IN_EDGES.has(key)) details.push(`意外的入边: ${key}`)
    }
    for (const key of EXPECTED_SUBMITTING_IN_EDGES) {
      if (!distinct.has(key)) details.push(`缺失的入边: ${key}`)
    }
    report(5, details.length === 0, details)
  }

  // 6. 没有由 CALL_* 事件直通 DONE 的边（UNKNOWN 必须先经查证，I3）
  {
    const violations = edges.filter((e) => /^CALL_/.test(e.event) && e.to === 'DONE')
    report(
      6,
      violations.length === 0,
      violations.map((e) => `${e.from} --${e.event}--> DONE`),
    )
  }

  // 7. 每个终态都至少有一条入边
  {
    const unreachable = terminals.filter((t) => !edges.some((e) => e.to === t))
    report(7, unreachable.length === 0, unreachable.map((s) => `永不可达的终态: ${s}`))
  }

  // 8. 被标记"禁止自动编排"的接口不被任何计划引用
  {
    const violations = []
    for (const ref of collectPlanReferences(plans)) {
      const it = registryById.get(ref.interface)
      if (!it) {
        violations.push(`意图 ${ref.intent} 引用了未纳管接口 ${ref.interface}（${ref.where}）`)
      } else if (!it.autoOrchestration) {
        violations.push(
          `意图 ${ref.intent} 引用了禁止自动编排的接口 ${ref.interface}（${ref.where}，M8/D2）`,
        )
      }
    }
    report(8, violations.length === 0, violations)
  }

  return { passed: results.every((r) => r.pass), results }
}

function printReport({ passed, results }) {
  console.log('结构自检（第 04 章 §十一，三审定稿口径，共 8 条）')
  console.log('='.repeat(64))
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL'
    console.log(`  ${r.no}. [${mark}] ${r.name}`)
    for (const detail of r.details) console.log(`       └─ ${detail}`)
  }
  console.log('='.repeat(64))
  const okCount = results.filter((r) => r.pass).length
  console.log(`结果：${okCount}/${results.length} 通过`)
  if (!passed) {
    console.log('自检不过不允许继续开发（决策 B6）。修正后重跑。')
  }
}

export function main() {
  const store = new ConfigStore()
  const outcome = runStructureChecks({
    stateMachine: store.getStateMachine(),
    registry: store.registry,
    plans: store.plans,
  })
  printReport(outcome)
  if (!outcome.passed) process.exitCode = 1
}

// 直接执行时跑 CLI；被测试导入时不自动执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
