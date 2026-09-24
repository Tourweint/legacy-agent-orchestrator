<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Bell } from '@element-plus/icons-vue'
import { notificationApi } from '../api'
import { formatDateTimeText } from '../utils/date'
import { notificationTypeText } from '../utils/dict'

const loading = ref(false)
const notifications = ref([])
const unreadCount = ref(0)
const currentPage = ref(1)
const pageSize = ref(10)
const typeFilter = ref('')

const typeOptions = [
  { label: '全部类型', value: '' },
  { label: '账号通知', value: 'USER_STATUS' },
  { label: '预约通知', value: 'RESERVATION_CANCELLED' },
  { label: '爽约通知', value: 'RESERVATION_NO_SHOW' },
  { label: '候补成功', value: 'WAITLIST_PROMOTED' }
]

const filteredNotifications = computed(() => {
  if (!typeFilter.value) return notifications.value
  return notifications.value.filter(item => item.type === typeFilter.value)
})

const pagedNotifications = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredNotifications.value.slice(start, start + pageSize.value)
})

const totalCount = computed(() => filteredNotifications.value.length)
const readCount = computed(() => notifications.value.filter(item => item.isRead !== 0).length)

async function loadNotifications() {
  loading.value = true
  try {
    const [list, unread] = await Promise.all([
      notificationApi.list({ limit: 200 }),
      notificationApi.unreadCount()
    ])
    notifications.value = list || []
    unreadCount.value = unread?.count || 0
    currentPage.value = 1
  } finally {
    loading.value = false
  }
}

async function markAllRead() {
  await notificationApi.markAllRead()
  notifications.value = notifications.value.map(item => ({ ...item, isRead: 1 }))
  unreadCount.value = 0
  ElMessage.success('通知已全部标记为已读')
}

function handleTypeChange() {
  currentPage.value = 1
}

onMounted(loadNotifications)
</script>

<template>
  <div class="metric-row">
    <div class="metric">
      <div class="metric-label">通知总数</div>
      <div class="metric-value">{{ notifications.length }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">未读通知</div>
      <div class="metric-value">{{ unreadCount }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">已读通知</div>
      <div class="metric-value">{{ readCount }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">当前筛选</div>
      <div class="metric-value" style="font-size:20px">{{ totalCount }} 条</div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <div>
        <strong>通知中心</strong>
        <div class="hint">管理员操作、爽约处理和候补补位成功后，都会在这里看到提醒。</div>
      </div>
      <div class="form-row">
        <el-select v-model="typeFilter" style="width: 140px" @change="handleTypeChange">
          <el-option v-for="item in typeOptions" :key="item.value || 'ALL'" :label="item.label" :value="item.value" />
        </el-select>
        <el-button :disabled="unreadCount === 0" :icon="Bell" @click="markAllRead">全部已读</el-button>
      </div>
    </div>

    <el-empty v-if="pagedNotifications.length === 0 && !loading" description="暂无通知" />
    <div v-else v-loading="loading" class="notification-list">
      <article v-for="item in pagedNotifications" :key="item.id" class="notification-card" :class="{ unread: item.isRead === 0 }">
        <div class="notification-head">
          <div class="notification-tags">
            <el-tag :type="item.isRead === 0 ? 'danger' : 'info'">{{ notificationTypeText(item.type) }}</el-tag>
            <el-tag v-if="item.isRead === 0" type="danger" size="small" effect="dark">未读</el-tag>
          </div>
          <span class="notification-time">{{ formatDateTimeText(item.createTime) }}</span>
        </div>
        <h4>{{ item.title }}</h4>
        <p>{{ item.content }}</p>
      </article>
    </div>

    <div v-if="totalCount > pageSize" class="pagination-wrap">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="totalCount"
        :page-sizes="[10, 20, 50]"
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

.notification-list {
  display: grid;
  gap: 12px;
}

.notification-card {
  padding: 16px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
}

.notification-card.unread {
  border-color: #fecaca;
  background: #fff7f7;
}

.notification-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.notification-tags {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notification-time {
  color: #667085;
  font-size: 12px;
}

.notification-card h4 {
  margin: 14px 0 8px;
  color: #172033;
}

.notification-card p {
  margin: 0;
  color: #667085;
  line-height: 1.6;
  white-space: pre-line;
}

.pagination-wrap {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}
</style>
