export function resourceTypeText(type) {
  const map = {
    SEAT: '座位',
    CLASSROOM: '教室'
  }
  return map[type] || type || '-'
}

export function reservationStatusText(status) {
  const map = {
    ACTIVE: '进行中',
    CANCELLED: '已取消',
    EXPIRED: '已过期'
  }
  return map[status] || status || '-'
}

export function enabledStatusText(status) {
  const map = {
    ENABLED: '启用中',
    DISABLED: '已禁用'
  }
  return map[status] || status || '-'
}

export function userStatusText(status) {
  const map = {
    1: '正常',
    0: '已封禁'
  }
  return map[status] ?? status ?? '-'
}

export function userRoleText(role) {
  const map = {
    ADMIN: '管理员',
    TEACHER: '教师',
    STUDENT: '学生'
  }
  return map[role] || role || '-'
}

export function notificationTypeText(type) {
  const map = {
    USER_STATUS: '账号通知',
    RESERVATION_CANCELLED: '预约通知',
    RESERVATION_NO_SHOW: '爽约通知',
    WAITLIST_PROMOTED: '候补成功'
  }
  return map[type] || type || '系统通知'
}

export function attendanceStatusText(status) {
  const map = {
    PENDING: '待签到',
    CHECKED_IN: '已签到',
    NO_SHOW: '已爽约',
    CANCELLED: '已关闭'
  }
  return map[status] || status || '-'
}

export function waitlistStatusText(status) {
  const map = {
    WAITING: '排队中',
    PROMOTED: '已自动补位',
    CANCELLED: '已取消',
    EXPIRED: '已过期'
  }
  return map[status] || status || '-'
}
