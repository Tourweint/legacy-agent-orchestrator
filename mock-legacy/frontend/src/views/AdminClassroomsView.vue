<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheck, CircleClose, Edit, Grid, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { adminApi, classroomApi } from '../api'
import {
  buildingOptions,
  ensureBuildingOptionsLoaded,
  getDefaultBuildingValue,
  hasBuildingOption,
  refreshBuildingOptions
} from '../config/buildings'
import { enabledStatusText } from '../utils/dict'

const loading = ref(false)
const classrooms = ref([])
const selected = ref(null)
const layout = ref(null)
const classroomDialog = ref(false)
const seatDialog = ref(false)
const createSeatDialog = ref(false)
const editingSeat = ref(null)

const classroomFilters = ref({
  building: '',
  min_capacity: 1,
  status: 'ENABLED'
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

const generatedSeatNumber = computed(() => `${createSeatForm.value.rowNumber}-${createSeatForm.value.colNumber}`)
const enabledClassrooms = computed(() => classrooms.value.filter(item => item.status === 'ENABLED').length)
const disabledSeats = computed(() => layout.value?.seatVOS?.filter(item => item.status === 'DISABLED').length || 0)
const enabledSeats = computed(() => layout.value?.seatVOS?.filter(item => item.status === 'ENABLED').length || 0)
const totalSeats = computed(() => layout.value?.seatVOS?.length || 0)

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
    selected.value = null
    layout.value = null
  } finally {
    loading.value = false
  }
}

async function loadSeats(row) {
  selected.value = row
  layout.value = await classroomApi.seats(row.id)
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
  await ElMessageBox.confirm(`确认初始化 ${row.building} ${row.roomNumber} 的座位布局吗？`, '初始化座位', { type: 'warning' })
  await adminApi.initSeats(row.id)
  ElMessage.success('座位布局已初始化')
  await loadSeats(row)
}

function openSeat(seat) {
  editingSeat.value = seat
  seatForm.value = { status: seat.status, remark: seat.remark || '' }
  seatDialog.value = true
}

function openCreateSeat() {
  if (!selected.value) return
  createSeatForm.value = { rowNumber: 1, colNumber: 1, status: 'ENABLED', remark: '' }
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
  await ElMessageBox.confirm(`确认删除座位 ${editingSeat.value.seatNumber} 吗？`, '删除座位', { type: 'warning' })
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
  return { gridColumn: seat.colNumber, gridRow: seat.rowNumber }
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
      <div class="metric-label">启用教室</div>
      <div class="metric-value">{{ enabledClassrooms }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">当前教室座位</div>
      <div class="metric-value">{{ layout ? totalSeats : '-' }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">当前选择</div>
      <div class="metric-value" style="font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        {{ selected ? `${selected.building} ${selected.roomNumber}` : '-' }}
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <div>
        <strong>教室资源管理</strong>
        <div class="hint">维护教室状态、座位布局和单个座位可用性。</div>
      </div>
      <div class="form-row">
        <el-select v-model="classroomFilters.building" filterable placeholder="教学楼" style="width: 160px">
          <el-option v-for="building in buildingOptions" :key="building.value" :label="building.label" :value="building.value" />
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
              <el-tag :type="row.status === 'ENABLED' ? 'success' : 'danger'">{{ enabledStatusText(row.status) }}</el-tag>
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
          <div><span>启用座位</span><strong>{{ enabledSeats }}</strong></div>
          <div><span>禁用座位</span><strong>{{ disabledSeats }}</strong></div>
          <div><span>总座位</span><strong>{{ totalSeats }}</strong></div>
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
  </div>

  <el-dialog v-model="classroomDialog" :title="classroomForm.id ? '编辑教室' : '新增教室'" width="560px">
    <el-form :model="classroomForm" label-position="top">
      <div class="dialog-grid">
        <el-form-item label="教学楼">
          <el-select v-model="classroomForm.building" filterable style="width: 100%">
            <el-option v-for="building in buildingOptions" :key="building.value" :label="building.label" :value="building.value" />
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
</template>

<style scoped>
.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.admin-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 16px;
}

.inner-panel {
  min-height: 0;
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
