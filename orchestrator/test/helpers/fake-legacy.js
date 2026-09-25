// 测试夹具：假传输层（不联网）+ 组装好的接触层网关。
// 凭证用测试假值注入环境变量——不是任何真实系统的口令。
//
// 登录（2026-09-25 拓展）：网关现在区分"服务只读身份"（identity-pool）与"登录者本人"
// （user-token-store）。夹具默认给网关装配一个**已登录的教师**（token 与既有断言一致：
// tok-233）；需要别的角色或学生链路的用例传 { role: 'STUDENT' } 或 { user }。

import { ConfigStore } from '../../src/config/config-store.js'
import { IdentityPool } from '../../src/contact/identity-pool.js'
import { UserTokenStore } from '../../src/contact/user-token-store.js'
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

/** 演示账号的三个画像（角色取自存量系统登录响应；测试里的"登录用户"就是它们）。 */
export const TEST_USERS = {
  ADMIN: { username: 'admin', role: 'ADMIN', userId: UIDS.admin },
  TEACHER: { username: '233', role: 'TEACHER', userId: UIDS['233'] },
  STUDENT: { username: 'abc', role: 'STUDENT', userId: UIDS.abc },
}

/** 按角色取测试用户画像。 */
export function testUser(role = 'TEACHER') {
  const user = TEST_USERS[role]
  if (!user) throw new Error(`未知测试角色: ${role}`)
  return user
}

/** 编排层要的 identity 形态（登录后 = 登录者本人；role 用于意图鉴权）。 */
export function sessionIdentity(role = 'TEACHER') {
  const u = testUser(role)
  return { id: u.username, userId: u.userId, role: u.role }
}

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

/** 续期：刷新令牌是轮换的（旧的一次性作废）——与存量系统源码行为一致。 */
export function refreshOk(req) {
  const refreshToken = req.body?.refreshToken ?? ''
  const username = refreshToken.replace(/^rt-/, '').replace(/-\d+$/, '')
  const role = username === 'admin' ? 'ADMIN' : username === '233' ? 'TEACHER' : 'STUDENT'
  const bodyText = JSON.stringify({
    code: 200,
    message: 'ok',
    data: {
      accessToken: `tok-${username}-refreshed`,
      refreshToken: `rt-${username}-2`,
      userInfo: { id: UIDS[username] ?? 90001, username, role },
    },
  })
  return { kind: 'response', httpStatus: 200, json: JSON.parse(bodyText), bodyText }
}

/**
 * @param {(req) => object} handler   非凭证类请求的处理器
 * @param {object} [options]
 * @param {string} [options.role]     默认登录角色（TEACHER）
 * @param {object|null} [options.user] 直接指定登录用户画像（覆盖 role）；
 *        显式传 null = **没有登录用户的网关**（用于验证"无身份即本地报错"这类负向行为）
 */
export function makeGateway(handler, { now, role = 'TEACHER', user } = {}) {
  const store = new ConfigStore()
  const transport = new FakeTransport((req) => {
    if (req.path === '/auth/login') return loginOk(req)
    if (req.path === '/auth/refresh') return refreshOk(req)
    return handler(req)
  })
  const adapters = new ProtocolAdapters({ configStore: store })
  const constants = store.getConstants()
  const pool = new IdentityPool({
    configStore: store,
    transport,
    adapters,
    constants,
    now: now ?? (() => new Date()),
  })
  const effectiveUser = user === null ? null : (user ?? testUser(role))
  const userTokenStore = new UserTokenStore({
    configStore: store,
    transport,
    adapters,
    constants,
    now: now ?? (() => new Date()),
  })
  if (effectiveUser) {
    userTokenStore.adopt({
      username: effectiveUser.username,
      accessToken: `tok-${effectiveUser.username}`,
      refreshToken: `rt-${effectiveUser.username}`,
      userInfo: { id: effectiveUser.userId, username: effectiveUser.username, role: effectiveUser.role },
    })
  }
  const chain = new EvidenceChain({
    taskId: 'T-TEST',
    now: now ?? (() => new Date()),
    evidenceConstants: constants.evidence,
  })
  const gateway = new ContactGateway({
    configStore: store,
    transport,
    identityPool: pool,
    userTokenStore,
    user: effectiveUser ? { username: effectiveUser.username, role: effectiveUser.role } : null,
    adapters,
    evidenceChain: chain,
    now: now ?? (() => new Date()),
  })
  return { gateway, transport, chain, store, pool, userTokenStore, adapters, user: effectiveUser }
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
