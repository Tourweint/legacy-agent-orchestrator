<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  Calendar,
  DataBoard,
  OfficeBuilding,
  Plus,
  Tickets,
  TrendCharts,
} from "@element-plus/icons-vue";
import {
  adminApi,
  classroomApi,
  notificationApi,
  reservationApi,
} from "../api";
import { useAuthStore } from "../stores/auth";
import { formatBeijingClock, formatBeijingDate, formatDateTimeText, parseUtcTime } from "../utils/date";
import {
  enabledStatusText,
  notificationTypeText,
  reservationStatusText,
  resourceTypeText,
} from "../utils/dict";

const router = useRouter();
const authStore = useAuthStore();
const user = computed(() => authStore.user);
const loading = ref(false);
const classrooms = ref([]);
const activeReservations = ref([]);
const historyReservations = ref([]);
const notifications = ref([]);
const unreadCount = ref(0);

const roleName = computed(() => {
  const map = {
    ADMIN: "管理员",
    TEACHER: "教师",
    STUDENT: "学生",
  };
  return map[user.value?.role] || "用户";
});
const isAdmin = computed(() => user.value?.role === "ADMIN");
const today = formatBeijingDate();
const enabledClassrooms = computed(
  () => classrooms.value.filter((item) => item.status === "ENABLED").length
);
const disabledClassrooms = computed(
  () => classrooms.value.filter((item) => item.status === "DISABLED").length
);
const totalCapacity = computed(() =>
  classrooms.value.reduce((sum, item) => sum + (item.capacity || 0), 0)
);
const todayReservations = computed(() =>
  activeReservations.value.filter((item) => isSameDay(item.startTime, today))
);
const sortedActiveReservations = computed(() =>
  [...activeReservations.value].sort(
    (a, b) => getTime(a.startTime) - getTime(b.startTime)
  )
);
const currentReservation = computed(() =>
  sortedActiveReservations.value.find(
    (item) =>
      getTime(item.startTime) <= Date.now() &&
      getTime(item.endTime) >= Date.now()
  )
);
const nextReservation = computed(
  () =>
    sortedActiveReservations.value.find(
      (item) => getTime(item.startTime) >= Date.now()
    ) || sortedActiveReservations.value[0]
);
const recentReservations = computed(() =>
  [...activeReservations.value, ...historyReservations.value].slice(0, 5)
);
const recommendedClassrooms = computed(() =>
  [...classrooms.value]
    .filter((item) => item.status === "ENABLED")
    .sort((a, b) => (b.capacity || 0) - (a.capacity || 0))
    .slice(0, 4)
);
const buildingStats = computed(() => {
  const stats = new Map();
  classrooms.value.forEach((item) => {
    const current = stats.get(item.building) || {
      building: item.building,
      count: 0,
      capacity: 0,
      enabled: 0,
    };
    current.count += 1;
    current.capacity += item.capacity || 0;
    if (item.status === "ENABLED") current.enabled += 1;
    stats.set(item.building, current);
  });
  return [...stats.values()]
    .sort((a, b) => b.capacity - a.capacity)
    .slice(0, 5);
});

function getClassroomTask() {
  if (!isAdmin.value) {
    return classroomApi.available({ min_capacity: 1 });
  }

  return adminApi.analytics().then((analytics) =>
    (analytics?.classroomUtilizationList || []).map((item) => ({
      ...item,
      id: item.classroomId,
    }))
  );
}

async function loadPrimaryData() {
  const [classroomList, activeList, unread] = await Promise.all([
    getClassroomTask(),
    !isAdmin.value ? reservationApi.list() : Promise.resolve([]),
    !isAdmin.value ? notificationApi.unreadCount() : Promise.resolve({ count: 0 }),
  ]);

  classrooms.value = classroomList || [];
  activeReservations.value = activeList || [];
  unreadCount.value = unread?.count || 0;
}

async function loadSecondaryData() {
  if (isAdmin.value) {
    return;
  }

  try {
    const [historyList, notificationList] = await Promise.all([
      reservationApi.history(),
      notificationApi.list({ limit: 4 }),
    ]);
    historyReservations.value = historyList || [];
    notifications.value = notificationList || [];
  } catch {
    // Keep the dashboard interactive even if secondary data loads fail.
  }
}

async function loadData() {
  loading.value = true;
  try {
    await loadPrimaryData();
  } finally {
    loading.value = false;
  }

  void loadSecondaryData();
}

async function markNotificationsRead() {
  await notificationApi.markAllRead();
  notifications.value = notifications.value.map((item) => ({
    ...item,
    isRead: 1,
  }));
  unreadCount.value = 0;
}

function getTime(value) {
  return parseUtcTime(value);
}

function isSameDay(value, day) {
  return formatBeijingDate(value) === day;
}

function goPrimaryAction() {
  router.push(isAdmin.value ? "/admin" : "/classrooms");
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div v-loading="loading" class="dashboard">
    <section class="workbench-hero">
      <div>
        <div class="hero-kicker">{{ roleName }} | 校园预约平台</div>
        <h2>
          {{
            isAdmin
              ? "后台运行总览"
              : user?.role === "TEACHER"
              ? "教室预约工作台"
              : "座位预约工作台"
          }}
        </h2>
        <p>
          {{
            isAdmin
              ? "查看资源规模、启用状态和维护入口。"
              : user?.role === "STUDENT"
              ? "查看当前安排、最近通知和常用预约入口。系统会结合近期使用情况动态调整后续预约范围。"
              : "查看当前安排、最近通知和常用预约入口。"
          }}
        </p>
      </div>
      <el-button
        type="primary"
        size="large"
        :icon="Plus"
        @click="goPrimaryAction"
      >
        {{
          isAdmin
            ? "进入后台管理"
            : user?.role === "TEACHER"
            ? "查找空教室"
            : "查找座位"
        }}
      </el-button>
    </section>

    <div class="metric-row">
      <div class="metric">
        <div class="metric-label">启用教室</div>
        <div class="metric-value">{{ enabledClassrooms }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">总容量</div>
        <div class="metric-value">{{ totalCapacity }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">{{ isAdmin ? "禁用教室" : "有效预约" }}</div>
        <div class="metric-value">
          {{ isAdmin ? disabledClassrooms : activeReservations.length }}
        </div>
      </div>
      <div class="metric">
        <div class="metric-label">{{ isAdmin ? "教学楼数" : "未读通知" }}</div>
        <div class="metric-value">
          {{ isAdmin ? buildingStats.length : unreadCount }}
        </div>
      </div>
    </div>

    <div v-if="!isAdmin" class="dashboard-grid main-grid">
      <section class="panel focus-panel">
        <div class="toolbar">
          <div>
            <strong>{{
              currentReservation ? "正在进行" : "下一条预约"
            }}</strong>
            <div class="hint">登录后优先显示当前或即将开始的预约安排</div>
          </div>
          <el-button text type="primary" @click="router.push('/reservations')"
            >全部预约</el-button
          >
        </div>
        <div v-if="currentReservation || nextReservation" class="next-card">
          <el-tag :type="currentReservation ? 'success' : 'primary'">{{
            currentReservation ? "进行中" : "即将开始"
          }}</el-tag>
          <h3>{{ (currentReservation || nextReservation).resourceName }}</h3>
          <p>
            {{
              resourceTypeText(
                (currentReservation || nextReservation).resourceType
              )
            }}
            |
            {{
              formatDateTimeText(
                (currentReservation || nextReservation).startTime
              )
            }}
            -
            {{
              formatDateTimeText(
                (currentReservation || nextReservation).endTime
              )
            }}
          </p>
          <div class="next-actions">
            <el-button
              type="primary"
              :icon="OfficeBuilding"
              @click="router.push('/classrooms')"
              >继续预约</el-button
            >
            <el-button :icon="Tickets" @click="router.push('/reservations')"
              >管理预约</el-button
            >
          </div>
        </div>
        <el-empty v-else description="暂无有效预约" />
      </section>

      <section class="panel">
        <div class="toolbar">
          <div>
            <strong>最新通知</strong>
            <div class="hint">
              管理员对您的账号或预约有操作后，会在这里看到提醒
            </div>
          </div>
          <el-button
            text
            type="primary"
            :disabled="unreadCount === 0"
            @click="markNotificationsRead"
            >全部已读</el-button
          >
        </div>
        <el-empty v-if="notifications.length === 0" description="暂无通知" />
        <div v-else class="notification-list">
          <div
            v-for="item in notifications"
            :key="item.id"
            class="notification-item"
            :class="{ unread: item.isRead === 0 }"
          >
            <div class="notification-meta">
              <el-tag :type="item.isRead === 0 ? 'danger' : 'info'">{{
                notificationTypeText(item.type)
              }}</el-tag>
              <span>{{ formatDateTimeText(item.createTime) }}</span>
            </div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.content }}</p>
          </div>
        </div>
      </section>
    </div>

    <div class="dashboard-grid">
      <section class="panel">
        <div class="toolbar">
          <div>
            <strong>{{ isAdmin ? "管理入口" : "快捷操作" }}</strong>
            <div class="hint">
              {{
                isAdmin
                  ? "进入教室、用户和预约维护界面"
                  : "快速进入最常用的预约流程"
              }}
            </div>
          </div>
        </div>
        <div class="quick-actions">
          <button
            class="quick-action"
            @click="router.push(isAdmin ? '/admin' : '/classrooms')"
          >
            <el-icon><OfficeBuilding /></el-icon>
            <span>{{
              isAdmin
                ? "维护资源与用户"
                : user?.role === "TEACHER"
                ? "按时间找空教室"
                : "按时间找座位"
            }}</span>
          </button>
          <button
            v-if="!isAdmin"
            class="quick-action"
            @click="router.push('/reservations')"
          >
            <el-icon><Tickets /></el-icon>
            <span>查看我的预约与通知</span>
          </button>
          <button
            v-if="isAdmin"
            class="quick-action"
            @click="router.push('/admin')"
          >
            <el-icon><DataBoard /></el-icon>
            <span>封禁用户或取消预约</span>
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="toolbar">
          <div>
            <strong>{{ isAdmin ? "教学楼概览" : "最近预约" }}</strong>
            <div class="hint">
              {{
                isAdmin ? "按容量统计主要教学楼" : "最近 5 条有效或历史预约记录"
              }}
            </div>
          </div>
          <el-button
            v-if="!isAdmin"
            text
            type="primary"
            @click="router.push('/reservations')"
            >全部</el-button
          >
        </div>
        <div v-if="isAdmin" class="building-list">
          <div
            v-for="item in buildingStats"
            :key="item.building"
            class="building-item"
          >
            <div>
              <strong>{{ item.building }}</strong>
              <span>{{ item.enabled }}/{{ item.count }} 间启用</span>
            </div>
            <el-progress
              :percentage="
                totalCapacity
                  ? Math.round((item.capacity / totalCapacity) * 100)
                  : 0
              "
            />
          </div>
        </div>
        <el-empty
          v-else-if="recentReservations.length === 0"
          description="暂无预约记录"
        />
        <div v-else class="reservation-list">
          <div
            v-for="item in recentReservations"
            :key="item.id"
            class="reservation-item"
          >
            <el-icon><Calendar /></el-icon>
            <div>
              <strong>{{ item.resourceName || "预约资源" }}</strong>
              <span
                >{{ resourceTypeText(item.resourceType) }} |
                {{ formatDateTimeText(item.startTime) }} -
                {{ formatDateTimeText(item.endTime) }}</span
              >
            </div>
            <el-tag :type="item.status === 'ACTIVE' ? 'success' : 'info'">{{
              reservationStatusText(item.status)
            }}</el-tag>
          </div>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="toolbar">
        <div>
          <strong>{{ isAdmin ? "容量较大的教室" : "推荐可用空间" }}</strong>
          <div class="hint">
            {{
              isAdmin
                ? "优先关注大教室资源的启用状态"
                : "按容量优先展示，便于快速选择"
            }}
          </div>
        </div>
        <el-button
          text
          type="primary"
          :icon="TrendCharts"
          @click="goPrimaryAction"
          >{{ isAdmin ? "进入管理" : "去预约" }}</el-button
        >
      </div>
      <div class="recommend-grid">
        <article
          v-for="room in recommendedClassrooms"
          :key="room.id"
          class="recommend-card"
        >
          <div>
            <strong>{{ room.building }} {{ room.roomNumber }}</strong>
            <span
              >{{
                isAdmin
                  ? `总容量 ${room.capacity} | 利用率 ${Number(room.utilizationRate || 0).toFixed(1)}%`
                  : `总容量 ${room.capacity} | ${room.seatRows} 行 x ${room.seatCols} 列`
              }}</span
            >
          </div>
          <el-tag :type="room.status === 'ENABLED' ? 'success' : 'danger'">{{
            enabledStatusText(room.status)
          }}</el-tag>
        </article>
      </div>
    </section>

    <section v-if="!isAdmin" class="panel">
      <div class="toolbar">
        <div>
          <strong>今日日程</strong>
          <div class="hint">今天生效的预约会集中显示在这里</div>
        </div>
      </div>
      <el-empty
        v-if="todayReservations.length === 0"
        description="今天暂无预约"
      />
      <div v-else class="timeline-list">
        <div
          v-for="item in todayReservations"
          :key="item.id"
          class="timeline-item"
        >
          <span>{{ formatBeijingClock(item.startTime) }}</span>
          <div>
            <strong>{{ item.resourceName }}</strong>
            <p>
              {{ formatDateTimeText(item.startTime) }} -
              {{ formatDateTimeText(item.endTime) }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.workbench-hero {
  min-height: 190px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 28px;
  border: 1px solid rgba(228, 232, 240, 0.92);
  border-radius: 8px;
  background: linear-gradient(
      135deg,
      rgba(37, 99, 235, 0.12),
      rgba(15, 118, 110, 0.08)
    ),
    #fff;
  box-shadow: 0 18px 42px rgba(16, 24, 40, 0.06);
}

.hero-kicker {
  width: fit-content;
  margin-bottom: 12px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
}

.workbench-hero h2 {
  margin: 0;
  color: #172033;
  font-size: 32px;
}

.workbench-hero p {
  margin: 10px 0 0;
  color: #667085;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
}

.main-grid {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
}

.focus-panel {
  min-height: 260px;
}

.next-card {
  padding: 18px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.next-card h3 {
  margin: 14px 0 8px;
  color: #172033;
  font-size: 24px;
}

.next-card p,
.notification-item p {
  margin: 0;
  color: #475467;
  white-space: pre-line;
}

.next-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}

.quick-actions,
.recommend-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.quick-action {
  min-height: 104px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 12px;
  padding: 18px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
  color: #172033;
  cursor: pointer;
  font-weight: 800;
}

.quick-action .el-icon {
  color: #2563eb;
  font-size: 24px;
}

.reservation-list,
.timeline-list,
.building-list,
.notification-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reservation-item,
.timeline-item,
.building-item,
.recommend-card,
.notification-item {
  padding: 12px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  background: #fff;
}

.reservation-item,
.building-item,
.recommend-card {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.building-item,
.recommend-card {
  grid-template-columns: minmax(0, 1fr) auto;
}

.timeline-item {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.notification-item.unread {
  border-color: #fecaca;
  background: #fff7f7;
}

.notification-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.notification-meta span,
.reservation-item span,
.recommend-card span,
.building-item span,
.timeline-item p {
  display: block;
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.timeline-item > span {
  color: #2563eb;
  font-weight: 800;
}

.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

@media (max-width: 900px) {
  .workbench-hero,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .workbench-hero {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 680px) {
  .quick-actions,
  .recommend-grid {
    grid-template-columns: 1fr;
  }
}
</style>
