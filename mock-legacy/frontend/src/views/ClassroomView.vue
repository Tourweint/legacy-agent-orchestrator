<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Calendar, Grid, Search } from '@element-plus/icons-vue'
import { classroomApi, reservationApi, waitlistApi } from '../api'
import { useAuthStore } from '../stores/auth'
import { useReservationStore } from '../stores/reservation'
import {
  buildingOptions,
  ensureBuildingOptionsLoaded,
  getDefaultBuildingValue,
  hasBuildingOption
} from '../config/buildings'
import { formatLocalDateTimeText, toUtcIsoString } from '../utils/date'

const RESERVATION_TIME_KEY = 'campus_reservation_time'

function getEmptyReservationTime() {
  return {
    date: todayText(),
    startTime: '',
    endTime: ''
  }
}

function getSavedReservationTime() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RESERVATION_TIME_KEY) || 'null')
    if (!saved) return getEmptyReservationTime()
    return {
      date: saved.date || getDatePart(saved.start) || todayText(),
      startTime: saved.startTime || getTimePart(saved.start) || '',
      endTime: saved.endTime || getTimePart(saved.end) || ''
    }
  } catch {
    return getEmptyReservationTime()
  }
}

function getDatePart(value) {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function getTimePart(value) {
  return typeof value === 'string' ? value.slice(11, 19) : ''
}

function todayText() {
  const date = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function currentClockTime() {
  const date = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatApiDateTime(date, time) {
  return `${date}T${time}`
}

const authStore = useAuthStore()
const reservationStore = useReservationStore()
const { changeVersion } = storeToRefs(reservationStore)
const user = computed(() => authStore.user)

const loading = ref(false)
const seatLoading = ref(false)
const capacityLoading = ref(false)
const viewMode = ref('card')
const classrooms = ref([])
const classroomCapacityMap = ref({})
const selectedClassroom = ref(null)
const layout = ref(null)
const selectedSeat = ref(null)
const reserveDialog = ref(false)
const reserveType = ref('seat')
const reservedSeatIds = ref(new Set())
const buildingPreferenceCount = ref({})

const reserveForm = ref({
  time: getSavedReservationTime(),
  reason: ''
})

const filters = ref({
  building: '',
  min_capacity: 1
})

const datePickerOptions = {
  disabledDate: date => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return date.getTime() < today.getTime()
  }
}

const enabledClassrooms = computed(() => classrooms.value.filter(item => item.status === 'ENABLED').length)
const totalCapacity = computed(() => classrooms.value.reduce((sum, item) => sum + (item.capacity || 0), 0))
const reservedSeatCount = computed(() => reservedSeatIds.value.size)
const disabledSeatCount = computed(() => layout.value?.seatVOS?.filter(item => item.status === 'DISABLED').length || 0)
const availableSeatCount = computed(() => Math.max((layout.value?.seatVOS?.length || 0) - reservedSeatCount.value - disabledSeatCount.value, 0))
const capacityMetricLabel = computed(() => selectedClassroom.value && layout.value ? '剩余容量' : '总座位')
const capacityMetricValue = computed(() => selectedClassroom.value && layout.value ? availableSeatCount.value : totalCapacity.value)
const isTeacher = computed(() => user.value?.role === 'TEACHER')
const isClassroomUnavailableForTeacher = computed(() => user.value?.role === 'TEACHER' && reservedSeatCount.value > 0)
const pageActionLabel = computed(() => user.value?.role === 'TEACHER' ? '查看并预约教室' : '查看座位')
const startMinTime = computed(() => isSelectedDateToday() ? currentClockTime() : '')
const studentSeatAdvanceHours = computed(() => user.value?.seatReservationAdvanceHours || 24)
const maxSingleReservationMinutes = computed(() => user.value?.maxSingleReservationMinutes || 180)
const selectedSeatIsReserved = computed(() => Boolean(selectedSeat.value && isSeatReserved(selectedSeat.value)))
const selectedTimeLabel = computed(() => {
  if (!hasReservationTime()) return ''
  const { start, end } = getReservationDateTimes()
  return `${formatLocalDateTimeText(start)} 至 ${formatLocalDateTimeText(end)}`
})

const orderedBuildingOptions = computed(() => {
  return [...buildingOptions].sort((a, b) => {
    const diff = (buildingPreferenceCount.value[b.value] || 0) - (buildingPreferenceCount.value[a.value] || 0)
    if (diff !== 0) return diff
    return buildingOptions.findIndex(item => item.value === a.value) - buildingOptions.findIndex(item => item.value === b.value)
  })
})

const sortedClassrooms = computed(() => {
  const buildingOrder = new Map(orderedBuildingOptions.value.map((item, index) => [item.value, index]))
  return [...classrooms.value].sort((a, b) => {
    const buildingDiff = (buildingOrder.get(a.building) ?? 999) - (buildingOrder.get(b.building) ?? 999)
    if (buildingDiff !== 0) return buildingDiff
    const remainingDiff = (getRoomRemainingCapacity(b) ?? -1) - (getRoomRemainingCapacity(a) ?? -1)
    if (remainingDiff !== 0) return remainingDiff
    return (b.capacity || 0) - (a.capacity || 0)
  })
})

const preferredClassrooms = computed(() => sortedClassrooms.value.slice(0, 3))

const viewModeOptions = [
  { label: '卡片', value: 'card' },
  { label: '列表', value: 'list' }
]

async function loadBuildingPreferences() {
  try {
    const counts = {}
    const data = await classroomApi.preferredBuildings()
    ;(data || []).forEach(item => {
      const building = item.building
      if (building) {
        counts[building] = Number(item.reservationCount || 0)
      }
    })
    buildingPreferenceCount.value = counts
    const preferredBuilding = orderedBuildingOptions.value[0]?.value
    if (preferredBuilding) {
      filters.value.building = preferredBuilding
    }
  } catch {
    if (!filters.value.building || !hasBuildingOption(filters.value.building)) {
      filters.value.building = getDefaultBuildingValue()
    }
  }
}

async function loadClassrooms() {
  const validationMessage = getAvailabilityValidationMessage()
  if (validationMessage) {
    ElMessage.warning(validationMessage)
    return
  }
  loading.value = true
  try {
    const data = await classroomApi.available({
      building: filters.value.building || undefined,
      min_capacity: filters.value.min_capacity || 1
    })
    classrooms.value = data || []
    await loadClassroomCapacityStats()
  } finally {
    loading.value = false
  }
}

async function loadClassroomCapacityStats() {
  if (!canQueryAvailability()) {
    classroomCapacityMap.value = {}
    return
  }

  capacityLoading.value = true
  try {
    let hasCapacityQueryError = false
    let capacityQueryErrorMessage = ''
    const entries = await Promise.all(classrooms.value.map(async room => {
      try {
        const stats = await getClassroomCapacityStats(room)
        return [room.id, stats]
      } catch (error) {
        hasCapacityQueryError = true
        if (!capacityQueryErrorMessage) {
          capacityQueryErrorMessage = getCapacityQueryErrorMessage(error)
        }
        return [room.id, { remaining: null, total: room.capacity || 0 }]
      }
    }))
    classroomCapacityMap.value = Object.fromEntries(entries)
    if (hasCapacityQueryError) {
      ElMessage.warning(capacityQueryErrorMessage || '部分教室容量暂时无法计算，请调整时间后重试')
    }
  } finally {
    capacityLoading.value = false
  }
}

async function getClassroomCapacityStats(room) {
  const [seatLayout, reservedIds] = await Promise.all([
    classroomApi.seats(room.id),
    reservationApi.reservedSeats(room.id, getAvailabilityParams(), { silentError: true })
  ])
  const seats = seatLayout?.seatVOS || []
  const disabled = seats.filter(item => item.status === 'DISABLED').length
  const reserved = Array.isArray(reservedIds) ? reservedIds.length : 0
  const total = seats.length || room.capacity || 0
  return {
    remaining: Math.max(total - disabled - reserved, 0),
    total
  }
}

async function openSeats(room) {
  const validationMessage = getAvailabilityValidationMessage()
  if (validationMessage) {
    ElMessage.warning(validationMessage)
    return
  }
  await loadSeatsForClassroom(room)
}

async function loadSeatsForClassroom(room) {
  selectedClassroom.value = room
  selectedSeat.value = null
  seatLoading.value = true
  try {
    layout.value = await classroomApi.seats(room.id)
    await loadReservedSeats()
  } finally {
    seatLoading.value = false
  }
}

function seatStyle(seat) {
  return {
    gridColumn: seat.colNumber,
    gridRow: seat.rowNumber
  }
}

function chooseSeat(seat) {
  if (user.value?.role !== 'STUDENT') return
  if (seat.status === 'DISABLED' || isSeatWaitingForTime()) return
  selectedSeat.value = selectedSeat.value?.id === seat.id ? null : seat
}

function openReserve(type) {
  reserveType.value = type
  reserveForm.value = { ...reserveForm.value, reason: '' }
  reserveDialog.value = true
}

function isSelectedDateToday() {
  return reserveForm.value.time?.date === todayText()
}

function getReservationDateTimes() {
  const { date, startTime, endTime } = reserveForm.value.time || {}
  return {
    start: formatApiDateTime(date, startTime),
    end: formatApiDateTime(date, endTime)
  }
}

function getAvailabilityParams() {
  const { start, end } = getReservationDateTimes()
  return {
    start_time: toUtcIsoString(start),
    end_time: toUtcIsoString(end)
  }
}

function hasReservationTime() {
  const time = reserveForm.value.time || {}
  return Boolean(time.date && time.startTime && time.endTime)
}

function isEndAfterStart() {
  if (!hasReservationTime()) return false
  const { start, end } = getReservationDateTimes()
  return new Date(end).getTime() > new Date(start).getTime()
}

function isStartAfterNow() {
  if (!hasReservationTime()) return false
  const { start } = getReservationDateTimes()
  return new Date(start).getTime() > Date.now()
}

function getReservationDurationMinutes() {
  if (!hasReservationTime()) return 0
  const { start, end } = getReservationDateTimes()
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

function formatMinutesText(minutes) {
  if (!minutes) return '0分钟'
  if (minutes % 60 === 0) {
    return `${minutes / 60}小时`
  }
  return `${minutes}分钟`
}

function isSeatReservationAdvanceValid() {
  if (user.value?.role !== 'STUDENT' || !hasReservationTime()) return true
  const { start } = getReservationDateTimes()
  return new Date(start).getTime() <= Date.now() + studentSeatAdvanceHours.value * 60 * 60 * 1000
}

function getAvailabilityValidationMessage() {
  if (!hasReservationTime()) {
    return '请先选择预约时间'
  }
  if (!isEndAfterStart()) {
    return '结束时间必须晚于开始时间'
  }
  if (!isStartAfterNow()) {
    return '开始时间必须晚于当前时间'
  }
  if (!isTeacher.value && getReservationDurationMinutes() > maxSingleReservationMinutes.value) {
    return `单次预约时长不能超过${formatMinutesText(maxSingleReservationMinutes.value)}`
  }
  if (!isSeatReservationAdvanceValid()) {
    return '当前预约时间超出可预约范围，请调整后重试'
  }
  return ''
}

function canQueryAvailability() {
  return !getAvailabilityValidationMessage()
}

function handleReservationTimeChange() {
  selectedSeat.value = null
  reservedSeatIds.value = new Set()
  if (hasReservationTime()) {
    sessionStorage.setItem(RESERVATION_TIME_KEY, JSON.stringify(reserveForm.value.time))
  } else {
    sessionStorage.removeItem(RESERVATION_TIME_KEY)
  }
}

async function submitReservation() {
  const validationMessage = getAvailabilityValidationMessage()
  if (validationMessage) {
    ElMessage.warning(validationMessage)
    return
  }
  const { start, end } = getReservationDateTimes()
  const payload = {
    start_time: toUtcIsoString(start),
    end_time: toUtcIsoString(end),
    reason: reserveForm.value.reason
  }
  if (reserveType.value === 'seat') {
    if (!selectedSeat.value) {
      ElMessage.warning('请选择座位')
      return
    }
    try {
      await reservationApi.reserveSeat({ ...payload, seat_id: selectedSeat.value.id }, { silentError: true })
    } catch (error) {
      if (isSeatWaitlistEligibleError(error)) {
        await offerSeatWaitlist({ ...payload, seat_id: selectedSeat.value.id })
        return
      }
      ElMessage.error(error?.response?.data?.message || error?.message || '座位预约失败')
      return
    }
  } else {
    await reservationApi.reserveClassroom({ ...payload, classroom_id: selectedClassroom.value.id })
  }
  ElMessage.success(reserveType.value === 'seat' ? '座位预约成功' : '教室预约成功')
  reserveDialog.value = false
  selectedSeat.value = null
  await loadReservedSeats()
}

function isSeatWaitlistEligibleError(error) {
  const message = error?.response?.data?.message || error?.message || ''
  const businessCode = error?.businessCode ?? error?.response?.data?.code
  if (businessCode !== 409) return false
  return message.includes('座位已被预约') || message.includes('教室已被整间预约')
}

async function offerSeatWaitlist(payload) {
  try {
    await ElMessageBox.confirm(
      '当前座位在该时间段已被占用，是否加入候补？资源释放后系统会自动尝试为你补位。',
      '加入候补',
      {
        type: 'warning',
        confirmButtonText: '加入候补',
        cancelButtonText: '返回调整'
      }
    )
  } catch {
    return
  }

  await waitlistApi.create(payload)
  reserveDialog.value = false
  ElMessage.success('已加入候补队列，资源释放后系统会自动尝试补位')
}

async function joinSelectedSeatWaitlist() {
  if (!selectedSeat.value) {
    ElMessage.warning('请先选择座位')
    return
  }
  if (!isSeatReserved(selectedSeat.value)) {
    ElMessage.warning('当前座位尚可直接预约，无需加入候补')
    return
  }
  const validationMessage = getAvailabilityValidationMessage()
  if (validationMessage) {
    ElMessage.warning(validationMessage)
    return
  }
  const { start, end } = getReservationDateTimes()
  await offerSeatWaitlist({
    seat_id: selectedSeat.value.id,
    start_time: toUtcIsoString(start),
    end_time: toUtcIsoString(end),
    reason: reserveForm.value.reason
  })
}

async function loadReservedSeats() {
  if (!selectedClassroom.value || !canQueryAvailability()) {
    reservedSeatIds.value = new Set()
    return
  }

  const data = await reservationApi.reservedSeats(selectedClassroom.value.id, getAvailabilityParams())
  reservedSeatIds.value = new Set(data || [])
  classroomCapacityMap.value = {
    ...classroomCapacityMap.value,
    [selectedClassroom.value.id]: {
      remaining: availableSeatCount.value,
      total: layout.value?.seatVOS?.length || selectedClassroom.value.capacity || 0
    }
  }

  if (selectedSeat.value && reservedSeatIds.value.has(selectedSeat.value.id)) {
    ElMessage.warning('原选座位在该时间段已被占用，如需等待可直接加入候补')
  }
}

function isSeatReserved(seat) {
  return reservedSeatIds.value.has(seat.id)
}

function isSeatWaitingForTime() {
  return user.value?.role === 'STUDENT' && !canQueryAvailability()
}

function isSeatUnavailable(seat) {
  return seat.status === 'DISABLED' || isSeatReserved(seat) || isSeatWaitingForTime()
}

function getRoomRemainingCapacity(room) {
  return classroomCapacityMap.value[room.id]?.remaining
}

function formatRoomRemainingCapacity(room) {
  const remaining = getRoomRemainingCapacity(room)
  if (capacityLoading.value) return '计算中'
  return Number.isFinite(remaining) ? remaining : '--'
}

function getCapacityQueryErrorMessage(error) {
  const message = error?.response?.data?.message || error?.message || ''
  if (
    message.includes('单次预约时长不能超过')
    || message.includes('single reservation cannot exceed')
    || message.includes('cannot exceed')
    || message.includes('已超过当前信用等级对应的当日预约时长上限')
    || message.includes('当前预约时间超出可预约范围')
  ) {
    return message
  }
  return ''
}

async function refreshReservationState() {
  if (!selectedClassroom.value || !canQueryAvailability()) return
  selectedSeat.value = null
  await loadReservedSeats()
}

watch(changeVersion, refreshReservationState)

watch(
  () => filters.value.building,
  () => {
    selectedClassroom.value = null
    selectedSeat.value = null
    layout.value = null
  }
)

onMounted(() => {
  ensureBuildingOptionsLoaded().then(() => {
    if (!filters.value.building || !hasBuildingOption(filters.value.building)) {
      filters.value.building = getDefaultBuildingValue()
    }
    return loadBuildingPreferences()
  }).then(() => {
    if (canQueryAvailability()) {
      loadClassrooms()
    }
  })
})
</script>

<template>
  <div class="metric-row">
    <div class="metric">
      <div class="metric-label">可见教室</div>
      <div class="metric-value">{{ classrooms.length }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">启用教室</div>
      <div class="metric-value">{{ enabledClassrooms }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">{{ capacityMetricLabel }}</div>
      <div class="metric-value">{{ capacityMetricValue }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">当前选择</div>
      <div class="metric-value compact">{{ selectedSeat?.seatNumber || selectedClassroom?.roomNumber || '-' }}</div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <div>
        <strong>{{ user?.role === 'TEACHER' ? '先选时间，再看可预约教室' : '先选时间，再看可预约座位' }}</strong>
        <div class="hint">{{ user?.role === 'STUDENT' ? '学生座位预约范围会根据近期使用情况动态调整，请先选择合适时间后再查询。' : '系统会默认选中你更常预约的教学楼，并按历史偏好优先展示楼内教室。' }}</div>
      </div>
      <el-segmented v-model="viewMode" :options="viewModeOptions" />
    </div>

    <div class="time-filter-card">
      <div class="time-picker-grid">
        <el-date-picker
          v-model="reserveForm.time.date"
          type="date"
          placeholder="选择日期"
          value-format="YYYY-MM-DD"
          :disabled-date="datePickerOptions.disabledDate"
          style="width: 100%"
          @change="handleReservationTimeChange"
        />
        <el-time-select
          v-model="reserveForm.time.startTime"
          start="07:00"
          step="00:30"
          end="22:00"
          :min-time="startMinTime"
          :max-time="reserveForm.time.endTime"
          placeholder="开始时间"
          value-format="HH:mm:ss"
          style="width: 100%"
          @change="handleReservationTimeChange"
        />
        <el-time-select
          v-model="reserveForm.time.endTime"
          start="07:30"
          step="00:30"
          end="22:30"
          :min-time="reserveForm.time.startTime"
          placeholder="结束时间"
          value-format="HH:mm:ss"
          style="width: 100%"
          @change="handleReservationTimeChange"
        />
      </div>
      <div class="time-filter-footer">
        <div>
          <strong>当前时间段</strong>
          <span>{{ selectedTimeLabel || '请先选择日期、开始时间和结束时间' }}</span>
        </div>
        <el-button type="primary" :icon="Search" :loading="loading" @click="loadClassrooms">查询可用教室</el-button>
      </div>
    </div>

    <div class="toolbar section-toolbar">
      <div>
        <strong>教学楼筛选</strong>
        <div class="hint">默认按你的历史预约偏好排序，并自动选中最常预约的教学楼</div>
      </div>
      <div class="form-row">
        <el-form-item label="教学楼">
          <el-select v-model="filters.building" filterable placeholder="请选择教学楼" style="width: 180px">
            <el-option
              v-for="building in orderedBuildingOptions"
              :key="building.value"
              :label="building.label"
              :value="building.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="最低总座位">
          <el-input-number v-model="filters.min_capacity" :min="1" />
        </el-form-item>
        <el-button type="primary" :icon="Search" :loading="loading" @click="loadClassrooms">刷新当前楼</el-button>
      </div>
    </div>

    <section class="recommend-strip">
      <div class="recommend-copy">
        <strong>{{ user?.role === 'TEACHER' ? '优先推荐的可用教室' : '优先推荐的座位空间' }}</strong>
        <span>
          {{
            canQueryAvailability()
              ? '已带入当前预约时间，教室列表会优先展示你常用教学楼中剩余容量更高的教室。'
              : '先完成时间选择，再查询楼内教室和座位占用情况。'
          }}
        </span>
      </div>
      <div class="recommend-list">
        <button v-for="room in preferredClassrooms" :key="room.id" class="recommend-room" @click="openSeats(room)">
          <strong>{{ room.building }} {{ room.roomNumber }}</strong>
          <span>剩余容量 {{ formatRoomRemainingCapacity(room) }} | 总座位 {{ room.capacity }}</span>
        </button>
      </div>
    </section>

    <div v-if="viewMode === 'card'" v-loading="loading || capacityLoading" class="classroom-card-grid">
      <article v-for="room in sortedClassrooms" :key="room.id" class="classroom-card" @click="openSeats(room)">
        <div class="classroom-card-head">
          <div>
            <strong>{{ room.building }}</strong>
            <span>{{ room.roomNumber }}</span>
          </div>
        </div>
        <div class="classroom-card-meta">
          <span>剩余容量 {{ formatRoomRemainingCapacity(room) }}</span>
          <span>总座位 {{ room.capacity }}</span>
          <span>{{ room.seatRows }} 行 x {{ room.seatCols }} 列</span>
        </div>
        <p>{{ room.remark || '暂无备注' }}</p>
        <el-button type="primary" plain :icon="Grid" @click.stop="openSeats(room)">{{ pageActionLabel }}</el-button>
      </article>
    </div>

    <el-table v-else :data="sortedClassrooms" v-loading="loading || capacityLoading" height="310" @row-click="openSeats">
      <el-table-column prop="building" label="教学楼" min-width="140" />
      <el-table-column prop="roomNumber" label="教室" width="120" />
      <el-table-column label="剩余容量" width="110">
        <template #default="{ row }">
          {{ formatRoomRemainingCapacity(row) }}
        </template>
      </el-table-column>
      <el-table-column prop="capacity" label="总座位" width="100" />
      <el-table-column prop="seatRows" label="行" width="80" />
      <el-table-column prop="seatCols" label="列" width="80" />
      <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button size="small" :icon="Grid" @click.stop="openSeats(row)">{{ pageActionLabel }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <div class="panel seat-panel">
    <div class="toolbar">
      <div>
        <strong>{{ selectedClassroom ? `${selectedClassroom.building} ${selectedClassroom.roomNumber}` : user?.role === 'TEACHER' ? '教室预约状态' : '座位布局' }}</strong>
        <div class="hint">
          {{
            user?.role === 'TEACHER'
              ? selectedClassroom ? '系统会按当前时间段判断整间教室是否可预约。' : '先选择时间和教学楼，再查看具体教室。'
              : selectedSeat
              ? isSeatReserved(selectedSeat)
                ? `已选择占用座位 ${selectedSeat.seatNumber}，可直接加入候补`
                : `已选择座位 ${selectedSeat.seatNumber}`
              : selectedClassroom ? '已按当前预约时间标记不可用座位，点击占用座位可直接加入候补。' : '先选择时间和教学楼，再查看具体教室。'
          }}
        </div>
      </div>
      <div class="form-row">
        <el-button
          v-if="user?.role === 'STUDENT'"
          type="primary"
          :icon="Calendar"
          :disabled="!selectedSeat || selectedSeatIsReserved || !canQueryAvailability()"
          @click="openReserve('seat')"
        >
          预约座位
        </el-button>
        <el-button
          v-if="user?.role === 'STUDENT'"
          type="warning"
          plain
          :icon="Calendar"
          :disabled="!selectedSeat || !selectedSeatIsReserved || !canQueryAvailability()"
          @click="joinSelectedSeatWaitlist"
        >
          加入候补
        </el-button>
        <el-button
          v-if="user?.role === 'TEACHER'"
          type="primary"
          :icon="Calendar"
          :disabled="!selectedClassroom || !canQueryAvailability() || isClassroomUnavailableForTeacher"
          @click="openReserve('classroom')"
        >
          预约教室
        </el-button>
      </div>
    </div>

    <div v-if="selectedClassroom && selectedTimeLabel" class="time-summary">
      <div>
        <span>当前预约时间</span>
        <strong>{{ selectedTimeLabel }}</strong>
      </div>
    </div>

    <div v-if="layout" class="seat-status-grid">
      <div class="seat-status">
        <span>剩余容量</span>
        <strong>{{ availableSeatCount }}</strong>
      </div>
      <div class="seat-status">
        <span>已预约</span>
        <strong>{{ reservedSeatCount }}</strong>
      </div>
      <div class="seat-status">
        <span>禁用</span>
        <strong>{{ disabledSeatCount }}</strong>
      </div>
      <div class="seat-status">
        <span>总座位</span>
        <strong>{{ layout.seatVOS?.length || 0 }}</strong>
      </div>
    </div>

    <div v-if="layout && user?.role !== 'TEACHER'" class="seat-legend">
      <span><i class="legend-dot available"></i>可选</span>
      <span><i class="legend-dot reserved"></i>已预约</span>
      <span><i class="legend-dot disabled"></i>禁用</span>
      <span><i class="legend-dot selected"></i>已选中</span>
    </div>

    <div v-if="!layout" class="empty-block">请先选择时间、教学楼和教室</div>
    <div v-else-if="user?.role === 'TEACHER'" class="teacher-status-card" :class="{ blocked: isClassroomUnavailableForTeacher }">
      <div class="teacher-status-main">
        <el-tag :type="isClassroomUnavailableForTeacher ? 'danger' : 'success'">
          {{ isClassroomUnavailableForTeacher ? '当前时间不可整间预约' : '当前时间可预约' }}
        </el-tag>
        <h3>{{ selectedClassroom.building }} {{ selectedClassroom.roomNumber }}</h3>
        <p>
          {{
            isClassroomUnavailableForTeacher
              ? `该时间段已有 ${reservedSeatCount} 个座位被预约，或整间教室存在冲突，不能提交整间教室预约。`
              : '该时间段未检测到座位或整间教室冲突，可以提交整间教室预约。'
          }}
        </p>
      </div>
      <div class="teacher-status-meta">
        <span>剩余容量 {{ availableSeatCount }}</span>
        <span>总座位 {{ selectedClassroom.capacity }}</span>
        <span>{{ selectedClassroom.seatRows }} 行 x {{ selectedClassroom.seatCols }} 列</span>
      </div>
    </div>
    <div
      v-else
      v-loading="seatLoading"
      class="seat-grid"
      :style="{ gridTemplateColumns: `repeat(${layout.seatCols}, 44px)`, gridTemplateRows: `repeat(${layout.seatRows}, 40px)` }"
    >
      <button
        v-for="seat in layout.seatVOS"
        :key="seat.id"
        class="seat-cell"
        :class="{ 'is-disabled': seat.status === 'DISABLED', 'is-reserved': isSeatReserved(seat), 'is-pending-time': isSeatWaitingForTime(), 'is-selected': selectedSeat?.id === seat.id }"
        :style="seatStyle(seat)"
        :title="isSeatWaitingForTime() ? '请先选择预约时间' : isSeatReserved(seat) ? '该时间段已被占用，点击可加入候补' : (seat.remark || seat.seatNumber)"
        @click="chooseSeat(seat)"
      >
        {{ seat.seatNumber }}
      </button>
    </div>
  </div>

  <el-dialog v-model="reserveDialog" :title="reserveType === 'seat' ? '预约座位' : '预约教室'" width="520px">
    <el-form label-position="top">
      <el-alert
        :title="`预约时间：${selectedTimeLabel}`"
        description="如需调整时间，请先关闭弹窗，到页面顶部重新选择时间并刷新教室列表。"
        type="info"
        :closable="false"
        class="dialog-alert"
      />
      <el-form-item label="预约原因">
        <el-input v-model="reserveForm.reason" type="textarea" :rows="3" maxlength="255" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="reserveDialog = false">取消</el-button>
      <el-button type="primary" @click="submitReservation">提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.seat-panel {
  margin-top: 16px;
}

.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.metric-value.compact {
  max-width: 100%;
  overflow: hidden;
  font-size: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-alert {
  margin-bottom: 16px;
}

.time-filter-card {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.time-picker-grid {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.time-filter-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

.time-filter-footer strong,
.time-filter-footer span {
  display: block;
}

.time-filter-footer span {
  margin-top: 4px;
  color: #475467;
  font-size: 13px;
}

.section-toolbar {
  margin-bottom: 12px;
}

.recommend-strip {
  display: grid;
  grid-template-columns: minmax(180px, 0.55fr) minmax(0, 1.45fr);
  gap: 12px;
  align-items: stretch;
  margin-bottom: 16px;
}

.recommend-copy {
  padding: 14px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.recommend-copy strong,
.recommend-copy span {
  display: block;
}

.recommend-copy span {
  margin-top: 6px;
  color: #475467;
  font-size: 13px;
  line-height: 1.6;
}

.recommend-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.recommend-room {
  padding: 14px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
  color: #172033;
  cursor: pointer;
  text-align: left;
}

.recommend-room strong,
.recommend-room span {
  display: block;
}

.recommend-room span {
  margin-top: 6px;
  color: #667085;
  font-size: 13px;
}

.classroom-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.classroom-card {
  padding: 16px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.classroom-card:hover {
  transform: translateY(-1px);
  border-color: #bfdbfe;
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.08);
}

.classroom-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.classroom-card-head > div {
  min-width: 0;
}

.classroom-card-head strong,
.classroom-card-head span {
  display: block;
}

.classroom-card-head strong {
  overflow: hidden;
  color: #172033;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.classroom-card-head span {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.classroom-card-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.classroom-card-meta span {
  padding: 5px 8px;
  border-radius: 999px;
  background: #f8fafc;
  color: #475467;
  font-size: 12px;
  font-weight: 700;
}

.classroom-card p {
  min-height: 36px;
  margin: 12px 0;
  color: #667085;
  font-size: 13px;
}

.seat-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  color: #475467;
  font-size: 13px;
  font-weight: 700;
}

.seat-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  border: 1px solid #d0d5dd;
  background: #fff;
}

.legend-dot.reserved {
  border-color: #fde68a;
  background: #fffbeb;
}

.legend-dot.disabled {
  border-color: #fecdd3;
  background: #fff1f2;
}

.legend-dot.selected {
  border-color: #2563eb;
  background: #2563eb;
}

.time-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.time-summary span {
  display: block;
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
}

.time-summary strong {
  display: block;
  margin-top: 4px;
  color: #172033;
  font-size: 15px;
}

.seat-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.seat-status {
  padding: 12px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
}

.seat-status span,
.seat-status strong {
  display: block;
}

.seat-status span {
  color: #667085;
  font-size: 12px;
  font-weight: 800;
}

.seat-status strong {
  margin-top: 6px;
  color: #172033;
  font-size: 22px;
}

.teacher-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 180px;
  padding: 22px;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: #f0fdf4;
}

.teacher-status-card.blocked {
  border-color: #fecaca;
  background: #fff1f2;
}

.teacher-status-main h3 {
  margin: 14px 0 8px;
  color: #172033;
  font-size: 24px;
}

.teacher-status-main p {
  max-width: 680px;
  margin: 0;
  color: #475467;
  line-height: 1.7;
}

.teacher-status-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.teacher-status-meta span {
  padding: 8px 10px;
  border-radius: 999px;
  background: #fff;
  color: #475467;
  font-size: 13px;
  font-weight: 800;
}

:deep(.seat-cell.is-reserved) {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
  cursor: pointer;
}

:deep(.seat-cell.is-reserved:hover) {
  border-color: #f59e0b;
  box-shadow: 0 10px 22px rgba(245, 158, 11, 0.15);
}

:deep(.seat-cell.is-pending-time) {
  background: #f8fafc;
  color: #98a2b3;
  border-color: #e4e8f0;
  cursor: not-allowed;
}

:deep(.seat-cell.is-pending-time:hover) {
  transform: none;
  box-shadow: none;
}

@media (max-width: 1100px) {
  .classroom-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .recommend-strip,
  .recommend-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .time-picker-grid,
  .time-filter-footer {
    grid-template-columns: 1fr;
    display: grid;
  }

  .time-filter-footer {
    align-items: stretch;
  }
}

@media (max-width: 680px) {
  .classroom-card-grid {
    grid-template-columns: 1fr;
  }

  .seat-status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .time-picker-grid {
    grid-template-columns: 1fr;
  }
}
</style>

