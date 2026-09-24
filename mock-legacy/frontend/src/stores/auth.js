import { defineStore } from 'pinia'

const LEGACY_TOKEN_KEY = 'campus_reservation_token'
const ACCESS_TOKEN_KEY = 'campus_reservation_access_token'
const REFRESH_TOKEN_KEY = 'campus_reservation_refresh_token'
const USER_KEY = 'campus_reservation_user'

function readUser() {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
    user: readUser()
  }),
  getters: {
    token: state => state.accessToken,
    role: state => state.user?.role
  },
  actions: {
    setAuth(accessToken, refreshToken, user) {
      this.accessToken = accessToken
      this.refreshToken = refreshToken
      this.user = user
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
      localStorage.removeItem(LEGACY_TOKEN_KEY)
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    },
    setTokens(accessToken, refreshToken) {
      this.accessToken = accessToken
      this.refreshToken = refreshToken
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
      localStorage.removeItem(LEGACY_TOKEN_KEY)
    },
    setUser(user) {
      this.user = user
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    },
    clearAuth() {
      this.accessToken = null
      this.refreshToken = null
      this.user = null
      localStorage.removeItem(ACCESS_TOKEN_KEY)
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      localStorage.removeItem(LEGACY_TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
  }
})
