// 结构自检测试 —— ① 全量配置下 8 条全过；② 构造变异体验证每条自检真的查得出违规
// （第 04 章 §十一：结构被悄悄破坏不会报错，所以必须单独检查）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigStore } from '../src/config/config-store.js'
import { runStructureChecks } from '../scripts/structure-check.mjs'

const store = new ConfigStore()
const baseData = () => ({
  stateMachine: structuredClone(store.getStateMachine()),
  registry: structuredClone(store.registry),
  plans: structuredClone(store.plans),
})

test('仓库自带的表驱动状态机与配置数据：8 条自检全部通过', () => {
  const outcome = runStructureChecks(baseData())
  assert.equal(outcome.passed, true, JSON.stringify(outcome.results.filter((r) => !r.pass), null, 2))
  assert.equal(outcome.results.length, 8)
})

test('自检 1：移除初始态的全部出边 → 其余状态全部不可达', () => {
  const data = baseData()
  // 注意：只删 START 边查不出来——UNDERSTANDING 仍可经 DEGRADING→AWAIT_CLARIFY 环路到达，
  // 这说明可达性检查没有误报；要打破可达性必须切断 IDLE 的全部出口
  data.stateMachine.edges = data.stateMachine.edges.filter((e) => e.from !== 'IDLE')
  const outcome = runStructureChecks(data)
  const check = outcome.results.find((r) => r.no === 1)
  assert.equal(check.pass, false)
  assert.ok(check.details.some((d) => d.includes('UNDERSTANDING')))
})

test('自检 2：清空 JUDGING 的出边 → 死状态', () => {
  const data = baseData()
  data.stateMachine.edges = data.stateMachine.edges.filter((e) => e.from !== 'JUDGING')
  const outcome = runStructureChecks(data)
  assert.equal(outcome.results.find((r) => r.no === 2).pass, false)
})

test('自检 3：同一 (状态 × 目的) 下重复事件 → 查出重复', () => {
  const data = baseData()
  data.stateMachine.edges.push({ from: 'SUBMITTING', event: 'CALL_SUCCESS', to: 'VERIFYING' })
  const outcome = runStructureChecks(data)
  const check = outcome.results.find((r) => r.no === 3)
  assert.equal(check.pass, false)
  assert.ok(check.details[0].includes('CALL_SUCCESS'))
})

test('自检 4：终态出现出边 → 查出"复活"边', () => {
  const data = baseData()
  data.stateMachine.edges.push({ from: 'DONE', event: 'USER_REPLIED', to: 'UNDERSTANDING' })
  const outcome = runStructureChecks(data)
  assert.equal(outcome.results.find((r) => r.no === 4).pass, false)
})

test('自检 5：给 SUBMITTING 增加第四条入边 → 查出绕过校验的副作用路径', () => {
  const data = baseData()
  // 模拟"降级后直达提交"的违规设计（第 04 章 §十二 排除 4）
  data.stateMachine.edges.push({ from: 'DEGRADING', event: 'DEGRADE_ACCEPTED', to: 'SUBMITTING' })
  const outcome = runStructureChecks(data)
  const check = outcome.results.find((r) => r.no === 5)
  assert.equal(check.pass, false)
  assert.ok(check.details.some((d) => d.includes('DEGRADING|DEGRADE_ACCEPTED')))
})

test('自检 5：三条法定入边缺失任何一条 → 报错', () => {
  const data = baseData()
  data.stateMachine.edges = data.stateMachine.edges.filter(
    (e) => !(e.from === 'COMPENSATING' && e.event === 'COMPENSATION_READY'),
  )
  const outcome = runStructureChecks(data)
  const check = outcome.results.find((r) => r.no === 5)
  assert.equal(check.pass, false)
  assert.ok(check.details.some((d) => d.includes('COMPENSATING|COMPENSATION_READY')))
})

test('自检 6：CALL_* 直通 DONE → 查出 UNKNOWN 被当成功（I3）', () => {
  const data = baseData()
  data.stateMachine.edges.push({ from: 'VERIFYING', event: 'CALL_SUCCESS', to: 'DONE' })
  const outcome = runStructureChecks(data)
  assert.equal(outcome.results.find((r) => r.no === 6).pass, false)
})

test('自检 7：清空 FAILED 的入边 → 终态永不可达', () => {
  const data = baseData()
  data.stateMachine.edges = data.stateMachine.edges.filter((e) => e.to !== 'FAILED')
  const outcome = runStructureChecks(data)
  assert.equal(outcome.results.find((r) => r.no === 7).pass, false)
})

test('自检 8：意图引用禁止自动编排的接口 → 查出 M8/D2 违规', () => {
  const data = baseData()
  data.plans.intents[0].steps[0].interface = 'logi.maintenance.create'
  const outcome = runStructureChecks(data)
  const check = outcome.results.find((r) => r.no === 8)
  assert.equal(check.pass, false)
  assert.ok(check.details[0].includes('logi.maintenance.create'))

  // 引用不存在的接口同样算违规
  const data2 = baseData()
  data2.plans.intents[0].steps[0].interface = 'edu.classroom.not_registered'
  assert.equal(runStructureChecks(data2).results.find((r) => r.no === 8).pass, false)
})
