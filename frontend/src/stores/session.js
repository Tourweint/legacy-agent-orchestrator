// 会话状态（Pinia）—— 登录方案决定 1/2/5/6 的前端落点。
//
// 三条纪律：
//   · 前端**不持有任何令牌**：引擎下发 HttpOnly Cookie，浏览器自动携带；这里只存"我是谁"
//   · 角色来自引擎响应（引擎的角色来自存量系统登录响应）——前端不推断、不缓存权限判断结果
//   · 会话失效一律**如实提示并要求重新登录**（决定 8），不假装还登录着、不静默重试

import { defineStore } from 'pinia'
import { apiLogin, apiLogout, apiMe } from '../api/client.js'

/** 角色中文名（零术语纪律：界面上不出现 TEACHER/STUDENT 这类枚举）。 */
export const ROLE_LABELS = { TEACHER: '教师', STUDENT: '学生', ADMIN: '管理员' }

export const useSessionStore = defineStore('session', {
  state: () => ({
    // unknown（还没问过）| checking（正在问）| anonymous（未登录）| authenticated（已登录）
    status: 'unknown',
    user: null,
    role: null,
    error: null,
    // 会话失效提示（登录页显示"N5 人话"提示，而不是把数字码甩给用户）
    expiredNotice: false,
    submitting: false,
  }),

  getters: {
    isLoggedIn: (s) => s.status === 'authenticated',
    displayName: (s) => s.user?.nickname || s.user?.username || '',
    roleLabel: (s) => ROLE_LABELS[s.role] ?? '',
  },

  actions: {
    /** 进入应用时问一次"我是谁"：有效会话→直接进主界面；无效→登录页。 */
    async restore() {
      this.status = 'checking'
      const res = await apiMe()
      if (res.httpStatus === 200 && res.code === 0) {
        this._applyIdentity(res.data)
        return true
      }
      this.user = null
      this.role = null
      this.status = 'anonymous'
      return false
    },

    async login(username, password) {
      this.submitting = true
      this.error = null
      this.expiredNotice = false
      try {
        const res = await apiLogin(username, password)
        if (res.code !== 0) {
          // 引擎已把人话写好了（"账号或密码不正确"）；拿不到就用兜底文案
          this.error = res.message || '登录失败，请重试'
          return false
        }
        this._applyIdentity(res.data)
        return true
      } finally {
        this.submitting = false
      }
    },

    async logout() {
      await apiLogout()
      this.user = null
      this.role = null
      this.status = 'anonymous'
      this.expiredNotice = false
    },

    /** 任何受保护端点返回 401 时调用：退回登录页并给出"登录已过期"人话提示。 */
    markExpired(message) {
      this.user = null
      this.role = null
      this.error = message ?? null
      this.expiredNotice = true
      this.status = 'anonymous'
    },

    _applyIdentity(data) {
      this.user = data?.userInfo ?? null
      this.role = data?.role ?? data?.userInfo?.role ?? null
      this.status = 'authenticated'
      this.error = null
      this.expiredNotice = false
    },
  },
})
