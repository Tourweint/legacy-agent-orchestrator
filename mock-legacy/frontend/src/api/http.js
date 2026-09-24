import axios from 'axios'
import { ElMessage } from 'element-plus'
import pinia from '../stores'
import { useAuthStore } from '../stores/auth'
import router from '../router'

const http = axios.create({
  baseURL: '/api',
  timeout: 12000
})

const refreshClient = axios.create({
  baseURL: '/api',
  timeout: 12000
})

const DEVICE_ID_KEY = 'campus_reservation_device_id'
let refreshPromise = null

export function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing

  const value =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`
  localStorage.setItem(DEVICE_ID_KEY, value)
  return value
}

function getDeviceName() {
  const ua = navigator.userAgent || ''
  const browser =
    ua.includes('Edg/') ? 'Edge'
      : ua.includes('Chrome/') ? 'Chrome'
        : ua.includes('Firefox/') ? 'Firefox'
          : ua.includes('Safari/') && !ua.includes('Chrome/') ? 'Safari'
            : 'Browser'
  const os =
    ua.includes('Windows') ? 'Windows'
      : ua.includes('Mac OS X') ? 'macOS'
        : ua.includes('Android') ? 'Android'
          : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS'
            : ua.includes('Linux') ? 'Linux'
              : 'Unknown OS'
  return `${browser} on ${os}`
}

function attachDeviceHeaders(config) {
  config.headers = config.headers ?? {}
  config.headers['X-Device-Id'] = getDeviceId()
  config.headers['X-Device-Name'] = getDeviceName()
  return config
}

function buildApiError(message, body) {
  const apiError = new Error(message)
  apiError.businessCode = body?.code
  apiError.response = { data: body }
  return apiError
}

function isAuthRoute(url = '') {
  return url.includes('/auth/login') || url.includes('/auth/refresh')
}

function redirectToLogin() {
  if (router.currentRoute.value.path !== '/login') {
    router.replace('/login')
  }
}

function showError(message, fallback = '请求失败') {
  ElMessage.error(message || fallback)
}

async function refreshAccessToken(authStore) {
  if (!authStore.refreshToken) {
    throw new Error('missing refresh token')
  }

  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post('/auth/refresh', { refreshToken: authStore.refreshToken })
      .then(response => {
        const body = response.data
        if (body && typeof body.code !== 'undefined' && body.code !== 200) {
          throw buildApiError(body.message || '刷新令牌失败', body)
        }
        const data = body?.data ?? body
        authStore.setAuth(data.accessToken, data.refreshToken, data.userInfo ?? authStore.user)
        return data.accessToken
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

async function retryWithRefresh(config, originalError) {
  const authStore = useAuthStore(pinia)
  if (config?._retry || config?.skipAuthRefresh || isAuthRoute(config?.url) || !authStore.refreshToken) {
    authStore.clearAuth()
    redirectToLogin()
    throw originalError
  }

  config._retry = true
  try {
    const accessToken = await refreshAccessToken(authStore)
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${accessToken}`
    attachDeviceHeaders(config)
    return http(config)
  } catch (refreshError) {
    authStore.clearAuth()
    redirectToLogin()
    throw refreshError
  }
}

http.interceptors.request.use(config => {
  const authStore = useAuthStore(pinia)
  const accessToken = authStore.accessToken
  attachDeviceHeaders(config)
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

refreshClient.interceptors.request.use(config => attachDeviceHeaders(config))

http.interceptors.response.use(
  response => {
    const body = response.data
    const silentError = response.config?.silentError
    if (body && typeof body.code !== 'undefined' && body.code !== 200) {
      if (body.code === 401) {
        if (isAuthRoute(response.config?.url)) {
          if (!silentError) {
            showError(body.message)
          }
          return Promise.reject(buildApiError(body.message || '请求失败', body))
        }
        return retryWithRefresh(response.config, buildApiError(body.message || '请求失败', body))
      }
      if (!silentError) {
        showError(body.message)
      }
      return Promise.reject(buildApiError(body.message || '请求失败', body))
    }
    return body?.data ?? body
  },
  error => {
    const status = error.response?.status
    const message = error.response?.data?.message || error.message || '网络请求失败'
    const silentError = error.config?.silentError
    if (status === 401) {
      if (isAuthRoute(error.config?.url)) {
        if (!silentError) {
          showError(message)
        }
        return Promise.reject(error)
      }
      return retryWithRefresh(error.config, error)
    }
    if (!silentError) {
      showError(message, '网络请求失败')
    }
    return Promise.reject(error)
  }
)

export default http
