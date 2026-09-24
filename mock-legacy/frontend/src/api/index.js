import http from './http'

export const authApi = {
  login: data => http.post('/auth/login', data),
  loginByCode: data => http.post('/auth/login/code', data),
  sendEmailCode: data => http.post('/auth/email-code', data),
  register: data => http.post('/auth/register', data),
  resetPasswordByCode: data => http.post('/auth/password/reset', data),
  refresh: (data, config = {}) => http.post('/auth/refresh', data, config),
  logout: (data, config = {}) => http.post('/auth/logout', data, config),
  me: () => http.get('/auth/me'),
  deviceSessions: () => http.get('/auth/devices'),
  revokeDevice: deviceId => http.delete(`/auth/devices/${encodeURIComponent(deviceId)}`),
  changePassword: data => http.put('/auth/password', data),
  updateNickname: data => http.put('/auth/nickname', data)
}

export const notificationApi = {
  list: params => http.get('/notifications', { params }),
  unreadCount: () => http.get('/notifications/unread-count'),
  markAllRead: () => http.patch('/notifications/read-all')
}

export const classroomApi = {
  buildings: () => http.get('/classrooms/buildings'),
  available: params => http.get('/classrooms/available_list', { params }),
  preferredBuildings: () => http.get('/classrooms/preferred_buildings'),
  detail: id => http.get(`/classrooms/${id}`),
  seats: id => http.get(`/classrooms/${id}/seats`)
}

export const reservationApi = {
  list: () => http.get('/reservations'),
  history: () => http.get('/reservations/history'),
  reservedSeats: (id, params, config = {}) => http.get(`/classrooms/${id}/reserved_seats`, { params, ...config }),
  reserveSeat: (data, config = {}) => http.post('/reservations/seats', data, config),
  reserveClassroom: data => http.post('/reservations/classrooms', data),
  checkIn: id => http.post(`/reservations/${id}/check-in`),
  cancel: id => http.delete(`/reservations/${id}`)
}

export const waitlistApi = {
  create: data => http.post('/waitlist', data),
  list: () => http.get('/waitlist/my'),
  cancel: id => http.delete(`/waitlist/${id}`)
}

export const adminApi = {
  analytics: params => http.get('/admin/analytics', { params }),
  classrooms: params => http.get('/admin/classrooms/list', { params }),
  createClassroom: data => http.post('/admin/classrooms', data),
  updateClassroom: (id, data) => http.put(`/admin/classrooms/${id}`, data),
  initSeats: id => http.post(`/admin/classrooms/${id}/seat_layout`),
  createSeat: (id, data) => http.post(`/admin/classrooms/${id}/seats`, data),
  batchSeatStatus: (id, data) => http.patch(`/admin/classrooms/${id}/seat_layout`, data),
  deleteSeatLayout: id => http.delete(`/admin/classrooms/${id}/seat_layout`),
  updateSeat: (id, data) => http.put(`/admin/seats/${id}`, data),
  deleteSeat: id => http.delete(`/admin/seats/${id}`),
  users: params => http.get('/admin/users', { params }),
  exportUsers: params => http.get('/admin/users/export', { params, responseType: 'blob' }),
  updateUserStatus: (id, data) => http.patch(`/admin/users/${id}/status`, data),
  forceLogoutUser: (id, data) => http.post(`/admin/users/${id}/logout`, data),
  reservations: params => http.get('/admin/reservations', { params }),
  exportReservations: params => http.get('/admin/reservations/export', { params, responseType: 'blob' }),
  cancelReservation: (id, data) => http.delete(`/admin/reservations/${id}`, { data }),
  maintenance: params => http.get('/admin/maintenance', { params }),
  createMaintenance: data => http.post('/admin/maintenance', data),
  cancelMaintenance: id => http.delete(`/admin/maintenance/${id}`),
  auditLogs: params => http.get('/admin/audit-logs', { params }),
  configs: params => http.get('/admin/configs', { params }),
  updateConfig: (key, data) => http.put(`/admin/configs/${key}`, data)
}
