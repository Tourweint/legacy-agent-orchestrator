// REST 封装 —— 研发规范 §五：组件不得直接 fetch，一律经 api/。
// 端点与错误码见 docs/基线文档/对外接口清单.md。
//
// 会话（2026-09-26 登录上线后）：引擎用 HttpOnly Cookie（orch_session）维护会话，
// 前端经 `/api` 同源代理访问，浏览器自动携带——前端**不持有任何令牌**（拿不到也不该拿）。
// 401 的含义：未登录（4010）或登录已失效（4011），由调用方交会话状态处理。

async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin', // 同源代理下携带会话 Cookie
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const body = await res.json().catch(() => ({ code: -1, message: `HTTP ${res.status}` }))
  return { httpStatus: res.status, ...body }
}

export function apiHealth() {
  return request('/api/health')
}

// ---- 登录三件套（对外接口清单 §9–§11）----

/** 用校园系统原有账号登录；成功后引擎下发会话 Cookie，响应体不含任何令牌。 */
export function apiLogin(username, password) {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function apiLogout() {
  return request('/api/auth/logout', { method: 'POST' })
}

/** 我是谁：确认当前会话是否有效（刷新页面/重开窗口后恢复会话用）。 */
export function apiMe() {
  return request('/api/auth/me')
}

// ---- 业务端点（均要求已登录）----

/** 自然语言入口（理解层 → 同一编排）。身份由会话派生，不再传 identity。 */
export function apiChat(text) {
  return request('/api/chat', { method: 'POST', body: JSON.stringify({ text }) })
}

/** 结构化任务入口（无 LLM 路径；调试入口 G5）。 */
export function apiPostTask(task) {
  return request('/api/tasks', { method: 'POST', body: JSON.stringify(task) })
}

/** 任务快照（含挂起时的 clarify 与终态结果）。 */
export function apiGetTask(taskId) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`)
}

/** 追问回复（挂起任务恢复）。 */
export function apiReply(taskId, text) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

/** 取消（B8：写请求发出前生效）。 */
export function apiCancel(taskId) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
}

/** 证据链导出（evidenceRef 的解析来源，§6.3 规格 4）。 */
export function apiEvidence(taskId) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/evidence`)
}
