// 三值判定规则表测试 —— 阶段 1 验收②："三值判定的每一种情形在规则表里都有对应行"。
// 逐行给出代表性信号组合，验证结论与行号；另验优先级、分叉与"未列出即 UNKNOWN"。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigStore } from '../src/config/config-store.js'
import {
  evaluateVerdict,
  VERDICT_RULES,
  READ_RETRY_EXHAUSTED,
  DEFAULT_UNKNOWN,
} from '../src/contact/verdict-rules.js'

const store = new ConfigStore()
const createIface = store.getInterface('edu.reservation.classroom.create')
const cancelIface = store.getInterface('edu.reservation.cancel')
const listIface = store.getInterface('logi.reservation.list')

const sig = (httpStatus, businessCode, extra = {}) => ({
  transportKind: 'response',
  httpStatus,
  businessCode,
  ...extra,
})

test('写接口规则表逐行有落点（W1–W12；W13 分叉单独测）', () => {
  const cases = [
    ['W1', sig(200, 200), 'SUCCESS', 'ok'],
    ['W2', sig(200, 409), 'UNKNOWN', 'conflict-ambiguous'],
    ['W3', sig(200, 403), 'FAILURE', 'identity-error'],
    ['W4', sig(200, 400), 'FAILURE', 'bad-request'],
    ['W13', sig(200, 404), 'FAILURE', 'resource-not-found'],
    ['W5', sig(200, 450), 'UNKNOWN', 'unregistered-business-code'],
    ['W6', sig(200, null), 'UNKNOWN', 'malformed-envelope'],
    ['W7', sig(401, null), 'FAILURE', 'credential'],
    ['W8', sig(403, null), 'FAILURE', 'identity-error'],
    ['W9', sig(500, null), 'UNKNOWN', 'server-error'],
    ['W10', sig(418, null), 'UNKNOWN', 'unexpected-http-status'],
    ['W11', { transportKind: 'timeout' }, 'UNKNOWN', 'no-response'],
    ['W11', { transportKind: 'disconnect' }, 'UNKNOWN', 'no-response'],
    ['W12', { transportKind: 'unparseable', httpStatus: 200 }, 'UNKNOWN', 'unparseable-body'],
  ]
  for (const [expectedRow, signals, verdict, reasonCode] of cases) {
    const result = evaluateVerdict('write', signals, createIface)
    assert.equal(result.ruleRow, expectedRow, `信号 ${JSON.stringify(signals)} 应命中 ${expectedRow}`)
    assert.equal(result.verdict, verdict)
    assert.equal(result.reasonCode, reasonCode)
  }
})

test('读接口规则表逐行有落点（R1–R9；响应体无法解析落默认 UNKNOWN）', () => {
  const cases = [
    ['R1', sig(200, 200), 'SUCCESS', 'ok', false],
    ['R2', sig(200, 400), 'FAILURE', 'bad-request', false],
    ['R3', sig(200, 403), 'FAILURE', 'identity-error', false],
    ['R4', sig(200, 409), 'FAILURE', 'conflict-unexpected', false],
    ['R5', sig(200, 404), 'FAILURE', 'unexpected-business-code', false],
    ['R5', sig(200, 450), 'FAILURE', 'unexpected-business-code', false],
    ['R6', sig(401, null), 'UNKNOWN', 'credential', true],
    ['R7', sig(403, null), 'FAILURE', 'identity-error', false],
    ['R8', sig(500, null), 'UNKNOWN', 'server-error', true],
    ['R9', { transportKind: 'timeout' }, 'UNKNOWN', 'no-response', true],
    ['R9', { transportKind: 'disconnect' }, 'UNKNOWN', 'no-response', true],
  ]
  for (const [expectedRow, signals, verdict, reasonCode, retryable] of cases) {
    const result = evaluateVerdict('read', signals, listIface)
    assert.equal(result.ruleRow, expectedRow, `信号 ${JSON.stringify(signals)} 应命中 ${expectedRow}`)
    assert.equal(result.verdict, verdict)
    assert.equal(result.reasonCode, reasonCode)
    assert.equal(result.retryable, retryable)
  }
  // 未列出的组合：读接口收到无法解析的响应体 → 默认 UNKNOWN（§4.3 白名单式）
  const fallback = evaluateVerdict('read', { transportKind: 'unparseable', httpStatus: 200 }, listIface)
  assert.equal(fallback.ruleRow, null)
  assert.equal(fallback.verdict, 'UNKNOWN')
  assert.equal(fallback.reasonCode, DEFAULT_UNKNOWN.reasonCode)
})

test('W13/D10 分叉：补偿撤销收到 400/404 不判失败，进查证', () => {
  // 同样的信号，创建类判 FAILURE、补偿撤销判 UNKNOWN（compensation-verify）
  for (const businessCode of [400, 404]) {
    const asCreate = evaluateVerdict('write', sig(200, businessCode), createIface)
    assert.equal(asCreate.verdict, 'FAILURE')

    const asCancel = evaluateVerdict('write', sig(200, businessCode), cancelIface)
    assert.equal(asCancel.verdict, 'UNKNOWN')
    assert.equal(asCancel.reasonCode, 'compensation-verify')
  }
  // 409 在补偿语境同样是歧义信号（撤销同样可能超时/竞争），仍走 W2
  const asCancelConflict = evaluateVerdict('write', sig(200, 409), cancelIface)
  assert.equal(asCancelConflict.ruleRow, 'W2')
  assert.equal(asCancelConflict.ambiguous, true)
})

test('判定优先级：HTTP 200 的业务码陷阱——成功语义只能来自业务码（C11/§5.2）', () => {
  // HTTP 200 + code 403 → FAILURE：只看 HTTP 状态码会把越权判成成功（假成功陷阱，§5.1）
  const masked = evaluateVerdict('write', sig(200, 403), createIface)
  assert.equal(masked.verdict, 'FAILURE')
  // HTTP 200 + code 409 → UNKNOWN：朴素实现会判成功
  const conflict = evaluateVerdict('write', sig(200, 409), createIface)
  assert.equal(conflict.verdict, 'UNKNOWN')
  assert.equal(conflict.ambiguous, true)
  // 病态错配（HTTP 500 + code 409）：业务码行要求与 HTTP 200 相配，错配组合保守落 W9 → UNKNOWN
  // ——无论哪种错配，结论都不会是"成功"，这就是"先业务码、最后 HTTP"要保证的
  const mismatched = evaluateVerdict('write', sig(500, 409), createIface)
  assert.equal(mismatched.ruleRow, 'W9')
  assert.equal(mismatched.verdict, 'UNKNOWN')
})

test('重试标记纪律：写接口全部不可重试；读接口只有凭证/瞬态可重试', () => {
  for (const row of VERDICT_RULES) {
    if (row.kind === 'write') {
      assert.equal(row.retryable ?? false, false, `${row.id} 写接口不得标 retryable`)
    }
  }
  const retryableReads = VERDICT_RULES.filter((r) => r.kind === 'read' && r.retryable).map((r) => r.id)
  assert.deepEqual(retryableReads.sort(), ['R6', 'R8', 'R9'])
})

test('R10 兜底与行号稳定性（C15）', () => {
  assert.equal(READ_RETRY_EXHAUSTED.verdict, 'FAILURE')
  assert.equal(READ_RETRY_EXHAUSTED.reasonCode, 'fact-unavailable')
  // 行号集合固定：W1–W13 与 R1–R9（R10 是兜底结论不是信号行）
  const ids = VERDICT_RULES.map((r) => r.id)
  for (let w = 1; w <= 13; w++) assert.ok(ids.includes(`W${w}`), `缺 W${w}`)
  for (let r = 1; r <= 9; r++) assert.ok(ids.includes(`R${r}`), `缺 R${r}`)
  assert.equal(VERDICT_RULES.length, 22) // 13 W + 9 R
})
