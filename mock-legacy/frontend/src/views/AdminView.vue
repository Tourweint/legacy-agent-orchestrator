<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  CircleClose,
  Edit,
  Grid,
  Plus,
  Refresh,
  Search
} from '@element-plus/icons-vue'
import AdminAnalyticsPanel from '../components/AdminAnalyticsPanel.vue'
import { adminApi, classroomApi } from '../api'
import {
  buildingOptions,
  ensureBuildingOptionsLoaded,
  getDefaultBuildingValue,
  hasBuildingOption,
  refreshBuildingOptions
} from '../config/buildings'
import {
  enabledStatusText,
  reservationStatusText,
  resourceTypeText,
  userRoleText,
  userStatusText
} from '../utils/dict'
import { formatDateTimeText } from '../utils/date'

const activeTab = ref('classrooms')
const loading = ref(false)

const classrooms = ref([])
const selected = ref(null)
const layout = ref(null)
const classroomDialog = ref(false)
const seatDialog = ref(false)
const createSeatDialog = ref(false)
const editingSeat = ref(null)

const users = ref([])
const userDialog = ref(false)
const editingUser = ref(null)

const reservations = ref([])
const reservationDialog = ref(false)
const editingReservation = ref(null)

const configs = ref([])
const configCategory = ref('')
const savingConfigKey = ref('')

const classroomFilters = ref({
  building: '',
  min_capacity: 1,
  status: 'ENABLED'
})

const userFilters = ref({
  keyword: '',
  role: '',
  status: null
})

const reservationFilters = ref({
  keyword: '',
  status: ''
})

const classroomForm = ref({
  roomNumber: '',
  building: '',
  seatRows: 8,
  seatCols: 6,
  status: 'ENABLED',
  remark: ''
})

const seatForm = ref({
  status: 'ENABLED',
  remark: ''
})

const createSeatForm = ref({
  rowNumber: 1,
  colNumber: 1,
  status: 'ENABLED',
  remark: ''
})

const userForm = ref({
  status: 1,
  reason: ''
})

const reservationForm = ref({
  reason: ''
})

const configCategoryOptions = [
  { label: '全部分类', value: '' },
  { label: '预约规则', value: 'RESERVATION' },
  { label: '签到规则', value: 'ATTENDANCE' },
  { label: '信誉规则', value: 'CREDIT' },
  { label: '前端展示', value: 'UI' }
]

const generatedSeatNumber = computed(() => `${createSeatForm.value.rowNumber}-${createSeatForm.value.colNumber}`)
const enabledClassrooms = computed(() => classrooms.value.filter(item => item.status === 'ENABLED').length)
const disabledSeats = computed(() => layout.value?.seatVOS?.filter(item => item.status === 'DISABLED').length || 0)
const enabledSeats = computed(() => layout.value?.seatVOS?.filter(item => item.status === 'ENABLED').length || 0)
const activeUsers = computed(() => users.value.filter(item => item.status === 1).length)
const bannedUsers = computed(() => users.value.filter(item => item.status === 0).length)
const activeReservations = computed(() => reservations.value.filter(item => item.status === 'ACTIVE').length)
const cancelledReservations = computed(() => reservations.value.filter(item => item.status === 'CANCELLED').length)

async function loadClassrooms() {
  if (!classroomFilters.value.building) {
    classrooms.value = []
    selected.value = null
    layout.value = null
    return
  }
  loading.value = true
  try {
    classrooms.value = await adminApi.classrooms({
      building: classroomFilters.value.building,
      min_capacity: classroomFilters.value.min_capacity,
      status: classroomFilters.value.status
    })
  } finally {
    loading.value = false
  }
}

async function loadSeats(row) {
  selected.value = row
  layout.value = await classroomApi.seats(row.id)
}

async function loadUsers() {
  loading.value = true
  try {
    users.value = await adminApi.users({
      keyword: userFilters.value.keyword || undefined,
      role: userFilters.value.role || undefined,
      status: userFilters.value.status
    })
  } finally {
    loading.value = false
  }
}

async function loadReservations() {
  loading.value = true
  try {
    reservations.value = await adminApi.reservations({
      keyword: reservationFilters.value.keyword || undefined,
      status: reservationFilters.value.status || undefined
    })
  } finally {
    loading.value = false
  }
}

async function loadConfigs() {
  loading.value = true
  try {
    const data = await adminApi.configs({
      category: configCategory.value || undefined
    })
    configs.value = (data || []).map(item => ({
      ...item,
      editValue: item.configValue
    }))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  classroomForm.value = {
    roomNumber: '',
    building: classroomFilters.value.building || getDefaultBuildingValue(),
    seatRows: 8,
    seatCols: 6,
    status: 'ENABLED',
    remark: ''
  }
  classroomDialog.value = true
}

function openEdit(row) {
  classroomForm.value = {
    id: row.id,
    roomNumber: row.roomNumber,
    building: row.building,
    seatRows: row.seatRows,
    seatCols: row.seatCols,
    status: row.status,
    remark: row.remark
  }
  classroomDialog.value = true
}

async function saveClassroom() {
  const payload = {
    roomNumber: classroomForm.value.roomNumber,
    building: classroomForm.value.building,
    seatRows: classroomForm.value.seatRows,
    seatCols: classroomForm.value.seatCols,
    status: classroomForm.value.status,
    remark: classroomForm.value.remark
  }

  if (classroomForm.value.id) {
    await adminApi.updateClassroom(classroomForm.value.id, payload)
    ElMessage.success('教室已更新')
  } else {
    await adminApi.createClassroom(payload)
    ElMessage.success('教室已创建')
  }
  await refreshBuildingOptions()
  if (!hasBuildingOption(classroomFilters.value.building)) {
    classroomFilters.value.building = getDefaultBuildingValue()
  }
  classroomDialog.value = false
  await loadClassrooms()
}

async function initSeats(row) {
  await ElMessageBox.confirm(`确认初始化 ${row.building} ${row.roomNumber} 的座位布局吗？`, '初始化座位', {
    type: 'warning'
  })
  await adminApi.initSeats(row.id)
  ElMessage.success('座位布局已初始化')
  await loadSeats(row)
}

function openSeat(seat) {
  editingSeat.value = seat
  seatForm.value = {
    status: seat.status,
    remark: seat.remark || ''
  }
  seatDialog.value = true
}

function openCreateSeat() {
  if (!selected.value) return
  createSeatForm.value = {
    rowNumber: 1,
    colNumber: 1,
    status: 'ENABLED',
    remark: ''
  }
  createSeatDialog.value = true
}

async function saveSeat() {
  await adminApi.updateSeat(editingSeat.value.id, seatForm.value)
  ElMessage.success('座位已更新')
  seatDialog.value = false
  await loadSeats(selected.value)
}

async function saveCreatedSeat() {
  if (!selected.value) return
  await adminApi.createSeat(selected.value.id, {
    ...createSeatForm.value,
    seatNumber: generatedSeatNumber.value
  })
  ElMessage.success('座位已新增')
  createSeatDialog.value = false
  await loadSeats(selected.value)
}

async function deleteSeat() {
  if (!editingSeat.value) return
  await ElMessageBox.confirm(`确认删除座位 ${editingSeat.value.seatNumber} 吗？`, '删除座位', {
    type: 'warning'
  })
  await adminApi.deleteSeat(editingSeat.value.id)
  ElMessage.success('座位已删除')
  seatDialog.value = false
  await loadSeats(selected.value)
}

async function batchDisable(status) {
  if (!selected.value) return
  await adminApi.batchSeatStatus(selected.value.id, { status })
  ElMessage.success('座位状态已批量更新')
  await loadSeats(selected.value)
}

function seatStyle(seat) {
  return {
    gridColumn: seat.colNumber,
    gridRow: seat.rowNumber
  }
}

function openUserDialog(row) {
  editingUser.value = row
  userForm.value = {
    status: row.status,
    reason: ''
  }
  userDialog.value = true
}

async function saveUserStatus() {
  await adminApi.updateUserStatus(editingUser.value.id, userForm.value)
  ElMessage.success(userForm.value.status === 0 ? '用户已封禁并已通知' : '用户已恢复并已通知')
  userDialog.value = false
  await loadUsers()
}

function openReservationDialog(row) {
  editingReservation.value = row
  reservationForm.value = {
    reason: ''
  }
  reservationDialog.value = true
}

async function cancelReservation() {
  await adminApi.cancelReservation(editingReservation.value.id, reservationForm.value)
  ElMessage.success('预约已取消，用户已收到通知')
  reservationDialog.value = false
  await loadReservations()
}

async function saveConfig(row) {
  if (!row?.configKey || row.editable !== 1) return
  savingConfigKey.value = row.configKey
  try {
    const data = await adminApi.updateConfig(row.configKey, {
      configValue: row.editValue
    })
    row.configValue = data.configValue
    row.editValue = data.configValue
    ElMessage.success('规则配置已更新')
  } finally {
    savingConfigKey.value = ''
  }
}

function configCategoryText(category) {
  return configCategoryOptions.find(item => item.value === category)?.label || category || '-'
}

function handleTabChange(tab) {
  if (tab === 'classrooms' && classrooms.value.length === 0) {
    loadClassrooms()
  }
  if (tab === 'users' && users.value.length === 0) {
    loadUsers()
  }
  if (tab === 'reservations' && reservations.value.length === 0) {
    loadReservations()
  }
  if (tab === 'configs' && configs.value.length === 0) {
    loadConfigs()
  }
}

onMounted(async () => {
  await ensureBuildingOptionsLoaded()
  if (!hasBuildingOption(classroomFilters.value.building)) {
    classroomFilters.value.building = getDefaultBuildingValue()
  }
  await loadClassrooms()
})
</script>

<template>
  <div class="metric-row">
    <div class="metric">
      <div class="metric-label">教室总数</div>
      <div class="metric-value">{{ classrooms.length }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">正常用户</div>
      <div class="metric-value">{{ activeUsers }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">进行中预约</div>
      <div class="metric-value">{{ activeReservations }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">已封禁用户</div>
      <div class="metric-value">{{ bannedUsers }}</div>
    </div>
  </div>

  <div class="panel">
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="统计分析" name="analytics">
        <AdminAnalyticsPanel />
      </el-tab-pane>

      <el-tab-pane label="教室与座位" name="classrooms">
        <div class="toolbar admin-toolbar">
          <div>
            <strong>教室资源管理</strong>
            <div class="hint">维护教室状态、座位布局和单个座位可用性。</div>
          </div>
          <div class="form-row">
            <el-select v-model="classroomFilters.building" filterable placeholder="教学楼" style="width: 160px">
              <el-option
                v-for="building in buildingOptions"
                :key="building.value"
                :label="building.label"
                :value="building.value"
              />
            </el-select>
            <el-input-number v-model="classroomFilters.min_capacity" :min="1" />
            <el-select v-model="classroomFilters.status" style="width: 130px">
              <el-option label="启用" value="ENABLED" />
              <el-option label="禁用" value="DISABLED" />
            </el-select>
            <el-button type="primary" :icon="Search" @click="loadClassrooms">查询</el-button>
            <el-button :icon="Refresh" @click="loadClassrooms">刷新</el-button>
            <el-button type="primary" :icon="Plus" @click="openCreate">新增教室</el-button>
          </div>
        </div>

        <div class="admin-grid">
          <section class="panel inner-panel">
            <div class="mini-stats">
              <span>启用教室 {{ enabledClassrooms }}</span>
              <span>禁用座位 {{ disabledSeats }}</span>
            </div>
            <el-table :data="classrooms" v-loading="loading" height="320" @row-click="loadSeats">
              <el-table-column prop="building" label="教学楼" min-width="120" />
              <el-table-column prop="roomNumber" label="教室" width="100" />
              <el-table-column prop="capacity" label="容量" width="90" />
              <el-table-column prop="status" label="状态" width="110">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'ENABLED' ? 'success' : 'danger'">
                    {{ enabledStatusText(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
              <el-table-column label="操作" width="220" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" :icon="Edit" @click.stop="openEdit(row)">编辑</el-button>
                  <el-button size="small" :icon="Grid" @click.stop="initSeats(row)">初始化座位</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section class="panel inner-panel">
            <div class="toolbar">
              <div>
                <strong>{{ selected ? `${selected.building} ${selected.roomNumber}` : '座位维护' }}</strong>
                <div class="hint">点击座位可修改状态，支持整间教室批量启用或禁用。</div>
              </div>
              <div class="form-row">
                <el-button :disabled="!selected" type="primary" plain :icon="Plus" @click="openCreateSeat">新增座位</el-button>
                <el-button :disabled="!selected" :icon="CircleCheck" @click="batchDisable('ENABLED')">全部启用</el-button>
                <el-button :disabled="!selected" :icon="CircleClose" @click="batchDisable('DISABLED')">全部禁用</el-button>
              </div>
            </div>

            <div v-if="layout" class="seat-admin-summary">
              <div>
                <span>启用座位</span>
                <strong>{{ enabledSeats }}</strong>
              </div>
              <div>
                <span>禁用座位</span>
                <strong>{{ disabledSeats }}</strong>
              </div>
              <div>
                <span>总座位</span>
                <strong>{{ layout.seatVOS.length }}</strong>
              </div>
            </div>

            <el-empty v-if="!layout" description="请选择左侧教室查看座位布局" />
            <div
              v-else
              class="seat-grid"
              :style="{ gridTemplateColumns: `repeat(${layout.seatCols}, 44px)`, gridTemplateRows: `repeat(${layout.seatRows}, 40px)` }"
            >
              <button
                v-for="seat in layout.seatVOS"
                :key="seat.id"
                class="seat-cell"
                :class="{ 'is-disabled': seat.status === 'DISABLED' }"
                :style="seatStyle(seat)"
                @click="openSeat(seat)"
              >
                {{ seat.seatNumber }}
              </button>
            </div>
          </section>
        </div>
      </el-tab-pane>

      <el-tab-pane label="用户管理" name="users">
        <div class="toolbar admin-toolbar">
          <div>
            <strong>用户管理</strong>
            <div class="hint">按角色和状态筛选用户，并执行封禁或恢复。</div>
          </div>
          <div class="form-row">
            <el-input v-model="userFilters.keyword" placeholder="用户名 / 昵称 / 邮箱" clearable style="width: 220px" />
            <el-select v-model="userFilters.role" clearable placeholder="角色" style="width: 120px">
              <el-option label="学生" value="STUDENT" />
              <el-option label="教师" value="TEACHER" />
            </el-select>
            <el-select v-model="userFilters.status" clearable placeholder="状态" style="width: 120px">
              <el-option label="正常" :value="1" />
              <el-option label="已封禁" :value="0" />
            </el-select>
            <el-button type="primary" :icon="Search" @click="loadUsers">查询</el-button>
            <el-button :icon="Refresh" @click="loadUsers">刷新</el-button>
          </div>
        </div>

        <div class="mini-stats">
          <span>正常 {{ activeUsers }}</span>
          <span>封禁 {{ bannedUsers }}</span>
        </div>

        <el-table :data="users" v-loading="loading">
          <el-table-column prop="username" label="用户名" min-width="140" />
          <el-table-column prop="nickname" label="昵称" min-width="120" />
          <el-table-column prop="email" label="邮箱" min-width="200" />
          <el-table-column prop="role" label="角色" width="110">
            <template #default="{ row }">{{ userRoleText(row.role) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'danger'">
                {{ userStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" min-width="180">
            <template #default="{ row }">{{ formatDateTimeText(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" @click="openUserDialog(row)">
                {{ row.status === 1 ? '封禁/恢复' : '恢复/封禁' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="预约管理" name="reservations">
        <div class="toolbar admin-toolbar">
          <div>
            <strong>预约管理</strong>
            <div class="hint">按预约状态和关键字检索，取消后会给用户发送站内通知。</div>
          </div>
          <div class="form-row">
            <el-input v-model="reservationFilters.keyword" placeholder="用户 / 资源 / 原因 / 预约ID" clearable style="width: 260px" />
            <el-select v-model="reservationFilters.status" clearable placeholder="预约状态" style="width: 140px">
              <el-option label="进行中" value="ACTIVE" />
              <el-option label="已取消" value="CANCELLED" />
              <el-option label="已过期" value="EXPIRED" />
            </el-select>
            <el-button type="primary" :icon="Search" @click="loadReservations">查询</el-button>
            <el-button :icon="Refresh" @click="loadReservations">刷新</el-button>
          </div>
        </div>

        <div class="mini-stats">
          <span>进行中 {{ activeReservations }}</span>
          <span>已取消 {{ cancelledReservations }}</span>
        </div>

        <el-table :data="reservations" v-loading="loading">
          <el-table-column prop="id" label="预约ID" width="100" />
          <el-table-column label="用户" min-width="160">
            <template #default="{ row }">{{ row.nickname || row.username }}（{{ row.username }}）</template>
          </el-table-column>
          <el-table-column label="类型" width="100">
            <template #default="{ row }">{{ resourceTypeText(row.resourceType) }}</template>
          </el-table-column>
          <el-table-column prop="resourceName" label="资源" min-width="180" />
          <el-table-column label="开始时间" min-width="180">
            <template #default="{ row }">{{ formatDateTimeText(row.startTime) }}</template>
          </el-table-column>
          <el-table-column label="结束时间" min-width="180">
            <template #default="{ row }">{{ formatDateTimeText(row.endTime) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ACTIVE' ? 'success' : row.status === 'CANCELLED' ? 'warning' : 'info'">
                {{ reservationStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="danger" :disabled="row.status !== 'ACTIVE'" @click="openReservationDialog(row)">
                取消预约
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="规则配置" name="configs">
        <div class="toolbar admin-toolbar">
          <div>
            <strong>规则配置</strong>
            <div class="hint">统一维护预约、签到和信誉规则，修改后后端会按最新配置立即生效。</div>
          </div>
          <div class="form-row">
            <el-select v-model="configCategory" style="width: 150px" @change="loadConfigs">
              <el-option
                v-for="item in configCategoryOptions"
                :key="item.value || 'ALL'"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
            <el-button type="primary" :icon="Search" @click="loadConfigs">查询</el-button>
            <el-button :icon="Refresh" @click="loadConfigs">刷新</el-button>
          </div>
        </div>

        <div class="mini-stats">
          <span>配置项 {{ configs.length }}</span>
          <span>当前分类 {{ configCategoryText(configCategory) }}</span>
        </div>

        <el-table :data="configs" v-loading="loading">
          <el-table-column prop="configName" label="名称" min-width="180" />
          <el-table-column prop="configKey" label="配置键" min-width="240" show-overflow-tooltip />
          <el-table-column label="分类" width="120">
            <template #default="{ row }">{{ configCategoryText(row.category) }}</template>
          </el-table-column>
          <el-table-column prop="valueType" label="类型" width="100" />
          <el-table-column label="当前值" min-width="200">
            <template #default="{ row }">
              <el-input
                v-if="row.editable === 1"
                v-model="row.editValue"
                class="config-value-input"
                maxlength="255"
              />
              <span v-else>{{ row.configValue }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
          <el-table-column label="可编辑" width="90">
            <template #default="{ row }">
              <el-tag :type="row.editable === 1 ? 'success' : 'info'">
                {{ row.editable === 1 ? '是' : '否' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <div v-if="row.editable === 1" class="config-actions">
                <el-button
                  size="small"
                  type="primary"
                  :loading="savingConfigKey === row.configKey"
                  @click="saveConfig(row)"
                >
                  保存
                </el-button>
              </div>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>

  <el-dialog v-model="classroomDialog" :title="classroomForm.id ? '编辑教室' : '新增教室'" width="560px">
    <el-form :model="classroomForm" label-position="top">
      <div class="dialog-grid">
        <el-form-item label="教学楼">
          <el-select v-model="classroomForm.building" filterable style="width: 100%">
            <el-option
              v-for="building in buildingOptions"
              :key="building.value"
              :label="building.label"
              :value="building.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="教室号">
          <el-input v-model="classroomForm.roomNumber" />
        </el-form-item>
        <el-form-item label="座位行数">
          <el-input-number v-model="classroomForm.seatRows" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="座位列数">
          <el-input-number v-model="classroomForm.seatCols" :min="1" :max="100" />
        </el-form-item>
      </div>
      <el-form-item label="状态">
        <el-select v-model="classroomForm.status" style="width: 100%">
          <el-option label="启用" value="ENABLED" />
          <el-option label="禁用" value="DISABLED" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="classroomForm.remark" type="textarea" :rows="3" maxlength="255" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="classroomDialog = false">取消</el-button>
      <el-button type="primary" @click="saveClassroom">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="seatDialog" title="编辑座位" width="460px">
    <el-form :model="seatForm" label-position="top">
      <el-form-item label="状态">
        <el-select v-model="seatForm.status" style="width: 100%">
          <el-option label="启用" value="ENABLED" />
          <el-option label="禁用" value="DISABLED" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="seatForm.remark" type="textarea" :rows="3" maxlength="255" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="dialog-footer-split">
        <el-button type="danger" plain @click="deleteSeat">删除座位</el-button>
        <div class="dialog-footer-actions">
          <el-button @click="seatDialog = false">取消</el-button>
          <el-button type="primary" @click="saveSeat">保存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="createSeatDialog" title="新增座位" width="520px">
    <el-form :model="createSeatForm" label-position="top">
      <div class="dialog-grid">
        <el-form-item label="座位编号">
          <el-input :model-value="generatedSeatNumber" disabled />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="createSeatForm.status" style="width: 100%">
            <el-option label="启用" value="ENABLED" />
            <el-option label="禁用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="行号">
          <el-input-number v-model="createSeatForm.rowNumber" :min="1" :max="selected?.seatRows || 100" />
        </el-form-item>
        <el-form-item label="列号">
          <el-input-number v-model="createSeatForm.colNumber" :min="1" :max="selected?.seatCols || 100" />
        </el-form-item>
      </div>
      <el-form-item label="备注">
        <el-input v-model="createSeatForm.remark" type="textarea" :rows="3" maxlength="255" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createSeatDialog = false">取消</el-button>
      <el-button type="primary" @click="saveCreatedSeat">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="userDialog" :title="editingUser ? `管理用户 ${editingUser.username}` : '管理用户'" width="520px">
    <el-form :model="userForm" label-position="top">
      <el-form-item label="状态">
        <el-select v-model="userForm.status" style="width: 100%">
          <el-option label="正常" :value="1" />
          <el-option label="已封禁" :value="0" />
        </el-select>
      </el-form-item>
      <el-form-item label="通知原因">
        <el-input
          v-model="userForm.reason"
          type="textarea"
          :rows="3"
          maxlength="255"
          show-word-limit
          placeholder="可选，将发送给该用户作为通知说明"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="userDialog = false">取消</el-button>
      <el-button type="primary" @click="saveUserStatus">保存并通知</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="reservationDialog" :title="editingReservation ? `取消预约 #${editingReservation.id}` : '取消预约'" width="520px">
    <el-form :model="reservationForm" label-position="top">
      <el-form-item label="通知原因">
        <el-input
          v-model="reservationForm.reason"
          type="textarea"
          :rows="3"
          maxlength="255"
          show-word-limit
          placeholder="可选，将写入用户收到的取消通知"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="reservationDialog = false">取消</el-button>
      <el-button type="danger" @click="cancelReservation">确认取消并通知</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.admin-toolbar {
  margin-bottom: 16px;
}

.admin-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 16px;
}

.inner-panel {
  min-height: 0;
}

.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.mini-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  color: #475467;
  font-size: 13px;
}

.mini-stats span {
  padding: 6px 10px;
  border-radius: 999px;
  background: #f5f7fb;
}

.seat-admin-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.seat-admin-summary div {
  padding: 12px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
}

.seat-admin-summary span,
.seat-admin-summary strong {
  display: block;
}

.seat-admin-summary span {
  color: #667085;
  font-size: 12px;
}

.seat-admin-summary strong {
  margin-top: 6px;
  color: #172033;
  font-size: 22px;
}

.seat-grid {
  display: grid;
  gap: 10px;
  justify-content: start;
  overflow-x: auto;
  padding-bottom: 4px;
}

.seat-cell {
  width: 44px;
  height: 40px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  color: #1d4ed8;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.seat-cell.is-disabled {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b42318;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.dialog-footer-split {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.dialog-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-value-input {
  width: 100%;
}

@media (max-width: 960px) {
  .admin-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .dialog-grid,
  .seat-admin-summary {
    grid-template-columns: 1fr;
  }

  .dialog-footer-split {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
