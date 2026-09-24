<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Refresh, Search } from '@element-plus/icons-vue'
import { adminApi } from '../api'
import { reservationStatusText, resourceTypeText } from '../utils/dict'
import { formatDateTimeText } from '../utils/date'
import { dateStamp, downloadBlob } from '../utils/download'

const loading = ref(false)
const exportLoading = ref(false)
const reservations = ref([])
const reservationDialog = ref(false)
const editingReservation = ref(null)

const reservationFilters = ref({
  keyword: '',
  status: ''
})

const reservationForm = ref({ reason: '' })

const activeReservations = computed(() => reservations.value.filter(item => item.status === 'ACTIVE').length)
const cancelledReservations = computed(() => reservations.value.filter(item => item.status === 'CANCELLED').length)
const expiredReservations = computed(() => reservations.value.filter(item => item.status === 'EXPIRED').length)

function reservationQueryParams() {
  return {
    keyword: reservationFilters.value.keyword || undefined,
    status: reservationFilters.value.status || undefined
  }
}

async function loadReservations() {
  loading.value = true
  try {
    reservations.value = await adminApi.reservations(reservationQueryParams())
  } finally {
    loading.value = false
  }
}

async function exportReservations() {
  exportLoading.value = true
  try {
    const blob = await adminApi.exportReservations(reservationQueryParams())
    downloadBlob(blob, `reservations-${dateStamp()}.csv`)
    ElMessage.success('预约数据已导出')
  } finally {
    exportLoading.value = false
  }
}

function openReservationDialog(row) {
  editingReservation.value = row
  reservationForm.value = { reason: '' }
  reservationDialog.value = true
}

async function cancelReservation() {
  await adminApi.cancelReservation(editingReservation.value.id, reservationForm.value)
  ElMessage.success('预约已取消，用户已收到通知')
  reservationDialog.value = false
  await loadReservations()
}

loadReservations()
</script>

<template>
  <div class="metric-row">
    <div class="metric">
      <div class="metric-label">预约总数</div>
      <div class="metric-value">{{ reservations.length }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">进行中</div>
      <div class="metric-value">{{ activeReservations }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">已取消</div>
      <div class="metric-value">{{ cancelledReservations }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">已过期</div>
      <div class="metric-value">{{ expiredReservations }}</div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
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
        <el-button :icon="Download" :loading="exportLoading" @click="exportReservations">导出</el-button>
      </div>
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
  </div>

  <el-dialog
    v-model="reservationDialog"
    :title="editingReservation ? `取消预约 #${editingReservation.id}` : '取消预约'"
    width="520px"
  >
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
.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}
</style>
