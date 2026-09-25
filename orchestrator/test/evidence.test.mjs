// 证据层测试 —— 覆盖第 13 章 §六 阶段 0 验收：
// "任取一次拒绝，能答出'依据哪条事实、哪条命题、什么时刻'；导出不含凭证"

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigStore } from '../src/config/config-store.js'
import { EvidenceChain, EvidenceError } from '../src/evidence/evidence-chain.js'

const store = new ConfigStore()
const evidenceConstants = store.getConstants().evidence

function fixedClock() {
  return new Date('2026-09-25T08:00:00Z')
}

function makeChain(taskId = 'task-demo') {
  return new EvidenceChain({ taskId, now: fixedClock, evidenceConstants })
}

function recordRejection(chain) {
  return chain.record({
    action: 'reject-task',
    input: { intent: 'borrow-classroom', classroomName: '数智楼222', datePhrase: '下周三', segmentName: '下午' },
    basis: [
      {
        fact: 'F4',
        proposition: 'P-SLOT-FREE',
        detail: 'logi.reservation.list（不带 keyword）命中一条 ACTIVE 重叠记录 #118，写入者非本次身份',
      },
    ],
    conclusion: { outcome: 'REJECTED', summary: '该教室在这段时间已被预约' },
  })
}

test('验收：任取一次拒绝，能答出依据哪条事实、哪条命题、什么时刻', () => {
  const chain = makeChain()
  recordRejection(chain)
  const [entry] = chain.getEntries()
  assert.equal(entry.basis[0].fact, 'F4')                       // 依据哪条事实
  assert.equal(entry.basis[0].proposition, 'P-SLOT-FREE')      // 哪条命题
  assert.equal(entry.at, '2026-09-25T08:00:00.000Z')           // 什么时刻
  assert.equal(entry.conclusion.outcome, 'REJECTED')
})

test('有后果的动作缺依据即报错（契约①，I4）', () => {
  const chain = makeChain()
  assert.throws(
    () => chain.record({ action: 'submit', conclusion: { outcome: 'SUCCESS', summary: 'x' } }),
    EvidenceError,
  )
  assert.throws(
    () =>
      chain.record({
        action: 'submit',
        basis: [{ detail: '既无事实也无命题的依据' }],
        conclusion: { outcome: 'SUCCESS', summary: 'x' },
      }),
    EvidenceError,
  )
})

test('结论缺唯一确定的 outcome 即报错（I3）', () => {
  const chain = makeChain()
  assert.throws(
    () => chain.record({ action: 'submit', basis: [{ fact: 'F1' }], conclusion: { summary: '没有结论' } }),
    EvidenceError,
  )
})

test('模型原始输出单独留档，不进证据链（契约③，禁止项①）', () => {
  const chain = makeChain()
  recordRejection(chain)
  chain.recordModelOutput('{"intent":"borrow-classroom","confidence":0.9,"reasoning":"用户想借教室"}', {
    stage: 'understanding',
  })
  assert.equal(chain.getEntries().length, 1)              // 原始输出没有混进证据链
  assert.equal(chain.getModelOutputs().length, 1)         // 单独一档
  const exported = chain.exportChain()
  assert.equal(exported.entries.length, 1)
  assert.equal(exported.modelOutputs.length, 1)
  assert.equal(exported.modelOutputs[0].meta.stage, 'understanding')
})

test('凭证字段被剔除；超长片段被截断（禁止项②，C16）', () => {
  const chain = makeChain()
  chain.record({
    action: 'collect-fact',
    input: {
      accessToken: 'Bearer eyJhbGciOi.这不该出现',
      password: 'hunter2',
      responseFragment: 'x'.repeat(600),
      note: '正常字段保留',
    },
    basis: [{ fact: 'F1', detail: 'y'.repeat(700) }],
    conclusion: { outcome: 'SUCCESS', summary: '取到教室详情' },
  })
  const [entry] = chain.getEntries()
  assert.equal(entry.input.accessToken, '[已剔除凭证字段]')
  assert.equal(entry.input.password, '[已剔除凭证字段]')
  assert.equal(entry.input.note, '正常字段保留')
  assert.ok(entry.input.responseFragment.length < 600)
  assert.ok(entry.input.responseFragment.includes('截断'))
})

test('导出内容不含任何凭证值（契约②）', () => {
  const chain = makeChain()
  recordRejection(chain)
  chain.record({
    action: 'login',
    input: { username: '233', password: 'super-secret-pw', token: 'tok_123' },
    basis: [{ fact: 'F1' }],
    conclusion: { outcome: 'SUCCESS', summary: '已取得凭证' },
  })
  const json = JSON.stringify(chain.exportChain())
  assert.ok(!json.includes('super-secret-pw'))
  assert.ok(!json.includes('tok_123'))
})

test('证据条目按任务连续编号，供界面消费（禁止项③）', () => {
  const chain = makeChain('task-multi')
  recordRejection(chain)
  chain.record({ action: 'collect-fact', basis: [{ fact: 'F1' }], conclusion: { outcome: 'SUCCESS', summary: 'ok' } })
  const entries = chain.getEntries()
  assert.deepEqual(
    entries.map((e) => e.seq),
    [1, 2],
  )
  assert.ok(entries.every((e) => e.taskId === 'task-multi'))
})
