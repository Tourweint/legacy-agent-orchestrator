<script setup>
import { computed, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { adminApi } from '../api'
import { formatDateTimeText } from '../utils/date'

const loading = ref(false)
const logs = ref([])

const filters = ref({
  keyword: '',
  actionType: '',
  targetType: ''
})

const actionOptions = [
  { label: '全部动作', value: '' },
  { label: '用户状态修改', value: 'USER_STATUS_UPDATE' },
  { label: '用户强制下线', value: 'USER_FORCE_LOGOUT' },
  { label: '取消预约', value: 'RESERVATION_CANCEL' },
  { label: '配置修改', value: 'SYSTEM_CONFIG_UPDATE' },
  { label: '教室创建', value: 'CLASSROOM_CREATE' },
  { label: '教室更新', value: 'CLASSROOM_UPDATE' },
  { label: '创建维护', value: 'MAINTENANCE_CREATE' },
  { label: '取消维护', value: 'MAINTENANCE_CANCEL' }
]

const targetOptions = [
  { label: '全部对象', value: '' },
  { label: '用户', value: 'USER' },
  { label: '预约', value: 'RESERVATION' },
  { label: '系统配置', value: 'SYSTEM_CONFIG' },
  { label: '教室', value: 'CLASSROOM' },
  { label: '维护', value: 'MAINTENANCE' }
]

const currentPage = ref(1)
const pageSize = ref(20)

const pagedLogs = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return logs.value.slice(start, start + pageSize.value)
})

const totalCount = computed(() => logs.value.length)
const uniqueAdmins = computed(() => new Set(logs.value.map(item => item.adminUsername)).size)
const actionCount = computed(() => new Set(logs.value.map(item => item.actionType)).size)

function actionText(value) {
  return actionOptions.find(item => item.value === value)?.label || value || '-'
}

function targetText(value) {
  return targetOptions.find(item => item.value === value)?.label || value || '-'
}

function queryParams() {
  return {
    keyword: filters.value.keyword || undefined,
    actionType: filters.value.actionType || undefined,
    targetType: filters.value.targetType || undefined,
    limit: 300
  }
}

async function loadLogs() {
  loading.value = true
  try {
    logs.value = await adminApi.auditLogs(queryParams())
    currentPage.value = 1
  } finally {
    loading.value = false
  }
}

loadLogs()
</script>

<template>
  <div class="metric-row">
    <div class="metric">
      <div class="metric-label">日志总数</div>
      <div class="metric-value">{{ totalCount }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">管理员数</div>
      <div class="metric-value">{{ uniqueAdmins }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">动作类型</div>
      <div class="metric-value">{{ actionCount }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">当前筛选</div>
      <div class="metric-value" style="font-size:18px">{{ filters.actionType || '全部动作' }}</div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <div>
        <strong>操作日志</strong>
        <div class="hint">记录管理员对用户、预约、配置、教室和维护窗口的关键操作。</div>
      </div>
      <div class="form-row">
        <el-input v-model="filters.keyword" placeholder="管理员 / 对象 / 详情关键词" clearable style="width: 240px" />
        <el-select v-model="filters.actionType" style="width: 170px">
          <el-option v-for="item in actionOptions" :key="item.value || 'ALL_ACTION'" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filters.targetType" style="width: 140px">
          <el-option v-for="item in targetOptions" :key="item.value || 'ALL_TARGET'" :label="item.label" :value="item.value" />
        </el-select>
        <el-button type="primary" :icon="Search" @click="loadLogs">查询</el-button>
        <el-button :icon="Refresh" @click="loadLogs">刷新</el-button>
      </div>
    </div>

    <el-table :data="pagedLogs" v-loading="loading">
      <el-table-column prop="adminUsername" label="管理员" width="130" />
      <el-table-column prop="actionType" label="动作" width="150">
        <template #default="{ row }">
          <el-tag>{{ actionText(row.actionType) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="targetType" label="对象类型" width="120">
        <template #default="{ row }">{{ targetText(row.targetType) }}</template>
      </el-table-column>
      <el-table-column prop="targetName" label="对象" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ row.targetName || `#${row.targetId ?? '-'}` }}</template>
      </el-table-column>
      <el-table-column prop="detail" label="详情" min-width="260" show-overflow-tooltip />
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column label="时间" min-width="180">
        <template #default="{ row }">{{ formatDateTimeText(row.createTime) }}</template>
      </el-table-column>
    </el-table>

    <div v-if="totalCount > pageSize" class="pagination-wrap">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="totalCount"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        background
      />
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.pagination-wrap {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}
</style>
