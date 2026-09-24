<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Bell,
  DataBoard,
  Document,
  OfficeBuilding,
  School,
  Setting,
  SwitchButton,
  Tickets,
  TrendCharts,
  UserFilled
} from '@element-plus/icons-vue'
import { authApi } from './api'
import { useAuthStore } from './stores/auth'
import { userRoleText } from './utils/dict'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

async function refreshUser() {
  if (!authStore.accessToken) return
  try {
    const data = await authApi.me()
    authStore.setUser(data)
  } catch {
    authStore.clearAuth()
  }
}

async function logout() {
  try {
    if (authStore.refreshToken) {
      await authApi.logout({ refreshToken: authStore.refreshToken }, { silentError: true })
    }
  } finally {
    authStore.clearAuth()
    router.replace('/login')
  }
}

const menuIndex = computed(() => {
  const path = route.path
  if (path.startsWith('/admin')) {
    return path === '/admin' ? '/admin' : path
  }
  return path
})

const pageMeta = computed(() => {
  const path = route.path
  const map = {
    '/dashboard': { title: '工作台', subtitle: '汇总今日任务、通知与常用操作入口' },
    '/classrooms': { title: '教室与座位', subtitle: '按时间检索可用资源并创建预约' },
    '/reservations': { title: '我的预约', subtitle: '查看当前预约、历史记录和签到状态' },
    '/notifications': { title: '通知中心', subtitle: '查看所有站内通知，支持按类型筛选' },
    '/statistics': { title: '我的统计', subtitle: '查看预约趋势、偏好楼栋和签到情况' },
    '/profile': { title: '个人中心', subtitle: '查看账号信息、设备会话与账号安全设置' },
    '/admin': { title: '数据总览', subtitle: '查看教室利用率、热门楼栋和时间段热度' },
    '/admin/classrooms': { title: '教室管理', subtitle: '维护教室状态、座位布局和可用性' },
    '/admin/users': { title: '用户管理', subtitle: '筛选用户并执行封禁、恢复或强制下线' },
    '/admin/reservations': { title: '预约管理', subtitle: '检索所有预约记录并执行管理员取消' },
    '/admin/maintenance': { title: '维护管理', subtitle: '维护教室或座位，维护期间自动阻止预约' },
    '/admin/audit-logs': { title: '操作日志', subtitle: '查看管理员关键操作的审计记录' },
    '/admin/configs': { title: '规则配置', subtitle: '统一维护预约、签到和信誉规则并即时生效' }
  }
  return map[path] || { title: '教室预约', subtitle: '按时间检索可用资源并创建预约' }
})

onMounted(() => {
  refreshUser()
})
</script>

<template>
  <router-view v-if="$route.path === '/login'" />
  <el-container v-else class="app-shell">
    <el-aside width="232px" class="sidebar">
      <div class="brand">
        <div class="brand-mark">
          <el-icon><School /></el-icon>
        </div>
        <div>
          <span>教室预约</span>
          <small>校园预约平台</small>
        </div>
      </div>

      <el-menu :default-active="menuIndex" router class="side-menu">
        <el-menu-item index="/dashboard">
          <el-icon><DataBoard /></el-icon>
          <span>工作台</span>
        </el-menu-item>

        <el-menu-item v-if="user?.role !== 'ADMIN'" index="/classrooms">
          <el-icon><OfficeBuilding /></el-icon>
          <span>{{ user?.role === 'TEACHER' ? '查找空教室' : '查找座位' }}</span>
        </el-menu-item>

        <el-menu-item v-if="user?.role !== 'ADMIN'" index="/reservations">
          <el-icon><Tickets /></el-icon>
          <span>我的预约</span>
        </el-menu-item>

        <el-menu-item v-if="user?.role !== 'ADMIN'" index="/statistics">
          <el-icon><TrendCharts /></el-icon>
          <span>我的统计</span>
        </el-menu-item>

        <el-sub-menu v-if="user?.role === 'ADMIN'" index="admin-group">
          <template #title>
            <el-icon><Setting /></el-icon>
            <span>后台管理</span>
          </template>
          <el-menu-item index="/admin">
            <el-icon><DataBoard /></el-icon>
            <span>数据总览</span>
          </el-menu-item>
          <el-menu-item index="/admin/classrooms">
            <el-icon><OfficeBuilding /></el-icon>
            <span>教室管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/users">
            <el-icon><UserFilled /></el-icon>
            <span>用户管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/reservations">
            <el-icon><Tickets /></el-icon>
            <span>预约管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/maintenance">
            <el-icon><Setting /></el-icon>
            <span>维护管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/audit-logs">
            <el-icon><Document /></el-icon>
            <span>操作日志</span>
          </el-menu-item>
          <el-menu-item index="/admin/configs">
            <el-icon><SwitchButton /></el-icon>
            <span>规则配置</span>
          </el-menu-item>
        </el-sub-menu>

        <el-menu-item v-if="user?.role !== 'ADMIN'" index="/notifications">
          <el-icon><Bell /></el-icon>
          <span>通知中心</span>
        </el-menu-item>

        <el-menu-item v-if="user?.role === 'STUDENT'" index="/profile">
          <el-icon><UserFilled /></el-icon>
          <span>个人中心</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="topbar">
        <div>
          <div class="page-title">{{ pageMeta.title }}</div>
          <div class="page-subtitle">{{ pageMeta.subtitle }}</div>
        </div>
        <div class="user-zone">
          <el-tag class="role-tag" effect="plain">{{ user?.role ? userRoleText(user.role) : '用户' }}</el-tag>
          <div class="user-pill">
            <el-icon><UserFilled /></el-icon>
            <span>{{ user?.nickname || user?.username }}</span>
          </div>
          <el-button :icon="SwitchButton" plain @click="logout">退出</el-button>
        </div>
      </el-header>

      <el-main class="main">
        <router-view v-slot="{ Component, route: currentRoute }">
          <keep-alive>
            <component :is="Component" v-if="currentRoute.meta.keepAlive" />
          </keep-alive>
          <component :is="Component" v-if="!currentRoute.meta.keepAlive" />
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>
