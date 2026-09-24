<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UserFilled, Clock, Histogram, Timer, Lock, EditPen, Monitor } from '@element-plus/icons-vue'
import { authApi, reservationApi } from '../api'
import { getDeviceId } from '../api/http'
import { useAuthStore } from '../stores/auth'
import { userRoleText } from '../utils/dict'

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const nicknameLoading = ref(false)
const passwordLoading = ref(false)
const deviceLoading = ref(false)
const nicknameFormRef = ref()
const passwordFormRef = ref()
const activeReservations = ref([])
const historyReservations = ref([])
const deviceSessions = ref([])
const currentDeviceId = getDeviceId()
const nicknameForm = ref({
  nickname: ''
})
const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const nicknameRules = {
  nickname: [
    { required: true, message: '请输入昵称', trigger: 'blur' },
    { max: 20, message: '昵称长度不能超过 20 位', trigger: ['blur', 'change'] }
  ]
}

const passwordRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, max: 20, message: '新密码长度必须在 8 到 20 位之间', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_, value, callback) => {
        if (value !== passwordForm.value.newPassword) {
          callback(new Error('两次输入的新密码不一致'))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ]
}

const user = computed(() => authStore.user)

const behaviorLevel = computed(() => {
  const map = { A: '优秀', B: '良好', C: '一般' }
  return map[user.value?.creditLevel] || '优秀'
})

const behaviorTagType = computed(() => {
  const map = { A: 'success', B: 'warning', C: 'danger' }
  return map[user.value?.creditLevel] || 'success'
})

const totalReservations = computed(() => activeReservations.value.length + historyReservations.value.length)
const checkedInCount = computed(() => historyReservations.value.filter(item => item.attendanceStatus === 'CHECKED_IN').length)
const cancelledCount = computed(() => historyReservations.value.filter(item => item.status === 'CANCELLED').length)

function isCurrentDevice(session) {
  return session?.deviceId === currentDeviceId
}

function formatLoginTime(timestamp) {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function refreshUser() {
  try {
    const data = await authApi.me()
    authStore.setUser(data)
    nicknameForm.value.nickname = data.nickname || ''
  } catch {
    // keep existing user data on failure
  }
}

async function loadDeviceSessions() {
  deviceLoading.value = true
  try {
    deviceSessions.value = (await authApi.deviceSessions()) || []
  } finally {
    deviceLoading.value = false
  }
}

async function loadData() {
  loading.value = true
  try {
    await refreshUser()
    const [active, history, sessions] = await Promise.all([
      reservationApi.list(),
      reservationApi.history(),
      authApi.deviceSessions()
    ])
    activeReservations.value = active || []
    historyReservations.value = history || []
    deviceSessions.value = sessions || []
  } finally {
    loading.value = false
  }
}

async function updateNickname() {
  await nicknameFormRef.value.validate()
  nicknameLoading.value = true
  try {
    const data = await authApi.updateNickname({
      nickname: nicknameForm.value.nickname
    })
    authStore.setUser(data)
    nicknameForm.value.nickname = data.nickname || ''
    ElMessage.success('昵称修改成功')
  } finally {
    nicknameLoading.value = false
  }
}

async function revokeDevice(session) {
  const currentDevice = isCurrentDevice(session)
  await ElMessageBox.confirm(
    currentDevice ? '下线当前设备后将返回登录页，是否继续？' : `确认下线设备“${session.deviceName}”吗？`,
    '确认下线',
    {
      type: 'warning',
      confirmButtonText: '确认',
      cancelButtonText: '取消'
    }
  )

  deviceLoading.value = true
  try {
    await authApi.revokeDevice(session.deviceId)
    ElMessage.success('设备已下线')
    if (currentDevice) {
      authStore.clearAuth()
      router.replace('/login')
      return
    }
    await loadDeviceSessions()
  } finally {
    deviceLoading.value = false
  }
}

async function changePassword() {
  await passwordFormRef.value.validate()
  passwordLoading.value = true
  try {
    await authApi.changePassword({
      oldPassword: passwordForm.value.oldPassword,
      newPassword: passwordForm.value.newPassword
    })
    ElMessage.success('修改密码成功')
    passwordForm.value = {
      oldPassword: '',
      newPassword: '',
      confirmPassword: ''
    }
    passwordFormRef.value.clearValidate()
  } finally {
    passwordLoading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div v-loading="loading" class="profile-shell">
    <section class="panel profile-hero">
      <div class="profile-avatar">
        <el-icon :size="42"><UserFilled /></el-icon>
      </div>
      <div class="profile-main">
        <h2>{{ user?.nickname || user?.username }}</h2>
        <div class="profile-meta">
          <el-tag>{{ userRoleText(user?.role) }}</el-tag>
          <span>@{{ user?.username }}</span>
          <span>{{ user?.email }}</span>
        </div>
      </div>
      <div class="profile-behavior">
        <div class="behavior-badge">
          <span class="behavior-label">使用行为</span>
          <el-tag :type="behaviorTagType" size="large">{{ behaviorLevel }}</el-tag>
        </div>
      </div>
    </section>

    <div class="metric-row">
      <div class="metric">
        <div class="metric-label"><el-icon><Histogram /></el-icon> 累计预约</div>
        <div class="metric-value">{{ totalReservations }}</div>
      </div>
      <div class="metric">
        <div class="metric-label"><el-icon><Clock /></el-icon> 进行中</div>
        <div class="metric-value">{{ activeReservations.length }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">已签到</div>
        <div class="metric-value">{{ checkedInCount }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">已取消</div>
        <div class="metric-value">{{ cancelledCount }}</div>
      </div>
    </div>

    <div class="profile-grid">
      <section class="panel">
        <div class="toolbar">
          <div>
            <strong><el-icon><Timer /></el-icon> 预约参数</strong>
            <div class="hint">当前可预约的时间范围和时长限制</div>
          </div>
        </div>
        <div class="limit-list">
          <div class="limit-item">
            <span>可提前预约</span>
            <strong>{{ user?.seatReservationAdvanceHours || 24 }} 小时</strong>
          </div>
          <div class="limit-item">
            <span>单次预约最长</span>
            <strong>{{ Math.floor((user?.maxSingleReservationMinutes || 180) / 60) }} 小时</strong>
          </div>
          <div class="limit-item">
            <span>每日累计上限</span>
            <strong>{{ Math.floor((user?.dailyReservationLimitMinutes || 360) / 60) }} 小时</strong>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="toolbar">
          <div>
            <strong>账户信息</strong>
            <div class="hint">基本信息与角色</div>
          </div>
        </div>
        <div class="info-list">
          <div class="info-item">
            <span>用户名</span>
            <strong>{{ user?.username }}</strong>
          </div>
          <div class="info-item">
            <span>昵称</span>
            <strong>{{ user?.nickname || '-' }}</strong>
          </div>
          <div class="info-item">
            <span>邮箱</span>
            <strong>{{ user?.email || '-' }}</strong>
          </div>
          <div class="info-item">
            <span>角色</span>
            <el-tag>{{ userRoleText(user?.role) }}</el-tag>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="toolbar">
          <div>
            <strong><el-icon><EditPen /></el-icon> 修改昵称</strong>
            <div class="hint">修改后会立即同步到当前账号信息</div>
          </div>
        </div>
        <el-form
          ref="nicknameFormRef"
          :model="nicknameForm"
          :rules="nicknameRules"
          label-position="top"
          class="nickname-form"
        >
          <el-form-item label="昵称" prop="nickname">
            <el-input v-model="nicknameForm.nickname" maxlength="20" show-word-limit placeholder="请输入昵称" />
          </el-form-item>
          <el-button type="primary" :loading="nicknameLoading" @click="updateNickname">
            保存昵称
          </el-button>
        </el-form>
      </section>

      <section class="panel device-panel" v-loading="deviceLoading">
        <div class="toolbar">
          <div>
            <strong><el-icon><Monitor /></el-icon> 登录设备</strong>
            <div class="hint">最多保留 3 台设备，新设备登录会自动挤掉最旧设备</div>
          </div>
        </div>
        <div v-if="deviceSessions.length" class="device-list">
          <div v-for="session in deviceSessions" :key="session.deviceId" class="device-item">
            <div class="device-meta">
              <strong>{{ session.deviceName }}</strong>
              <div class="device-subline">
                <span>{{ session.deviceId }}</span>
                <span>登录时间：{{ formatLoginTime(session.loginTime) }}</span>
              </div>
            </div>
            <div class="device-actions">
              <el-tag v-if="isCurrentDevice(session)" type="success">当前设备</el-tag>
              <el-button size="small" type="danger" plain @click="revokeDevice(session)">
                {{ isCurrentDevice(session) ? '退出当前设备' : '下线设备' }}
              </el-button>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无在线设备记录" />
      </section>

      <section class="panel password-panel">
        <div class="toolbar">
          <div>
            <strong><el-icon><Lock /></el-icon> 修改密码</strong>
            <div class="hint">修改后请使用新密码登录，当前登录状态不会立刻失效</div>
          </div>
        </div>
        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="passwordRules"
          label-position="top"
          class="password-form"
        >
          <el-form-item label="旧密码" prop="oldPassword">
            <el-input
              v-model="passwordForm.oldPassword"
              type="password"
              show-password
              autocomplete="current-password"
              placeholder="请输入旧密码"
            />
          </el-form-item>
          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              show-password
              autocomplete="new-password"
              placeholder="8-20 位新密码"
            />
          </el-form-item>
          <el-form-item label="确认新密码" prop="confirmPassword">
            <el-input
              v-model="passwordForm.confirmPassword"
              type="password"
              show-password
              autocomplete="new-password"
              placeholder="请再次输入新密码"
            />
          </el-form-item>
          <el-button type="primary" :loading="passwordLoading" @click="changePassword">
            保存新密码
          </el-button>
        </el-form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.profile-shell {
  display: grid;
  gap: 16px;
}

.profile-hero {
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
}

.profile-avatar {
  width: 80px;
  height: 80px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #eff6ff;
  color: #2563eb;
  flex-shrink: 0;
}

.profile-main {
  min-width: 0;
  flex: 1;
}

.profile-main h2 {
  margin: 0 0 10px;
  color: #172033;
  font-size: 26px;
}

.profile-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: #667085;
  font-size: 13px;
}

.profile-behavior {
  flex-shrink: 0;
}

.behavior-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 28px;
  border: 1px solid #e4e8f0;
  border-radius: 10px;
  background: #fbfcff;
}

.behavior-label {
  color: #667085;
  font-size: 12px;
  font-weight: 600;
}

.metric-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.metric {
  padding: 18px;
  border: 1px solid #e4e8f0;
  border-radius: 12px;
  background: #fff;
}

.metric-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #667085;
  font-size: 13px;
}

.metric-value {
  margin-top: 10px;
  color: #172033;
  font-size: 26px;
  font-weight: 700;
}

.profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.device-panel,
.password-panel {
  grid-column: 1 / -1;
}

.nickname-form,
.password-form {
  max-width: 520px;
  margin-top: 16px;
}

.device-list,
.limit-list,
.info-list {
  display: grid;
  gap: 12px;
}

.device-item,
.limit-item,
.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
}

.device-meta {
  min-width: 0;
}

.device-meta strong {
  display: block;
  color: #172033;
  font-size: 14px;
}

.device-subline {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  color: #667085;
  font-size: 12px;
  word-break: break-all;
}

.device-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.limit-item span,
.info-item span {
  color: #667085;
  font-size: 13px;
}

.limit-item strong {
  color: #2563eb;
  font-size: 16px;
}

.info-item strong {
  color: #172033;
  font-size: 14px;
}

.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.toolbar .el-icon {
  margin-right: 6px;
  vertical-align: -2px;
  color: #2563eb;
}

@media (max-width: 960px) {
  .metric-row {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 860px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }

  .profile-hero,
  .device-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .profile-hero {
    text-align: center;
    align-items: center;
  }
}

@media (max-width: 640px) {
  .metric-row {
    grid-template-columns: 1fr;
  }

  .device-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
