// 测试夹具：假传输层（不联网）+ 组装好的接触层网关。
// 凭证用测试假值注入环境变量——不是任何真实系统的口令。

import { ConfigStore } from '../../src/config/config-store.js'
import { IdentityPool } from '../../src/contact/identity-pool.js'
import { ProtocolAdapters } from '../../src/contact/adapters.js'
import { ContactGateway } from '../../src/contact/contact-gateway.js'
import { EvidenceChain } from '../../src/evidence/evidence-chain.js'

process.env.ORCH_LEGACY_ADMIN_PASSWORD ||= 'test-pw-admin'
process.env.ORCH_LEGACY_TEACHER_PASSWORD ||= 'test-pw-teacher'
process.env.ORCH_LEGACY_STUDENT_PASSWORD ||= 'test-pw-student'

export class FakeTransport {
  constructor(handler) {
    this.handler = handler
    this.calls = []
  }

  async request(req) {
    this.calls.push(req)
    return this.handler(req)
  }

  callsTo(path) {
    return this.calls.filter((c) => c.path === path)
  }
}

// 测试用固定用户 id（Q1 写入者匹配依赖 token 背后的数字 id，与存量系统 userInfo.id 同形态）
export const UIDS = { admin: 10017, 233: 10018, abc: 10019 }

export function loginOk(req) {
  const username = req.body?.username ?? 'x'
  const token = `tok-${username}`
  const role = username === 'admin' ? 'ADMIN' : username === '233' ? 'TEACHER' : 'STUDENT'
  const bodyText = JSON.stringify({
    code: 200,
    message: 'ok',
    data: { accessToken: token, refreshToken: `rt-${username}`, userInfo: { id: UIDS[username] ?? 90001, username, role } },
  })
  return { kind: 'response', httpStatus: 200, json: JSON.parse(bodyText), bodyText }
}

/**
 * @param {(req) => object} handler   非 /auth/login 请求的处理器
 */
export function makeGateway(handler, { now } = {}) {
  const store = new ConfigStore()
  const transport = new FakeTransport((req) => (req.path === '/auth/login' ? loginOk(req) : handler(req)))
  const adapters = new ProtocolAdapters({ configStore: store })
  const pool = new IdentityPool({
    configStore: store,
    transport,
    adapters,
    constants: store.getConstants(),
    now: now ?? (() => new Date()),
  })
  const chain = new EvidenceChain({
    taskId: 'T-TEST',
    now: now ?? (() => new Date()),
    evidenceConstants: store.getConstants().evidence,
  })
  const gateway = new ContactGateway({
    configStore: store,
    transport,
    identityPool: pool,
    adapters,
    evidenceChain: chain,
    now: now ?? (() => new Date()),
  })
  return { gateway, transport, chain, store, pool }
}

export function ok(data, bodyText) {
  const text = bodyText ?? JSON.stringify({ code: 200, message: 'ok', data })
  return { kind: 'response', httpStatus: 200, json: { code: 200, message: 'ok', data }, bodyText: text }
}

export function envelope(code, message) {
  const text = JSON.stringify({ code, message, data: null })
  return { kind: 'response', httpStatus: 200, json: { code, message, data: null }, bodyText: text }
}

export function httpOnly(status) {
  const text = JSON.stringify({ code: status, message: 'http-level' })
  return { kind: 'response', httpStatus: status, json: { code: status, message: 'http-level' }, bodyText: text }
}
