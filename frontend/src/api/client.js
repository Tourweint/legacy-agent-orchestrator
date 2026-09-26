// REST 封装 —— 研发规范 §五：组件不得直接 fetch，一律经 api/。
// 端点与错误码见 docs/基线文档/对外接口清单.md。

import { ENDPOINTS } from './endpoints.js'

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const body = await res.json().catch(() => ({ code: -1, message: `HTTP ${res.status}` }))
  return { httpStatus: res.status, ...body }
}

export function apiHealth() {
  return request(ENDPOINTS.health)
}

/** 自然语言入口（理解层 → 同一编排）。 */
export function apiChat(text, identity) {
  return request(ENDPOINTS.chat, { method: 'POST', body: JSON.stringify({ text, identity }) })
}

/** 结构化任务入口（无 LLM 路径；调试入口 G5）。 */
export function apiPostTask(task) {
  return request(ENDPOINTS.tasks, { method: 'POST', body: JSON.stringify(task) })
}

/** 任务快照（含挂起时的 clarify 与终态结果）。 */
export function apiGetTask(taskId) {
  return request(ENDPOINTS.task(taskId))
}

/** 追问回复（挂起任务恢复）。 */
export function apiReply(taskId, text) {
  return request(ENDPOINTS.taskReply(taskId), {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

/** 取消（B8：写请求发出前生效）。 */
export function apiCancel(taskId) {
  return request(ENDPOINTS.task(taskId), { method: 'DELETE' })
}

/** 证据链导出（evidenceRef 的解析来源，§6.3 规格 4）。 */
export function apiEvidence(taskId) {
  return request(ENDPOINTS.taskEvidence(taskId))
}
