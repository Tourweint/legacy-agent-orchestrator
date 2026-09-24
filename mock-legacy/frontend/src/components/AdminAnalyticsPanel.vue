<script setup>
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { adminApi } from '../api'
import { userRoleText } from '../utils/dict'

const loading = ref(false)
const range = ref(30)
const analytics = ref(createEmptyAnalytics())

const rangeOptions = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '全部历史', value: 0 }
]

const classroomList = computed(() => analytics.value.classroomUtilizationList.slice(0, 8))
const buildingList = computed(() => analytics.value.hotBuildingList.slice(0, 6))
const timeSlotList = computed(() => analytics.value.hotTimeSlotList.slice(0, 6))
const userList = computed(() => analytics.value.userReservationList.slice(0, 10))

const noShowRate = computed(() => formatPercent(
  ratioPercent(analytics.value.noShowCount, analytics.value.attendableReservationCount)
))
const totalReservedHours = computed(() => formatHours(analytics.value.totalReservedMinutes))
const maxClassroomRate = computed(() => maxValue(classroomList.value.map(item => item.utilizationRate)))
const maxBuildingCount = computed(() => maxValue(buildingList.value.map(item => item.reservationCount)))
const maxTimeSlotMinutes = computed(() => maxValue(timeSlotList.value.map(item => item.reservedMinutes)))

async function loadAnalytics() {
  loading.value = true
  try {
    analytics.value = await adminApi.analytics({
      days: range.value || undefined
    })
  } finally {
    loading.value = false
  }
}

function createEmptyAnalytics() {
  return {
    windowLabel: '',
    totalReservations: 0,
    activeReservations: 0,
    checkedInCount: 0,
    noShowCount: 0,
    attendableReservationCount: 0,
    totalReservedMinutes: 0,
    totalUserCount: 0,
    classroomCount: 0,
    enabledClassroomCount: 0,
    overallUtilizationRate: 0,
    classroomUtilizationList: [],
    hotBuildingList: [],
    hotTimeSlotList: [],
    userReservationList: []
  }
}

function ratioPercent(numerator, denominator) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function formatHours(minutes) {
  return `${(Number(minutes || 0) / 60).toFixed(1)} h`
}

function maxValue(values) {
  return values.length ? Math.max(...values, 0) : 0
}

function barWidth(value, max) {
  if (!max) return '0%'
  return `${Math.max(8, Math.round((Number(value || 0) / max) * 100))}%`
}

function displayUserName(row) {
  return row.nickname ? `${row.nickname}（${row.username}）` : row.username
}

onMounted(loadAnalytics)
</script>

<template>
  <div class="analytics-shell" v-loading="loading">
    <div class="toolbar analytics-toolbar">
      <div>
        <strong>统计分析</strong>
        <div class="hint">按时间窗口查看教室利用率、热门楼栋、热门时段、用户预约次数与爽约情况。</div>
      </div>
      <div class="form-row">
        <el-select v-model="range" style="width: 150px" @change="loadAnalytics">
          <el-option
            v-for="item in rangeOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-button :icon="Refresh" @click="loadAnalytics">刷新</el-button>
      </div>
    </div>

    <div class="analytics-caption">
      <span>统计窗口 {{ analytics.windowLabel || '最近 30 天' }}</span>
      <span>累计预约 {{ analytics.totalReservations }} 次</span>
      <span>累计预约时长 {{ totalReservedHours }}</span>
      <span>签到样本 {{ analytics.attendableReservationCount }} 次</span>
    </div>

    <div class="analytics-metrics">
      <div class="analytics-metric">
        <div class="analytics-metric-label">教室利用率</div>
        <div class="analytics-metric-value">{{ formatPercent(analytics.overallUtilizationRate) }}</div>
        <div class="analytics-metric-hint">按可预约时段折算</div>
      </div>
      <div class="analytics-metric">
        <div class="analytics-metric-label">热门用户覆盖</div>
        <div class="analytics-metric-value">{{ analytics.totalUserCount }}</div>
        <div class="analytics-metric-hint">有预约记录的用户参与排行</div>
      </div>
      <div class="analytics-metric">
        <div class="analytics-metric-label">签到完成次数</div>
        <div class="analytics-metric-value">{{ analytics.checkedInCount }}</div>
        <div class="analytics-metric-hint">已完成签到预约</div>
      </div>
      <div class="analytics-metric danger">
        <div class="analytics-metric-label">爽约率</div>
        <div class="analytics-metric-value">{{ noShowRate }}</div>
        <div class="analytics-metric-hint">爽约 {{ analytics.noShowCount }} 次</div>
      </div>
    </div>

    <div class="analytics-grid">
      <section class="panel analytics-section">
        <div class="section-head">
          <strong>教室利用率</strong>
          <span>按教室容量和预约时长折算</span>
        </div>
        <el-empty v-if="!classroomList.length" description="暂无教室利用数据" />
        <div v-else class="ranking-list">
          <div v-for="item in classroomList" :key="item.classroomId" class="ranking-item">
            <div class="ranking-head">
              <div>
                <strong>{{ item.building }} {{ item.roomNumber }}</strong>
                <div class="ranking-meta">
                  容量 {{ item.capacity }} · {{ item.reservationCount }} 次 · {{ formatHours(item.reservedMinutes) }}
                </div>
              </div>
              <div class="ranking-value">
                <el-tag size="small" :type="item.status === 'ENABLED' ? 'success' : 'info'">
                  {{ item.status === 'ENABLED' ? '启用' : '停用' }}
                </el-tag>
                <span>{{ formatPercent(item.utilizationRate) }}</span>
              </div>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{ width: barWidth(item.utilizationRate, maxClassroomRate) }"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="panel analytics-section">
        <div class="section-head">
          <strong>热门教学楼</strong>
          <span>按预约次数排序</span>
        </div>
        <el-empty v-if="!buildingList.length" description="暂无楼栋热度数据" />
        <div v-else class="ranking-list">
          <div v-for="item in buildingList" :key="item.building" class="ranking-item compact">
            <div class="ranking-head">
              <div>
                <strong>{{ item.building }}</strong>
                <div class="ranking-meta">{{ formatHours(item.reservedMinutes) }} · {{ item.reservationCount }} 次</div>
              </div>
              <span class="ranking-value">{{ item.reservationCount }}</span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill secondary"
                :style="{ width: barWidth(item.reservationCount, maxBuildingCount) }"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="panel analytics-section">
        <div class="section-head">
          <strong>热门时段</strong>
          <span>按预约占用分钟排序</span>
        </div>
        <el-empty v-if="!timeSlotList.length" description="暂无时段热度数据" />
        <div v-else class="ranking-list">
          <div v-for="item in timeSlotList" :key="item.label" class="ranking-item compact">
            <div class="ranking-head">
              <div>
                <strong>{{ item.label }}</strong>
                <div class="ranking-meta">{{ item.reservationCount }} 次预约 · {{ formatHours(item.reservedMinutes) }}</div>
              </div>
              <span class="ranking-value">{{ formatHours(item.reservedMinutes) }}</span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill warning"
                :style="{ width: barWidth(item.reservedMinutes, maxTimeSlotMinutes) }"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="panel analytics-section analytics-section-wide">
        <div class="section-head">
          <strong>用户预约次数</strong>
          <span>展示预约最活跃用户及其爽约情况</span>
        </div>
        <el-empty v-if="!userList.length" description="暂无用户预约统计" />
        <el-table v-else :data="userList">
          <el-table-column label="用户" min-width="180">
            <template #default="{ row }">{{ displayUserName(row) }}</template>
          </el-table-column>
          <el-table-column label="角色" width="110">
            <template #default="{ row }">{{ userRoleText(row.role) }}</template>
          </el-table-column>
          <el-table-column prop="reservationCount" label="预约次数" width="110" />
          <el-table-column label="累计时长" width="120">
            <template #default="{ row }">{{ formatHours(row.reservedMinutes) }}</template>
          </el-table-column>
          <el-table-column prop="checkedInCount" label="签到次数" width="110" />
          <el-table-column prop="noShowCount" label="爽约次数" width="110" />
          <el-table-column label="爽约率" width="110">
            <template #default="{ row }">{{ formatPercent(row.noShowRate) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>

<style scoped>
.analytics-shell {
  display: grid;
  gap: 16px;
}

.analytics-toolbar {
  margin-bottom: 0;
}

.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.analytics-caption {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: #475467;
  font-size: 13px;
}

.analytics-caption span {
  padding: 6px 10px;
  border-radius: 999px;
  background: #f5f7fb;
}

.analytics-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.analytics-metric {
  padding: 16px;
  border: 1px solid #e4e8f0;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff, #f8fbff);
}

.analytics-metric.danger {
  background: linear-gradient(180deg, #ffffff, #fff5f5);
}

.analytics-metric-label {
  color: #667085;
  font-size: 12px;
  font-weight: 700;
}

.analytics-metric-value {
  margin-top: 8px;
  color: #172033;
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
}

.analytics-metric-hint {
  margin-top: 8px;
  color: #667085;
  font-size: 12px;
}

.analytics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.analytics-section {
  padding: 18px;
}

.analytics-section-wide {
  grid-column: 1 / -1;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.section-head span {
  color: #667085;
  font-size: 12px;
}

.ranking-list {
  display: grid;
  gap: 12px;
}

.ranking-item {
  padding: 14px;
  border: 1px solid #e4e8f0;
  border-radius: 10px;
  background: #fff;
}

.ranking-item.compact {
  padding: 12px 14px;
}

.ranking-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.ranking-meta {
  margin-top: 4px;
  color: #667085;
  font-size: 12px;
}

.ranking-value {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #172033;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.progress-track {
  height: 8px;
  border-radius: 999px;
  background: #edf2f7;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2563eb, #0f766e);
}

.progress-fill.secondary {
  background: linear-gradient(90deg, #0f766e, #14b8a6);
}

.progress-fill.warning {
  background: linear-gradient(90deg, #f59e0b, #f97316);
}

@media (max-width: 980px) {
  .analytics-grid,
  .analytics-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
