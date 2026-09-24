<script setup>
import { computed, onMounted, ref } from 'vue'
import VChart from 'vue-echarts'
import 'echarts'
import { Clock, Histogram, OfficeBuilding, TrendCharts } from '@element-plus/icons-vue'
import { reservationApi } from '../api'
import { useAuthStore } from '../stores/auth'
import { buildingOptions, ensureBuildingOptionsLoaded } from '../config/buildings'

const authStore = useAuthStore()
const isStudent = computed(() => authStore.role === 'STUDENT')

const loading = ref(false)
const activeReservations = ref([])
const historyReservations = ref([])

const now = new Date()
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

function extractBuilding(resourceName) {
  if (!resourceName) return '未知'
  for (const b of buildingOptions) {
    if (resourceName.startsWith(b.value)) return b.value
  }
  return '未知'
}

function extractHour(isoString) {
  if (!isoString) return 0
  const d = new Date(isoString)
  return isNaN(d.getTime()) ? 0 : d.getHours()
}

function hourToSlot(h) {
  if (h < 12) return '上午 7-12'
  if (h < 18) return '下午 12-18'
  return '晚上 18-22'
}

const allReservations = computed(() => [...activeReservations.value, ...historyReservations.value])
const thisMonthReservations = computed(() => allReservations.value.filter(r => (r.startTime || '').startsWith(thisMonth)))
const checkedInTotal = computed(() => historyReservations.value.filter(r => r.attendanceStatus === 'CHECKED_IN').length)
const noShowTotal = computed(() => historyReservations.value.filter(r => r.attendanceStatus === 'NO_SHOW').length)
const attendableTotal = computed(() => checkedInTotal.value + noShowTotal.value)

const checkinRate = computed(() => {
  if (!attendableTotal.value) return 0
  return Math.round((checkedInTotal.value / attendableTotal.value) * 100)
})

const topBuilding = computed(() => {
  const counts = {}
  allReservations.value.forEach(r => {
    const b = extractBuilding(r.resourceName)
    counts[b] = (counts[b] || 0) + 1
  })
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return sorted[0]?.[0] || '-'
})

const monthChartOption = computed(() => {
  const months = {}
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months[key] = 0
  }
  allReservations.value.forEach(r => {
    const key = (r.startTime || '').slice(0, 7)
    if (key in months) months[key] += 1
  })
  const entries = Object.entries(months)
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: entries.map(([k]) => k.slice(5) + '月'), axisLabel: { color: '#667085' } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#667085' }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: [{
      type: 'bar',
      data: entries.map(([, v]) => v),
      itemStyle: {
        borderRadius: [6, 6, 0, 0],
        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#2563eb' }, { offset: 1, color: '#93c5fd' }] }
      },
      barWidth: 28
    }]
  }
})

const buildingChartOption = computed(() => {
  const counts = {}
  allReservations.value.forEach(r => {
    const b = extractBuilding(r.resourceName)
    counts[b] = (counts[b] || 0) + 1
  })
  const data = Object.entries(counts).map(([name, value]) => ({ name, value }))
  if (!data.length) data.push({ name: '暂无数据', value: 1 })
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 次 ({d}%)' },
    series: [{
      type: 'pie',
      radius: ['55%', '78%'],
      center: ['50%', '52%'],
      data,
      label: { color: '#475467', fontSize: 12 },
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      color: ['#2563eb', '#0f766e', '#f59e0b', '#8b5cf6', '#ec4899']
    }]
  }
})

const timeSlotChartOption = computed(() => {
  const slots = { '上午 7-12': 0, '下午 12-18': 0, '晚上 18-22': 0 }
  allReservations.value.forEach(r => {
    const h = extractHour(r.startTime)
    const s = hourToSlot(h)
    if (s in slots) slots[s] += 1
  })
  const data = Object.entries(slots).map(([name, value]) => ({ name, value }))
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 次 ({d}%)' },
    series: [{
      type: 'pie',
      radius: ['55%', '78%'],
      center: ['50%', '52%'],
      data,
      label: { color: '#475467', fontSize: 12 },
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      color: ['#3b82f6', '#f59e0b', '#6366f1']
    }]
  }
})

const statusChartOption = computed(() => {
  const active = activeReservations.value.length
  const cancelled = historyReservations.value.filter(r => r.status === 'CANCELLED').length
  const expired = historyReservations.value.filter(r => r.status === 'EXPIRED').length
  const data = [
    { name: '进行中', value: active, itemStyle: { color: '#16a34a' } },
    { name: '已取消', value: cancelled, itemStyle: { color: '#f59e0b' } },
    { name: '已过期', value: expired, itemStyle: { color: '#94a3b8' } }
  ].filter(d => d.value > 0)
  if (!data.length) data.push({ name: '暂无数据', value: 1, itemStyle: { color: '#e4e8f0' } })
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 次 ({d}%)' },
    series: [{
      type: 'pie',
      radius: ['55%', '78%'],
      center: ['50%', '52%'],
      data,
      label: { color: '#475467', fontSize: 12 },
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }
    }]
  }
})

const attendanceChartOption = computed(() => {
  const checked = checkedInTotal.value
  const noshow = noShowTotal.value
  const pending = historyReservations.value.filter(r => r.attendanceStatus === 'PENDING').length
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: ['已签到', '已爽约', '待签到'], axisLabel: { color: '#667085' } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#667085' }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: [{
      type: 'bar',
      data: [
        { value: checked, itemStyle: { color: '#16a34a', borderRadius: [6, 6, 0, 0] } },
        { value: noshow, itemStyle: { color: '#dc2626', borderRadius: [6, 6, 0, 0] } },
        { value: pending, itemStyle: { color: '#94a3b8', borderRadius: [6, 6, 0, 0] } }
      ],
      barWidth: 36
    }]
  }
})

async function loadData() {
  loading.value = true
  try {
    const [active, history] = await Promise.all([
      reservationApi.list(),
      reservationApi.history()
    ])
    activeReservations.value = active || []
    historyReservations.value = history || []
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await ensureBuildingOptionsLoaded()
  await loadData()
})
</script>

<template>
  <div v-loading="loading" class="stats-shell">
    <div class="metric-row">
      <div class="metric">
        <div class="metric-label"><el-icon><Histogram /></el-icon> 累计预约</div>
        <div class="metric-value">{{ allReservations.length }}</div>
      </div>
      <div class="metric">
        <div class="metric-label"><el-icon><TrendCharts /></el-icon> 本月预约</div>
        <div class="metric-value">{{ thisMonthReservations.length }}</div>
      </div>
      <div class="metric">
        <div class="metric-label"><el-icon><Clock /></el-icon> {{ isStudent ? '签到率' : '进行中' }}</div>
        <div class="metric-value">{{ isStudent ? (attendableTotal ? checkinRate + '%' : '-') : activeReservations.length }}</div>
      </div>
      <div class="metric">
        <div class="metric-label"><el-icon><OfficeBuilding /></el-icon> 最常去</div>
        <div class="metric-value" style="font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ topBuilding }}</div>
      </div>
    </div>

    <section class="panel">
      <div class="chart-header">
        <strong>月度预约趋势</strong>
        <span>近 6 个月预约次数变化</span>
      </div>
      <v-chart :option="monthChartOption" autoresize class="chart chart-bar" />
    </section>

    <div class="stats-grid">
      <section class="panel">
        <div class="chart-header">
          <strong>教学楼分布</strong>
          <span>各教学楼预约次数占比</span>
        </div>
        <v-chart :option="buildingChartOption" autoresize class="chart chart-pie" />
      </section>

      <section class="panel">
        <div class="chart-header">
          <strong>时段偏好</strong>
          <span>上午 / 下午 / 晚上预约分布</span>
        </div>
        <v-chart :option="timeSlotChartOption" autoresize class="chart chart-pie" />
      </section>

      <section class="panel">
        <div class="chart-header">
          <strong>预约状态</strong>
          <span>进行中 / 已取消 / 已过期占比</span>
        </div>
        <v-chart :option="statusChartOption" autoresize class="chart chart-pie" />
      </section>

      <section v-if="isStudent" class="panel">
        <div class="chart-header">
          <strong>签到概况</strong>
          <span>历史预约签到结果统计</span>
        </div>
        <v-chart :option="attendanceChartOption" autoresize class="chart chart-bar" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.stats-shell {
  display: grid;
  gap: 16px;
}

.chart-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.chart-header strong {
  color: #172033;
  font-size: 15px;
}

.chart-header span {
  color: #667085;
  font-size: 12px;
}

.chart {
  width: 100%;
}

.chart-bar {
  height: 280px;
}

.chart-pie {
  height: 260px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 880px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
