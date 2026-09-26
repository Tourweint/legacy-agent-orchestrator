// API 端点常量 —— 集中管理所有后端路径，避免散落在各组件中
// 端点与错误码见 docs/基线文档/对外接口清单.md

export const API_BASE = '/api'

export const ENDPOINTS = {
  health: `${API_BASE}/health`,
  chat: `${API_BASE}/chat`,
  tasks: `${API_BASE}/tasks`,
  task: (taskId) => `${API_BASE}/tasks/${encodeURIComponent(taskId)}`,
  taskEvents: (taskId) => `${API_BASE}/tasks/${encodeURIComponent(taskId)}/events`,
  taskReply: (taskId) => `${API_BASE}/tasks/${encodeURIComponent(taskId)}/reply`,
  taskEvidence: (taskId) => `${API_BASE}/tasks/${encodeURIComponent(taskId)}/evidence`,
}

// 请求体大小限制（与后端 P1-3 修复一致）
export const REQUEST_LIMITS = {
  maxBodyBytes: 64 * 1024, // 64 KB
  maxTextLength: 2000,
  maxReasonLength: 500,
  maxResources: 10,
  maxHistoryRounds: 10,
}
