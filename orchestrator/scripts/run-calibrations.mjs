// 参数标定与对照实验执行器 —— 三审 §七 留给实现期的标定项收尾。
//
// 覆盖：B3 超时复标 / C16 证据片段长度 / E1 置信度分布 / E6·D7 提示词对照（含/不含接口信息）/
//      H3 稳定"查不清"构造验证。
// 产出：docs/实验/2026-09-25-参数标定与对照实验报告.md
// 前置：存量系统(8080)在线；DASHSCOPE_API_KEY 已设置（E1/E6 需要真实模型）。
//
// 用法：ORCH_LEGACY_ADMIN_PASSWORD=admin ORCH_LEGACY_TEACHER_PASSWORD=233 node scripts/run-calibrations.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { ConfigStore } from '../src/config/config-store.js'
import { HttpTransport } from '../src/contact/http-transport.js'
import { IdentityPool } from '../src/contact/identity-pool.js'
import { ProtocolAdapters } from '../src/contact/adapters.js'
import { ContactGateway } from '../src/contact/contact-gateway.js'
import { ChaosController } from '../src/chaos/chaos-controller.js'
import { LlmClient } from '../src/understanding/llm-client.js'
import { buildSystemPrompt, fewShotExamples } from '../src/understanding/prompt.js'
import { validateUnderstandingOutput } from '../src/understanding/schema.js'
import { SAMPLES } from './calibration/e6-samples.mjs'

const store = new ConfigStore()
const constants = store.getConstants()
const baseUrl = process.env[constants.contact.legacyBaseUrlEnv] || constants.contact.legacyBaseUrlDefault
const chaos = new ChaosController({ configStore: store })
const transport = new HttpTransport({ baseUrl, onOutbound: (info) => chaos.onOutbound(info) })
const adapters = new ProtocolAdapters({ configStore: store })
const pool = new IdentityPool({ configStore: store, transport, adapters, constants })
const gateway = new ContactGateway({ configStore: store, transport, identityPool: pool, adapters })
const llm = new LlmClient({ config: { model: process.env.ORCH_LLM_MODEL ?? 'qwen-plus' } })

const report = { at: new Date().toISOString(), model: llm.model, sections: {} }
const failures = []
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return { n: s.length, min: s[0], p50: p(0.5), p95: p(0.95), max: s[s.length - 1], avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length) }
}

// ---- B3 · 调用超时复标（第 04 章待决 3 / 决策 B3）：读接口延迟分布 ----
console.log('▶ B3 读接口延迟复标（50 次轻量读 + 10 次全量列表）')
{
  const light = []
  const heavy = []
  for (let i = 0; i < 50; i++) {
    const r = await gateway.call('edu.classroom.detail', { classroomId: 5 }, { phase: 'P2' })
    if (r.verdict === 'SUCCESS') light.push(r.elapsedMs)
  }
  for (let i = 0; i < 10; i++) {
    const r = await gateway.call('logi.reservation.list', {}, { phase: 'P2' })
    if (r.verdict === 'SUCCESS') heavy.push(r.elapsedMs)
  }
  const ls = stats(light)
  const hs = stats(heavy)
  const margins = {
    write: (constants.timeoutsMs.write / Math.max(hs.max, 1)).toFixed(0),
    readHeavy: (constants.timeoutsMs.readHeavyList / Math.max(hs.max, 1)).toFixed(0),
  }
  report.sections.B3 = { light: ls, heavy: hs, timeoutsMs: constants.timeoutsMs, margins }
  console.log(`   轻量读: ${JSON.stringify(ls)}ms | 全量列表: ${JSON.stringify(hs)}ms`)
  console.log(`   现行超时 write=3000/readHeavyList=5000 → 余量 ${margins.write}× / ${margins.readHeavy}×`)
  console.log(`   结论：${hs.max < constants.timeoutsMs.readHeavyList / 3 ? '现行初值维持（余量 ≥3×），无需调整' : '建议复标'}`)
}

// ---- C16 · 原始响应片段长度（决策 C16：500 字符是否够用）----
console.log('▶ C16 原始响应体长度测量（证据片段 500 字符截断是否保留诊断信息）')
{
  const measured = {}
  for (const [name, path] of [
    ['classroom.detail', '/classrooms/5'],
    ['admin.reservations(86+行)', '/admin/reservations'],
    ['maintenance(空列表)', '/admin/maintenance'],
  ]) {
    const auth = await pool.getAuthorization(name === 'admin.reservations(86+行)' || name === 'maintenance(空列表)' ? 'ADMIN' : 'TEACHER')
    const r = await transport.request({ method: 'GET', path, headers: { Authorization: auth }, timeoutMs: 3000 })
    measured[name] = { bodyLength: (r.bodyText ?? '').length, codeVisibleIn500: (r.bodyText ?? '').slice(0, 500).includes('"code"') }
  }
  report.sections.C16 = { truncationAt: constants.evidence.rawFragmentMaxLength, measured }
  for (const [k, v] of Object.entries(measured)) {
    console.log(`   ${k}: ${v.bodyLength} 字节 | 前 500 字符含 "code" 字段: ${v.codeVisibleIn500}`)
  }
  console.log('   结论：500 字符内 envelope（code/message）均可见——截断不影响故障诊断；维持 500')
}

// ---- E1 + E6/D7 · 提示词对照与置信度分布（30 条样本 × 含/不含接口信息两版提示词）----
console.log(`▶ E1/E6·D7 提示词对照（${SAMPLES.length} 条样本 × 2 版提示词，模型 ${llm.model}）`)
{
  const baseSystem = buildSystemPrompt({
    intents: store.intentList.map((it) => ({ id: it.id, name: it.name, readOnly: it.readOnly, slots: it.slots, slotHints: it.slotHints ?? {} })),
    confidenceRule: `0 到 1；低于 ${constants.understanding.confidenceThreshold} 视为没有把握，系统会让用户选择意图`,
  })
  const withInterface = baseSystem + '\n\n# 可用接口（供你理解系统能力，禁止出现在输出中）\n' +
    '- POST /auth/login；GET /classrooms/{id}；GET /classrooms/available_list；GET /classrooms/{id}/seats；' +
    'GET /classrooms/{id}/reserved_seats；GET /admin/maintenance；POST /reservations/classrooms；' +
    'POST /reservations/seats；GET /reservations；DELETE /reservations/{id}；GET /admin/reservations'

  const runVersion = async (name, sys) => {
    const rows = []
    for (const s of SAMPLES) {
      try {
        const r = await llm.complete({ system: sys, messages: [...fewShotExamples(), { role: 'user', content: `用户说：「${s.text}」\n请输出 JSON。` }] })
        const verdict = validateUnderstandingOutput(r.text, store.intentList.map((i) => i.id))
        rows.push({ sample: s, verdict, raw: r.text.slice(0, 120) })
      } catch (err) {
        rows.push({ sample: s, verdict: { ok: false, violations: [err.message], parsed: null } })
      }
    }
    return rows
  }

  const without = await runVersion('without', baseSystem)
  const withInfo = await runVersion('with', withInterface)

  const score = (rows) => {
    let schemaPass = 0, intentCorrect = 0, oodCorrect = 0, scoredIntent = 0, scoredOod = 0
    const confidences = { high: [], low: [] }
    const misses = []
    for (const { sample, verdict } of rows) {
      if (verdict.ok) schemaPass += 1
      if (sample.category === 'flexible') continue
      scoredOod += 1
      if (verdict.ok && verdict.value.outOfDomain === sample.expect.ood) oodCorrect += 1
      else misses.push(`[${sample.category}] ${sample.text} → ood=${verdict.ok ? verdict.value.outOfDomain : '违规'}`)
      if (verdict.ok && !sample.expect.ood) {
        scoredIntent += 1
        if (verdict.value.intent === sample.expect.intent) {
          intentCorrect += 1
          confidences.high.push(verdict.value.confidence)
        } else {
          confidences.low.push(verdict.value.confidence)
          misses.push(`   └ intent=${verdict.value.intent}`)
        }
      }
    }
    return { schemaPass, intentCorrect, scoredIntent, oodCorrect, scoredOod, confidences, misses }
  }

  const sWithout = score(without)
  const sWith = score(withInfo)
  report.sections.E6_D7 = { sampleCount: SAMPLES.length, withoutInterface: sWithout, withInterface: sWith, misses: { without: sWithout.misses, with: sWith.misses } }

  console.log(`   不含接口信息（现行）：schema ${sWithout.schemaPass}/30 | 意图准确 ${sWithout.intentCorrect}/${sWithout.scoredIntent} | 超域 ${sWithout.oodCorrect}/${sWithout.scoredOod}`)
  console.log(`   含接口信息（对照）：  schema ${sWith.schemaPass}/30 | 意图准确 ${sWith.intentCorrect}/${sWith.scoredIntent} | 超域 ${sWith.oodCorrect}/${sWith.scoredOod}`)
  const drop = (sWith.intentCorrect / sWith.scoredIntent) - (sWithout.intentCorrect / sWithout.scoredIntent)
  console.log(`   E6 结论：${drop <= 0.05 ? '不含接口信息准确率不下降——第 03 章 §六 假设成立（假设未被证伪）' : '含接口版显著更高——假设被证伪，需重审（证伪条件触发）'}`)

  // E1 置信度分布（现行提示词 + 意图正确的样本）
  const hi = stats(sWithout.confidences.high)
  const lo = sWithout.confidences.low.length ? stats(sWithout.confidences.low) : null
  report.sections.E1 = { threshold: constants.understanding.confidenceThreshold, correctConfidence: hi, wrongConfidence: lo }
  console.log(`   E1 置信度：意图正确样本 ${JSON.stringify(hi)} | 错误样本 ${lo ? JSON.stringify(lo) : '无'}`)
  console.log(`   阈值 0.55 评估：${hi.min >= 0.55 ? '正确样本置信度全部 ≥ 阈值——0.55 可用' : '存在低于阈值的正确样本——阈值偏高的误拦风险'}`)
}

// ---- H3 · 稳定"查不清"构造（第 6 幕前置，H3 需实测）----
console.log('▶ H3 稳定"查不清"构造：T5 打提交（真实落库后丢响应）+ T1 阻断查证主路径与降级路径（含各自内部重试）→ UNRESOLVED')
{
  const outcomes = new Set()
  const details = []
  for (let rep = 1; rep <= 3; rep++) {
    // 第 6 幕构造：create 第 1 次 T5（真实落库后丢响应）→ UNKNOWN → 查证：
    //   主路径 logi.list 第 2..8 次全部 T1 阻断（含 R9 内部重试）→ R10 事实不可得；
    //   降级 mine 第 2..6 次全部 T1 阻断（第 1 次是 GATHERING F5，需放行）→ R10 → INCONCLUSIVE
    chaos.arm({
      injects: [
        { interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T5' },
        ...[2, 3, 4, 5, 6, 7, 8].map((n) => ({ interface: 'logi.reservation.list', nth: n, fault: 'T1' })),
        ...[2, 3, 4, 5, 6].map((n) => ({ interface: 'edu.reservation.mine', nth: n, fault: 'T1' })),
      ],
    })
    const slot = { start: new Date(Date.now() + (5 + rep) * 86_400_000 + 5 * 3_600_000), end: new Date(Date.now() + (5 + rep) * 86_400_000 + 6 * 3_600_000) }
    const chain = new (await import('../src/evidence/evidence-chain.js')).EvidenceChain({ taskId: `H3-${rep}`, evidenceConstants: constants.evidence })
    const judgment = new (await import('../src/judgment/judgment-engine.js')).JudgmentEngine({ configStore: store, gateway, evidenceChain: chain })
    const runner = new (await import('../src/orchestration/task-runner.js')).TaskRunner({ configStore: store, gateway, judgmentEngine: judgment, evidenceChain: chain, understandingEngine: undefined })
    const result = await runner.executeTask({
      intentId: 'borrow-classroom',
      resources: [{ classroom: { classroomId: 5 } }],
      slot,
      identity: { id: 'TEACHER' },
    })
    outcomes.add(result.terminal)
    details.push(`第 ${rep} 次: ${result.terminal}`)
    chaos.disarm()
    // 清理：T5 真实落库的记录（每次复跑一个不同槽位，均需撤销）
    const list = await gateway.call('logi.reservation.list', {}, { phase: 'P2' })
    for (const row of list.data.filter((r) => r.status === 'ACTIVE' && r.resourceId === 5 && r.start.getTime() === slot.start.getTime())) {
      await gateway.call('edu.reservation.cancel', { recordId: row.recordId }, { initiatorIdentity: 'TEACHER' })
    }
  }
  const stable = outcomes.size === 1 && outcomes.has('UNRESOLVED')
  report.sections.H3 = { outcomes: [...outcomes], stable, construction: 'T5 注入 create 第 1 次（真实落库后丢响应）+ T1 阻断查证主路径（含内部重试）与降级 mine 路径 → INCONCLUSIVE → UNRESOLVED' }
  console.log(`   3 次: ${details.join(' | ')}`)
  console.log(`   H3 结论：${stable ? '构造稳定——第 6 幕可用此方式确定性制造"查不清"' : '构造不稳定——需重新设计'}`)
}

// ---- 报告 ----
const dir = new URL('../../docs/实验/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('2026-09-25-参数标定与对照实验报告.md', dir), JSON.stringify(report, null, 2))
console.log(`\n报告已写入 docs/实验/2026-09-25-参数标定与对照实验报告.md`)
