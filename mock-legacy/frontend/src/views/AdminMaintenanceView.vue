<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { adminApi, classroomApi } from '../api'
import {
  buildingOptions,
  ensureBuildingOptionsLoaded,
  getDefaultBuildingValue,
  hasBuildingOption
} from '../config/buildings'
import { formatDateTimeText, toUtcIsoString } from '../utils/date'

const loading = ref(false)
const classroomsLoading = ref(false)
const seatsLoading = ref(false)
const saving = ref(false)
const maintenanceList = ref([])
const classrooms = ref([])
const seats = ref([])
const maintenanceDialog = ref(false)

const filters = ref({
  status: 'ACTIVE',
  resourceType: '',
  building: '',
  classroomId: null
})

const form = ref({
  resourceType: 'CLASSROOM',
  building: '',
  classroomId: null,
  seatId: null,
  timeRange: [],
  reason: '',
  clearConflictingReservations: false
})

const activeCount = computed(() => maintenanceList.value.filter(item => item.status === 'ACTIVE').length)
const cancelledCount = computed(() => maintenanceList.value.filter(item => item.status === 'CANCELLED').length)
const classroomMaintenanceCount = computed(() => maintenanceList.value.filter(item => item.resourceType === 'CLASSROOM').length)
const seatMaintenanceCount = computed(() => maintenanceList.value.filter(item => item.resourceType === 'SEAT').length)

function statusText(status) {
  const map = {
    ACTIVE: '进行中',
    CANCELLED: '已取消'
  }
  return map[status] || status || '-'
}

function resourceTypeText(type) {
  const map = {
    CLASSROOM: '教室',
    SEAT: '座位'
  }
  return map[type] || type || '-'
}

function listParams() {
  return {
    status: filters.value.status || undefined,
    resourceType: filters.value.resourceType || undefined,
    classroomId: filters.value.classroomId || undefined
  }
}

async function loadClassrooms(target = filters.value) {
  if (!target.building) {
    classrooms.value = []
    return
  }
  classroomsLoading.value = true
  try {
    classrooms.value = await adminApi.classrooms({
      building: target.building,
      min_capacity: 1,
      status: 'ENABLED'
    })
  } finally {
    classroomsLoading.value = false
  }
}

async function loadSeats(classroomId) {
  seats.value = []
  if (!classroomId) return
  seatsLoading.value = true
  try {
    const layout = await classroomApi.seats(classroomId)
    seats.value = layout?.seatVOS || []
  } finally {
    seatsLoading.value = false
  }
}

async function loadMaintenance() {
  loading.value = true
  try {
    maintenanceList.value = await adminApi.maintenance(listParams())
  } finally {
    loading.value = false
  }
}

async function openCreate() {
  form.value = {
    resourceType: 'CLASSROOM',
    building: filters.value.building || getDefaultBuildingValue(),
    classroomId: null,
    seatId: null,
    timeRange: [],
    reason: '',
    clearConflictingReservations: false
  }
  await loadClassrooms(form.value)
  maintenanceDialog.value = true
}

async function createMaintenance() {
  const [startTime, endTime] = form.value.timeRange || []
  if (!form.value.resourceType) {
    ElMessage.warning('请选择维护类型')
    return
  }
  if (!form.value.classroomId) {
    ElMessage.warning('请选择教室')
    return
  }
  if (form.value.resourceType === 'SEAT' && !form.value.seatId) {
    ElMessage.warning('请选择座位')
    return
  }
  if (!startTime || !endTime) {
    ElMessage.warning('请选择维护时间段')
    return
  }

  if (form.value.clearConflictingReservations) {
    await ElMessageBox.confirm(
      '开启后会取消维护时间段内已有的冲突预约，并向相关用户发送取消通知。',
      '确认清退冲突预约',
      { type: 'warning' }
    )
  }

  saving.value = true
  try {
    await adminApi.createMaintenance({
      resourceType: form.value.resourceType,
      resourceId: form.value.resourceType === 'CLASSROOM' ? form.value.classroomId : form.value.seatId,
      start_time: toUtcIsoString(startTime),
      end_time: toUtcIsoString(endTime),
      reason: form.value.reason,
      clear_conflicting_reservations: form.value.clearConflictingReservations
    })
    ElMessage.success(form.value.clearConflictingReservations ? '维护已创建，冲突预约已清退' : '维护已创建')
    maintenanceDialog.value = false
    await loadMaintenance()
  } finally {
    saving.value = false
  }
}

async function cancelMaintenance(row) {
  await ElMessageBox.confirm(`确认取消维护 ${row.resourceName || `#${row.id}`} 吗？`, '取消维护', { type: 'warning' })
  await adminApi.cancelMaintenance(row.id)
  ElMessage.success('维护已取消')
  await loadMaintenance()
}

watch(() => filters.value.building, async () => {
  filters.value.classroomId = null
  await loadClassrooms(filters.value)
})

watch(() => form.value.building, async () => {
  form.value.classroomId = null
  form.value.seatId = null
  seats.value = []
  await loadClassrooms(form.value)
})

watch(() => form.value.classroomId, async classroomId => {
  form.value.seatId = null
  if (form.value.resourceType === 'SEAT') {
    await loadSeats(classroomId)
  }
})

watch(() => form.value.resourceType, async resourceType => {
  form.value.seatId = null
  if (resourceType === 'SEAT') {
    await loadSeats(form.value.classroomId)
  }
})

onMounted(async () => {
  await ensureBuildingOptionsLoaded()
  const defaultBuilding = getDefaultBuildingValue()
  if (!hasBuildingOption(filters.value.building)) {
    filters.value.building = defaultBuilding
  }
  if (!hasBuildingOption(form.value.building)) {
    form.value.building = defaultBuilding
  }
  await loadClassrooms()
  await loadMaintenance()
})
</script>

<template>
  <div class="metric-row">
    <div class="metric">
      <div class="metric-label">维护总数</div>
      <div class="metric-value">{{ maintenanceList.length }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">进行中</div>
      <div class="metric-value">{{ activeCount }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">教室 / 座位</div>
      <div class="metric-value" style="font-size:22px">{{ classroomMaintenanceCount }} / {{ seatMaintenanceCount }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">已取消</div>
      <div class="metric-value">{{ cancelledCount }}</div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <div>
        <strong>维护窗口</strong>
        <div class="hint">维护时间段内，相关教室或座位会自动阻止新的预约。</div>
      </div>
      <div class="form-row">
        <el-select v-model="filters.status" clearable placeholder="状态" style="width: 120px">
          <el-option label="进行中" value="ACTIVE" />
          <el-option label="已取消" value="CANCELLED" />
        </el-select>
        <el-select v-model="filters.resourceType" clearable placeholder="类型" style="width: 120px">
          <el-option label="教室" value="CLASSROOM" />
          <el-option label="座位" value="SEAT" />
        </el-select>
        <el-select v-model="filters.building" filterable placeholder="教学楼" style="width: 150px">
          <el-option v-for="building in buildingOptions" :key="building.value" :label="building.label" :value="building.value" />
        </el-select>
        <el-select
          v-model="filters.classroomId"
          clearable
          filterable
          :loading="classroomsLoading"
          placeholder="教室"
          style="width: 140px"
        >
          <el-option
            v-for="classroom in classrooms"
            :key="classroom.id"
            :label="classroom.roomNumber"
            :value="classroom.id"
          />
        </el-select>
        <el-button type="primary" :icon="Search" @click="loadMaintenance">查询</el-button>
        <el-button :icon="Refresh" @click="loadMaintenance">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增维护</el-button>
      </div>
    </div>

    <el-table :data="maintenanceList" v-loading="loading">
      <el-table-column prop="id" label="ID" width="80" />
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
          <el-tag :type="row.status === 'ACTIVE' ? 'warning' : 'info'">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="reason" label="维护原因" min-width="180" show-overflow-tooltip />
      <el-table-column prop="createByUsername" label="创建人" width="120" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="danger" :disabled="row.status !== 'ACTIVE'" @click="cancelMaintenance(row)">
            取消
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <el-dialog v-model="maintenanceDialog" title="新增维护" width="620px">
    <el-form :model="form" label-position="top">
      <div class="dialog-grid">
        <el-form-item label="维护类型">
          <el-radio-group v-model="form.resourceType">
            <el-radio-button label="CLASSROOM">教室</el-radio-button>
            <el-radio-button label="SEAT">座位</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="教学楼">
          <el-select v-model="form.building" filterable style="width: 100%">
            <el-option v-for="building in buildingOptions" :key="building.value" :label="building.label" :value="building.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="教室">
          <el-select
            v-model="form.classroomId"
            filterable
            :loading="classroomsLoading"
            placeholder="请选择教室"
            style="width: 100%"
          >
            <el-option
              v-for="classroom in classrooms"
              :key="classroom.id"
              :label="`${classroom.building} ${classroom.roomNumber}`"
              :value="classroom.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.resourceType === 'SEAT'" label="座位">
          <el-select
            v-model="form.seatId"
            filterable
            :loading="seatsLoading"
            placeholder="请选择座位"
            style="width: 100%"
          >
            <el-option
              v-for="seat in seats"
              :key="seat.id"
              :label="seat.seatNumber"
              :value="seat.id"
              :disabled="seat.status === 'DISABLED'"
            />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item label="维护时间段">
        <el-date-picker
          v-model="form.timeRange"
          type="datetimerange"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="YYYY-MM-DDTHH:mm:ss"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="维护原因">
        <el-input
          v-model="form.reason"
          type="textarea"
          :rows="3"
          maxlength="255"
          show-word-limit
          placeholder="例如：投影仪维修、座椅损坏、考试占用"
        />
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="form.clearConflictingReservations">
          清退维护时间段内的冲突预约
        </el-checkbox>
        <div class="hint">开启后，系统会先创建维护，再取消冲突预约并通知相关用户。</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="maintenanceDialog = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="createMaintenance">创建维护</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

@media (max-width: 720px) {
  .dialog-grid {
    grid-template-columns: 1fr;
  }
}
</style>
