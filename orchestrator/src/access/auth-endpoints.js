// 登录/登出/我是谁 —— 登录方案影响面 #1（决定 1：登录发生在引擎里）。
//
// 契约（登记于 docs/基线文档/对外接口清单.md）：
//   POST /api/auth/login   {username, password} → 200 {userInfo, role} + Set-Cookie 会话令牌
//   POST /api/auth/logout  （Cookie）            → 200；撤销存量侧设备会话并清本地会话
//   GET  /api/auth/me      （Cookie）            → 200 {userInfo, role} / 401 4010 未登录
//
// 三条纪律：
//   · 用户用**存量系统账号**登录，引擎拿存量令牌、只把**自己的会话令牌**给前端（决定 1/2）
//   · 角色一律来自存量系统登录响应，绝不接受前端传入（决定 2）
//   · 登录失败不区分"账号不存在/密码错"（不给枚举探测的口子），且不回显任何口令
//
// 本文件不做业务判断，也不进证据链（登录动作不在链上——沿用既有口径）。

import { readSessionToken, readBearerToken, sessionCookieHeader, clearSessionCookieHeader } from './session-cookie.js'
import { SessionExpiredError } from '../contact/user-token-store.js'

export const AUTH_ERROR_CODES = {
  UNAUTHORIZED: 4010, // 未登录（无会话或会话已过期）
  SESSION_EXPIRED: 4011, // 登录已失效，请重新登录（续期失败）
  BAD_CREDENTIALS: 4013, // 账号或密码不正确
}

/** 从请求里解析引擎会话（Cookie 优先，其次 Bearer——供脚本与接口测试使用）。 */
export function resolveSession(req, { sessionStore, sessionConstants }) {
  const token =
    readSessionToken(req, sessionConstants?.cookieName ?? 'orch_session') ?? readBearerToken(req)
  if (!token) return null
  return sessionStore.get(token) ?? null
}

/**
 * 处理三个登录端点。返回 true 表示该请求已由本模块处理完（接入层不再往下走）。
 */
export async function handleAuthRoute({ req, res, route, deps }) {
  const { sessionStore, userTokenStore, sessionConstants, sendJson, readBody } = deps
  const cookieName = sessionConstants?.cookieName ?? 'orch_session'

  if (route === 'POST /api/auth/login') {
    const raw = await readBody(req)
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      sendJson(res, 400, deps.errorCodes.BAD_JSON, '请求体不是合法 JSON')
      return true
    }
    if (typeof body.username !== 'string' || !body.username.trim() || typeof body.password !== 'string' || !body.password) {
      sendJson(res, 400, deps.errorCodes.BAD_REQUEST, '缺少 username 或 password')
      return true
    }
    try {
      const { userInfo } = await userTokenStore.login({ username: body.username.trim(), password: body.password })
      const { sessionToken, session } = sessionStore.create({ username: body.username.trim(), userInfo })
      res.setHeader('Set-Cookie', sessionCookieHeader(sessionToken, sessionConstants))
      sendJson(res, 200, deps.errorCodes.OK, '登录成功', { userInfo: session.userInfo, role: session.role })
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        sendJson(res, 401, AUTH_ERROR_CODES.SESSION_EXPIRED, err.message)
        return true
      }
      // 认证失败与"存量系统不可达"要分开：前者是用户的问题，后者不是
      const message = /被拒/.test(err.message) ? '账号或密码不正确' : `登录失败：${err.message}`
      sendJson(res, 401, AUTH_ERROR_CODES.BAD_CREDENTIALS, message)
    }
    return true
  }

  if (route === 'POST /api/auth/logout') {
    const session = resolveSession(req, { sessionStore, sessionConstants })
    if (session) {
      await userTokenStore.logout(session.username)
      sessionStore.destroy(session.sessionToken)
    }
    res.setHeader('Set-Cookie', clearSessionCookieHeader(sessionConstants))
    sendJson(res, 200, deps.errorCodes.OK, '已退出登录', { loggedOut: Boolean(session) })
    return true
  }

  if (route === 'GET /api/auth/me') {
    const session = resolveSession(req, { sessionStore, sessionConstants })
    if (!session) {
      sendJson(res, 401, AUTH_ERROR_CODES.UNAUTHORIZED, '未登录（会话不存在或已过期）')
      return true
    }
    sendJson(res, 200, deps.errorCodes.OK, 'ok', {
      userInfo: session.userInfo,
      role: session.role,
      cookieName,
    })
    return true
  }

  return false
}
