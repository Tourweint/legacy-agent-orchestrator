// 会话 Cookie 的读写 —— 登录方案影响面 #10（三审拍板：SSE 会话鉴权走 Cookie）。
//
// 为什么是 Cookie 而不是请求头：前端用 EventSource 订阅事件流，而 EventSource **不能带自定义
// 请求头**——这是客观约束，不是偏好。备选"把令牌放进查询参数"会写进访问日志，不取。
//
// 纪律：本模块只做 Cookie 的读写与序列化，不做任何鉴权判断（那是接入层中间件的事）。

/** 从请求头解析出会话令牌；没有则返回 null。 */
export function readSessionToken(req, cookieName) {
  const header = req.headers?.cookie
  if (!header || !cookieName) return null
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() !== cookieName) continue
    const value = part.slice(index + 1).trim()
    return value ? decodeURIComponent(value) : null
  }
  return null
}

/**
 * 也接受 Authorization: Bearer <会话令牌>——供命令行/脚本与接口测试使用。
 * 为什么不只留 Cookie：接口测试与运维排查需要一种不依赖浏览器的调用方式，且它不改变
 * 浏览器的安全属性（HttpOnly Cookie 仍然存在）。
 */
export function readBearerToken(req) {
  const header = req.headers?.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

/** 会话令牌 Cookie。HttpOnly：前端脚本读不到（XSS 也偷不走）；SameSite=Lax：同源代理下自然携带。 */
export function sessionCookieHeader(sessionToken, sessionConstants = {}) {
  const name = sessionConstants.cookieName ?? 'orch_session'
  const maxAgeMs = sessionConstants.cookieMaxAgeMs ?? 28_800_000
  return `${name}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`
}

/** 登出：把 Cookie 置空并立即过期。 */
export function clearSessionCookieHeader(sessionConstants = {}) {
  const name = sessionConstants.cookieName ?? 'orch_session'
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
