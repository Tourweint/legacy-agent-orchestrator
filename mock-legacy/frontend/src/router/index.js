import { createRouter, createWebHistory } from 'vue-router'
import pinia from '../stores'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/classrooms', component: () => import('../views/ClassroomView.vue'), meta: { keepAlive: true, roles: ['STUDENT', 'TEACHER'] } },
  { path: '/reservations', component: () => import('../views/ReservationsView.vue'), meta: { roles: ['STUDENT', 'TEACHER'] } },
  { path: '/notifications', component: () => import('../views/NotificationCenterView.vue') },
  { path: '/statistics', component: () => import('../views/StatisticsView.vue'), meta: { roles: ['STUDENT', 'TEACHER'] } },
  { path: '/profile', component: () => import('../views/ProfileView.vue') },
  { path: '/admin', component: () => import('../views/AdminDashboardView.vue'), meta: { role: 'ADMIN' } },
  { path: '/admin/classrooms', component: () => import('../views/AdminClassroomsView.vue'), meta: { role: 'ADMIN' } },
  { path: '/admin/users', component: () => import('../views/AdminUsersView.vue'), meta: { role: 'ADMIN' } },
  { path: '/admin/reservations', component: () => import('../views/AdminReservationsView.vue'), meta: { role: 'ADMIN' } },
  { path: '/admin/maintenance', component: () => import('../views/AdminMaintenanceView.vue'), meta: { role: 'ADMIN' } },
  { path: '/admin/audit-logs', component: () => import('../views/AdminAuditLogsView.vue'), meta: { role: 'ADMIN' } },
  { path: '/admin/configs', component: () => import('../views/AdminConfigsView.vue'), meta: { role: 'ADMIN' } }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(to => {
  const authStore = useAuthStore(pinia)
  if (to.meta.public) {
    return true
  }
  if (!authStore.token) {
    return '/login'
  }
  const role = authStore.role
  if (to.meta.role && role !== to.meta.role) {
    return '/classrooms'
  }
  if (to.meta.roles && !to.meta.roles.includes(role)) {
    return role === 'ADMIN' ? '/admin' : '/dashboard'
  }
  return true
})

export default router
