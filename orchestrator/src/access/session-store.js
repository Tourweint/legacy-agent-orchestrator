// 引擎会话存储 —— 登录方案的接入层落点（决定 1/6；影响面 #2）。
//
// 为什么要引擎自己的会话：前端只拿"引擎的会话令牌"，存量系统的令牌**只留在引擎内**。
// 收益（决定 1）：① 保住"唯一 HTTP 出口"（前端不直连存量系统）；② 前端拿不到、也不需要
// 存量系统地址与协议；③ 凭证不出引擎。
//
// 纪律：
//   · 本模块**只存身份**（谁登录了、什么角色、本人资料），**不存任何凭证**——
//     存量令牌与刷新令牌由接触层 user-token-store 持有（M6：凭证由接触层统一持有）
//   · 内存存储，重启即失效（A6 + 决定 6：状态不跨进程）；空闲超时后要求重新登录
//   · 会话令牌用密码学随机数生成，不可预测、不可枚举

import { randomBytes } from 'node:crypto'

export class SessionStore {
  /**
   * @param {object} [options]
   * @param {object} [options.constants]  常量集合（读 session 节）
   * @param {() => Date} [options.now]
   */
  constructor({ constants, now = () => new Date() } = {}) {
    this.sessionConstants = constants?.session ?? {}
    this.now = now
    this.#sessions = new Map()
  }

  #sessions

  /**
   * 建立会话。角色一律取自存量系统登录响应（决定 2：角色不靠猜、不靠参数传）。
   * @returns {{sessionToken: string, session: object}}
   */
  create({ username, userInfo }) {
    const sessionToken = randomBytes(32).toString('hex')
    const nowMs = this.now().getTime()
    const session = {
      sessionToken,
      username,
      role: userInfo?.role ?? null,
      userInfo: pickUserInfo(userInfo),
      createdAt: nowMs,
      lastSeenAt: nowMs,
    }
    this.#sessions.set(sessionToken, session)
    return { sessionToken, session }
  }

  /** 取会话（顺带续期空闲计时）；不存在或已空闲超时 → null。 */
  get(sessionToken) {
    if (!sessionToken) return null
    const session = this.#sessions.get(sessionToken)
    if (!session) return null
    if (this.#idleExpired(session)) {
      this.#sessions.delete(sessionToken)
      return null
    }
    session.lastSeenAt = this.now().getTime()
    return session
  }

  destroy(sessionToken) {
    return this.#sessions.delete(sessionToken)
  }

  get size() {
    return this.#sessions.size
  }

  #idleExpired(session) {
    const idleTimeoutMs = this.sessionConstants.idleTimeoutMs ?? 7_200_000
    return this.now().getTime() - session.lastSeenAt > idleTimeoutMs
  }
}

/**
 * 只保留可以给前端看的本人资料（决定 2："记录是哪个同学约的"需要身份，但不需要凭证）。
 * 白名单而非黑名单：登录响应里出现新字段时默认不外泄。
 */
function pickUserInfo(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return null
  return {
    id: userInfo.id ?? null,
    username: userInfo.username ?? null,
    nickname: userInfo.nickname ?? null,
    role: userInfo.role ?? null,
    creditLevel: userInfo.creditLevel ?? null,
    maxSingleReservationMinutes: userInfo.maxSingleReservationMinutes ?? null,
    dailyReservationLimitMinutes: userInfo.dailyReservationLimitMinutes ?? null,
    seatReservationAdvanceHours: userInfo.seatReservationAdvanceHours ?? null,
  }
}
