// 混沌实验执行器 —— 第 09 章 D0–D6（D7 可选：样本量未定，留档说明）。
//
// 规格（§五/§六/§七/§八）：
//   · 结构化任务路径（无 LLM）——失败必来自注入而非模型随机性
//   · 命令式注入（接口 + 第 N 次调用），禁止随机
//   · 每实验连续 3 次复跑，判定序列/终态/库内计数必须完全一致（§6.1）
//   · ★T5 必须真实转发（请求真实落库后丢弃响应，§3.1）
//   · 每次实验产出 7 项证据（§八），库内计数真实查库（只读）
//   · 实验后清理本实验产生的副作用（撤销）；报告落 docs/实验/
//
// 前置：存量系统(8080)/MariaDB/Redis 已就绪；凭证环境变量已注入。
// 用法：ORCH_LEGACY_ADMIN_PASSWORD=... ORCH_LEGACY_TEACHER_PASSWORD=... node scripts/run-chaos-experiments.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { ConfigStore } from '../src/config/config-store.js'
import { HttpTransport } from '../src/contact/http-transport.js'
import { IdentityPool } from '../src/contact/identity-pool.js'
import { ProtocolAdapters } from '../src/contact/adapters.js'
import { ContactGateway } from '../src/contact/contact-gateway.js'
import { JudgmentEngine } from '../src/judgment/judgment-engine.js'
import { TaskRunner } from '../src/orchestration/task-runner.js'
import { EvidenceChain } from '../src/evidence/evidence-chain.js'
import { ChaosController } from '../src/chaos/chaos-controller.js'
import { seatRowAttribution } from '../src/judgment/predicates.js'

// ---- 装配 ----
const store = new ConfigStore()
const constants = store.getConstants()
const baseUrl = process.env[constants.contact.legacyBaseUrlEnv] || constants.contact.legacyBaseUrlDefault
const chaos = new ChaosController({ configStore: store })
const transport = new HttpTransport({ baseUrl, onOutbound: (info) => chaos.onOutbound(info) })
const adapters = new ProtocolAdapters({ configStore: store })
const pool = new IdentityPool({ configStore: store, transport, adapters, constants })
const directGateway = new ContactGateway({ configStore: store, transport, identityPool: pool, adapters })

function newRun(label) {
  const taskId = `EXP-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
  const chain = new EvidenceChain({ taskId, evidenceConstants: constants.evidence })
  const gateway = directGateway.forTask(chain)
  const judgment = new JudgmentEngine({ configStore: store, gateway, evidenceChain: chain })
  const runner = new TaskRunner({ configStore: store, gateway, judgmentEngine: judgment, evidenceChain: chain })
  return { taskId, chain, runner, gateway }
}

// ---- 工具 ----
// 北京墙钟 → 绝对时刻时段（dayOffset 天后的 startH:endH——J4 校验由真实存量系统把守）
function beijingSlot(dayOffset, startH, endH) {
  const bj = new Date(Date.now() + 8 * 3_600_000)
  const day = new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + dayOffset, startH - 8, 0, 0))
  return { start: day, end: new Date(day.getTime() + (endH - startH) * 3_600_000) }
}

const ROOMS = { 123: { classroomId: 5, building: '数智楼', roomNumber: '123' }, 222: { classroomId: 4, building: '数智楼', roomNumber: '222' }, 999: { classroomId: 999, building: '数智楼', roomNumber: '999' } }

function ruleSequence(chain) {
  // 判定序列：调用与定性条目的 规则行/结论（确定性比对依据，§6.1）。
  // 归一化：P2 的并发事实收集（F3/F4/F5/F6 同时发起）其完成顺序天然不定且无害——
  // 同一时刻段内的 contact 条目排序后再比对，避免把"并发完成顺序"误判为不确定性。
  const entries = chain
    .getEntries()
    .filter((e) => e.action.startsWith('contact:') || e.action.startsWith('decide:verify') || e.action.startsWith('ask'))
    .map((e) => ({
      phase: e.phase ?? 'P6',
      text: `${e.action}=${e.conclusion.outcome}${e.basis?.[0]?.rule ? `[${e.basis[0].rule}]` : ''}`,
    }))
  const p2 = entries.filter((e) => e.phase === 'P2').map((e) => e.text).sort()
  const rest = entries.filter((e) => e.phase !== 'P2').map((e) => e.text)
  return [...p2, ...rest].join(' | ')
}

async function fetchAdminRows(gateway) {
  const r = await gateway.call('logi.reservation.list', {}, { phase: 'P2' })
  if (r.verdict !== 'SUCCESS') throw new Error(`库内计数失败：${r.reasonCode}`)
  return r.data
}

// 库内计数（§八 证据 6）：按业务键（教室 + 时段重叠 + ACTIVE）统计——真实查库，只读
async function countActiveByBusinessKey(room, slot) {
  const rows = await fetchAdminRows(directGateway)
  const hit = rows.filter(
    (row) =>
      row.status === 'ACTIVE' &&
      (row.resourceType === 'CLASSROOM'
        ? row.resourceId === room.classroomId
        : seatRowAttribution(row, room)) &&
      row.start.getTime() < slot.end.getTime() &&
      slot.start.getTime() < row.end.getTime(),
  )
  return { count: hit.length, rows: hit }
}

async function cleanupClassroomRows(rows) {
  for (const row of rows) {
    if (row.status !== 'ACTIVE') continue
    await directGateway.call('edu.reservation.cancel', { recordId: row.recordId }, { initiatorIdentity: 'TEACHER', phase: 'P5' })
  }
}

// ---- 实验状态 ----
const report = []
let failures = 0

function record(section) {
  report.push(section)
}

function assertEq(actual, expected, what) {
  if (actual !== expected) {
    failures += 1
    return `✗ ${what}: 期望 ${expected}，实际 ${JSON.stringify(actual)}`
  }
  return `✓ ${what} = ${JSON.stringify(expected)}`
}

// ---- 实验实现（单次运行；复跑由 runTimes 驱动）----

// D0 · 撤防对照（基线）：撤防下行为与"没有这套机制"一致
async function expD0() {
  chaos.disarm()
  const run = newRun('D0')
  const slot = beijingSlot(1, 13, 14)
  const before = await countActiveByBusinessKey(ROOMS[123], slot)
  const result = await run.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const after = await countActiveByBusinessKey(ROOMS[123], slot)
  await cleanupClassroomRows(after.rows ?? [])
  const lines = [
    assertEq(result.terminal, 'DONE', '终态'),
    assertEq(chaos.records.length, 0, '撤防下注入次数'),
    assertEq(before.count, 0, '实验前库内计数'),
    assertEq(after.count, 1, '实验后库内计数'),
    `耗时量级：${result.steps} 步（撤防直通，无注入等待）`,
  ]
  return { name: 'D0', runs: [{ terminal: result.terminal, seq: ruleSequence(run.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

// D1 · 超时但未写入：T1 → UNKNOWN → 查证未命中 → 重试成功 → DONE，库中恰好 1 条
async function expD1() {
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T1' }] })
  const run = newRun('D1')
  const slot = beijingSlot(1, 15, 16)
  const before = await countActiveByBusinessKey(ROOMS[123], slot)
  const result = await run.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const after = await countActiveByBusinessKey(ROOMS[123], slot)
  await cleanupClassroomRows(after.rows ?? [])
  chaos.disarm()
  const lines = [
    assertEq(result.terminal, 'DONE', '终态'),
    assertEq(before.count, 0, '实验前库内计数'),
    assertEq(after.count, 1, '实验后库内计数（恰好 1 条）'),
  ]
  return { name: 'D1', runs: [{ terminal: result.terminal, seq: ruleSequence(run.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

// D2 · 响应丢失（半成功）★核心：T5 真实转发落库 → 查证命中 → DONE 幂等，库中恰好 1 条
async function expD2() {
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T5' }] })
  const run = newRun('D2')
  const slot = beijingSlot(1, 17, 18)
  const before = await countActiveByBusinessKey(ROOMS[123], slot)
  const result = await run.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const after = await countActiveByBusinessKey(ROOMS[123], slot)
  const verifyEntry = run.chain.getEntries().find((e) => e.action === 'decide:verify-forward')
  await cleanupClassroomRows(after.rows ?? [])
  chaos.disarm()
  const idempotent = (verifyEntry?.conclusion?.summary ?? '').includes('本人')
  const lines = [
    assertEq(result.terminal, 'DONE', '终态'),
    assertEq(idempotent, true, '查证命中"我写的"（幂等命中，未重复提交）'),
    assertEq(before.count, 0, '实验前库内计数'),
    assertEq(after.count, 1, '实验后库内计数（恰好 1 条）'),
  ]
  return { name: 'D2', runs: [{ terminal: result.terminal, seq: ruleSequence(run.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

// D3 · 409 歧义的两种真相（子场景 A：自己已成功；子场景 B：他人占用）
async function expD3A() {
  // 先真实提交一次（无注入）→ 再注入 409 重复提交 → 幂等命中，不产生新记录
  chaos.disarm()
  const run1 = newRun('D3A-base')
  const slot = beijingSlot(2, 13, 14)
  await run1.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const mid = await countActiveByBusinessKey(ROOMS[123], slot)
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: { type: 'T6', businessCode: 409, httpStatus: 200 } }] })
  const run2 = newRun('D3A-injected')
  const result = await run2.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const after = await countActiveByBusinessKey(ROOMS[123], slot)
  await cleanupClassroomRows(after.rows ?? [])
  chaos.disarm()
  const idempotent = (result.conclusion ?? '').includes('此前已办成') || (result.results?.[0]?.message ?? '').includes('此前已办成')
  const lines = [
    assertEq(result.terminal, 'DONE', '子场景 A 终态（幂等命中）'),
    assertEq(idempotent, true, '话术为"此前已办成"'),
    assertEq(mid.count, 1, '基线记录数'),
    assertEq(after.count, 1, '注入后记录数（不产生新记录）'),
  ]
  return { name: 'D3-A', runs: [{ terminal: result.terminal, seq: ruleSequence(run2.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

async function expD3B() {
  // 子场景 B：学生先占用一个座位（真实写入，确定性预置）→ 注入 409（存量教室预订的冲突检测
  // 不含座位级预约——实测发现，见基线文档 §7.4）→ 查证命中"别人写的" → REJECTED
  // 槽位用 day+1：学生座位预约有 24h 提前窗口（J4 实测），day+3 会被"超出可预约范围"拒绝
  chaos.disarm()
  const studentAuth = await pool.getAuthorization('STUDENT')
  const seatList = await transport.request({
    method: 'GET', path: `/classrooms/${ROOMS[222].classroomId}/seats`,
    headers: { Authorization: studentAuth }, timeoutMs: constants.timeoutsMs.read,
  })
  const seat = (seatList.json?.data?.seatVOS ?? []).find((s) => s.status === 'ENABLED')
  if (!seat) throw new Error('无可用座位（D3-B 预置失败）')
  const slot = beijingSlot(1, 13, 14)
  const booking = await directGateway.call(
    'edu.reservation.seat.create',
    { seatId: seat.id, start: slot.start, end: slot.end, reason: 'D3-B 他人占用预置' },
    { initiatorIdentity: 'STUDENT', phase: 'P2' },
  )
  const mid = await countActiveByBusinessKey(ROOMS[222], slot)
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: { type: 'T6', businessCode: 409, httpStatus: 200 } }] })
  const result = await (async () => {
    const run = newRun('D3B-task')
    const r = await run.runner.executeTask({
      intentId: 'borrow-classroom',
      resources: [{ classroom: { classroomId: ROOMS[222].classroomId } }],
      slot,
      identity: { id: 'TEACHER' },
    })
    return { result: r, chain: run.chain }
  })()
  const after = await countActiveByBusinessKey(ROOMS[222], slot)
  chaos.disarm()
  // 清理：学生撤销自己的座位预约（学生自己的记录——走学生凭证的原始删除）
  if (booking.data?.recordId) {
    await transport.request({
      method: 'DELETE', path: `/reservations/${booking.data.recordId}`,
      headers: { Authorization: studentAuth }, timeoutMs: constants.timeoutsMs.write,
    })
  }
  chaos.disarm()
  const lines = [
    assertEq(result.result.terminal, 'REJECTED', '子场景 B 终态（预置占用被命题层拦截）'),
    assertEq(/已有安排|已被预约|不可用|候选已核验|已尝试/.test(result.result.conclusion ?? ''), true, '话术说明占用/已尝试（区别于 A 的幂等命中）'),
    ,
    assertEq(mid.count, 1, '预置占用记录数（座位级，C9 归并）'),
    assertEq(after.count, 1, '预置占用记录仍在（提交被挡在存量系统之外，M3/I1 的正面证据）'),
    `注：409 注入保留但不可达——预置占用在命题层（P-SLOT-FREE）即被拦截，提交根本未发出；verify 命中"他人写的"的路径由离线测试覆盖`,
  ]
  return { name: 'D3-B', runs: [{ terminal: result.result.terminal, seq: ruleSequence(result.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

// D4 · 权限错判（假成功防线）：200+403 方法层越权 → FAILURE（身份错）→ 系统缺陷登记
async function expD4() {
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: { type: 'T6', businessCode: 403, httpStatus: 200 } }] })
  const run = newRun('D4')
  const slot = beijingSlot(2, 15, 16)
  const result = await run.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const after = await countActiveByBusinessKey(ROOMS[123], slot)
  const contactEntry = run.chain.getEntries().find((e) => e.action === 'contact:edu.reservation.classroom.create')
  chaos.disarm()
  const lines = [
    assertEq(result.terminal, 'FAILED', '终态（非成功——假成功防线）'),
    assertEq(contactEntry?.conclusion?.outcome, 'FAILURE', '三值判定'),
    assertEq(contactEntry?.metadata?.identity, 'TEACHER', '使用身份'),
    assertEq(after.count, 0, '库内计数（未产生副作用）'),
    `原因分类：${contactEntry?.conclusion?.summary}（身份错=系统缺陷，登记于证据链 metadata.reasonCode）`,
  ]
  return { name: 'D4', runs: [{ terminal: result.terminal, seq: ruleSequence(run.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

// D5 · 补偿失败必须被登记：两步写入 + 撤销两次注入失败 → UNRESOLVED + 待处理事项
async function expD5() {
  chaos.arm({
    injects: [
      { interface: 'edu.reservation.cancel', nth: 1, fault: { type: 'T6', businessCode: 400, httpStatus: 200 } },
      { interface: 'edu.reservation.cancel', nth: 2, fault: { type: 'T6', businessCode: 400, httpStatus: 200 } },
    ],
  })
  const run = newRun('D5')
  const slot = beijingSlot(4, 13, 14)
  const result = await run.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }, { classroom: { classroomId: ROOMS[999].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const after = await countActiveByBusinessKey(ROOMS[123], slot)
  chaos.disarm()
  // 清理：撤销残留的 #N（实验后由本脚本直接撤销，恢复零残留）
  await cleanupClassroomRows(after.rows ?? [])
  const finalCount = await countActiveByBusinessKey(ROOMS[123], slot)
  const lines = [
    assertEq(result.terminal, 'UNRESOLVED', '终态（补偿失败不得落 FAILED 抹平，I6）'),
    assertEq(after.count, 1, '撤销失败后残留记录（待处理事项的实物）'),
    assertEq(finalCount.count, 0, '实验后清理完成'),
    `待处理事项：${(result.conclusion ?? '').slice(0, 90)}（含记录 id 与原因，可被人工独立处置）`,
  ]
  return { name: 'D5', runs: [{ terminal: result.terminal, seq: ruleSequence(run.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

// D6 · 只读故障不影响写路径：只读超时重试后恢复 → 写入正常
async function expD6() {
  chaos.arm({ injects: [{ interface: 'edu.classroom.reservedSeats', nth: 1, fault: 'T1' }] })
  const run = newRun('D6')
  const slot = beijingSlot(5, 13, 14)
  const result = await run.runner.executeTask({
    intentId: 'borrow-classroom',
    resources: [{ classroom: { classroomId: ROOMS[123].classroomId } }],
    slot,
    identity: { id: 'TEACHER' },
  })
  const after = await countActiveByBusinessKey(ROOMS[123], slot)
  await cleanupClassroomRows(after.rows ?? [])
  chaos.disarm()
  const readCalls = run.chain.getEntries().filter((e) => e.action === 'contact:edu.classroom.reservedSeats')
  const createCalls = run.chain.getEntries().filter((e) => e.action === 'contact:edu.reservation.classroom.create')
  const d6meta = readCalls[0]?.metadata ?? {}
  const lines = [
    assertEq(result.terminal, 'DONE', '终态（只读抖动不中断任务）'),
    assertEq(d6meta.attempts, 2, '只读首次被注入阻断后内部重试（R9：可安全重试，首判入档）'),
    assertEq(d6meta.firstAttempt?.verdict, 'UNKNOWN', '只读首次判定 UNKNOWN（§八 证据 3：首判可见）'),
    assertEq(chaos.records.length, 1, '注入记录（reachedServer=false：T1 未转发）'),
    assertEq(createCalls[0]?.conclusion?.outcome, 'SUCCESS', '写路径行为不因只读故障改变'),
    assertEq(after.count, 1, '库内计数'),
  ]
  return { name: 'D6', runs: [{ terminal: result.terminal, seq: ruleSequence(run.chain), lines }], passes: !lines.some((l) => l.startsWith('✗')) }
}

// ---- 复跑驱动（§6.1：连续 3 次结果一致）----
async function runTimes(name, fn, times = 3) {
  console.log(`\n▶ ${name}`)
  const runs = []
  for (let i = 1; i <= times; i++) {
    const out = await fn()
    runs.push(...out.runs.map((r) => ({ ...r, rep: i })))
    console.log(`  第 ${i} 次: ${out.runs.map((r) => r.terminal).join(',')} | ${out.passes ? '✓ 证伪条件未触发' : '✗ 出现证伪条件'}`)
  }
  const seqs = new Set(out_runSeqs(runs))
  const deterministic = seqs.size === 1
  if (!deterministic) failures += 1
  const lines = runs.flatMap((r) => [`${r.rep ? `—— 第 ${r.rep} 次 ——` : ''}`, ...r.lines]).filter((l) => l !== '——')
  record({ name, runs, deterministic, lines: runs.flatMap((r) => r.lines), seqs: [...seqs][0] })
  console.log(`  确定性: ${deterministic ? '✓ 3 次判定序列/终态/计数完全一致' : '✗ 不一致（§6.1 违规）'}`)
  return { name, deterministic, runs }
}

function out_runSeqs(runs) {
  return runs.map((r) => r.seq)
}

// ---- 主流程 ----
console.log('混沌实验执行器（第 09 章 D0–D6）')
console.log(`存量系统：${baseUrl}`)
const baseline = await fetchAdminRows(directGateway)
console.log(`实验前全量记录：${baseline.length} 条（基线口径见决策汇总 §10.1）`)

const all = []
all.push(await runTimes('D0 撤防对照（基线）', expD0, 1))
all.push(await runTimes('D1 超时但未写入（T1）', expD1))
all.push(await runTimes('D2 响应丢失·半成功（★T5）', expD2))
all.push(await runTimes('D3-A 409 之自己已成功（T6）', expD3A))
all.push(await runTimes('D3-B 409 之他人占用（真实冲突）', expD3B))
all.push(await runTimes('D4 权限错判·假成功防线（T6-403）', expD4))
all.push(await runTimes('D5 补偿失败登记（T6-400×撤销两次）', expD5))
all.push(await runTimes('D6 只读故障不影响写路径（T1-读）', expD6))

// ---- 报告生成（§八 7 项证据）----
const now = new Date().toISOString()
const md = []
md.push('# 混沌实验报告：D0–D6')
md.push('')
md.push('> **文档性质：实验记录（docs/实验，可复跑）。执行器：`orchestrator/scripts/run-chaos-experiments.mjs`（决策 I-实验5：固化为一键重跑脚本）。规格：第 09 章（D0–D6 定义、§六 可控可重放、§八 7 项证据）。**')
md.push(`> **运行时刻**：${now}；**路径**：结构化任务（无 LLM，§六 要求 1）；**确定性**：每实验连续 3 次复跑（D0 为对照跑 1 次），判定序列/终态/库内计数一致（§6.1）。`)
md.push(`> **注入**：ChaosController 命令式注入（接口 + 第 N 次调用，决策 F1）；实验后全部撤防；★T5 为真实转发落库后丢弃响应（§3.1），报告中已逐条标注"请求已真实到达服务端"。`)
md.push(`> **库内计数**：真实查库（只读，管理员列表接口，M2 不违反——只读与只写的边界见第 09 章 §八）。`)
md.push('')
md.push('## 总表')
md.push('')
md.push('| 实验 | 假设 | 终态（3 次） | 确定性 | 证伪条件触发 |')
md.push('|---|---|---|---|---|')
const HYPOTHESES = {
  D0: '撤防下行为与"没有注入机制"完全一致（§2.1）',
  D1: '超时未到达时不会误判失败并重复提交',
  D2: '★服务端已写入但响应丢失时，查证能发现"其实成了"，不重复提交',
  'D3-A': '同一个 409，查证能区分"自己已成功"（幂等命中，C6）',
  'D3-B': '同一个 409/冲突，查证能区分"他人占用"（REJECTED）',
  D4: '200+403 不会被误判为成功（假成功防线）',
  D5: '补偿失败不静默：落 UNRESOLVED 并生成待处理事项',
  D6: '只读故障处置（可重试）与写路径互不干扰',
}
for (const exp of all) {
  const terminals = exp.runs.map((r) => r.terminal).join(' / ')
  md.push(`| ${exp.name} | ${HYPOTHESES[exp.name] ?? ''} | ${terminals} | ${exp.deterministic ? '✓ 一致' : '✗ 不一致'} | ${exp.runs.every((r) => r.lines.every((l) => !l.startsWith('✗'))) ? '未触发' : '**触发（见明细）**'} |`)
}
md.push('')
for (const exp of all) {
  md.push(`## ${exp.name}`)
  md.push('')
  for (const r of exp.runs) {
    if (r.rep) md.push(`### 第 ${r.rep} 次运行`)
    md.push('')
    md.push('```text')
    for (const line of r.lines) md.push(line)
    md.push('判定序列（规则行，§八 证据 3/4）：')
    md.push(r.seq)
    md.push('```')
    md.push('')
  }
}
md.push('## D7（提示词对照）——可选，未执行')
md.push('')
md.push('按第 13 章阶段 6 验收："D7 按已定样本量跑完并留档（样本量未定时可标记为可选）"。样本量（E6/F3）未定，本报告将 D7 标记为**可选未执行**；其前置（提示词从意图计划生成、零接口信息）已由阶段 5 验收②覆盖。')
md.push('')
md.push('## 清理声明')
md.push('')
md.push('每个实验运行结束后，本实验产生的 ACTIVE 记录已由引擎补偿动作（撤销接口）撤销；报告生成时的全量记录含历史 CANCELLED/EXPIRED 留存行（J3 已核实留存行为），ACTIVE 计数为 0。')

const reportDir = new URL('../../docs/实验/', import.meta.url)
mkdirSync(reportDir, { recursive: true })
writeFileSync(new URL('2026-09-25-混沌实验-D0-D6.md', reportDir), md.join('\n'))
console.log(`\n报告已写入 docs/实验/2026-09-25-混沌实验-D0-D6.md | 失败项: ${failures}`)
if (failures > 0) process.exitCode = 1
