<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import { adminApi } from '../api'

const loading = ref(false)
const configs = ref([])
const configCategory = ref('')
const savingConfigKey = ref('')

const configCategoryOptions = [
  { label: '全部分类', value: '' },
  { label: '预约规则', value: 'RESERVATION' },
  { label: '签到规则', value: 'ATTENDANCE' },
  { label: '信誉规则', value: 'CREDIT' },
  { label: '前端展示', value: 'UI' }
]

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

async function saveConfig(row) {
  if (!row?.configKey || row.editable !== 1) return
  savingConfigKey.value = row.configKey
  try {
    const data = await adminApi.updateConfig(row.configKey, { configValue: row.editValue })
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

loadConfigs()
</script>

<template>
  <div class="metric-row">
    <div class="metric">
      <div class="metric-label">配置项</div>
      <div class="metric-value">{{ configs.length }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">当前分类</div>
      <div class="metric-value" style="font-size:20px">{{ configCategoryText(configCategory) }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">可编辑项</div>
      <div class="metric-value">{{ configs.filter(item => item.editable === 1).length }}</div>
    </div>
    <div class="metric">
      <div class="metric-label">只读项</div>
      <div class="metric-value">{{ configs.filter(item => item.editable !== 1).length }}</div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <div>
        <strong>规则配置</strong>
        <div class="hint">统一维护预约、签到和信誉规则，修改后后端会按最新配置立即生效。</div>
      </div>
      <div class="form-row">
        <el-select v-model="configCategory" style="width: 150px" @change="loadConfigs">
          <el-option v-for="item in configCategoryOptions" :key="item.value || 'ALL'" :label="item.label" :value="item.value" />
        </el-select>
        <el-button type="primary" :icon="Search" @click="loadConfigs">查询</el-button>
        <el-button :icon="Refresh" @click="loadConfigs">刷新</el-button>
      </div>
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
          <el-input v-if="row.editable === 1" v-model="row.editValue" class="config-value-input" maxlength="255" />
          <span v-else>{{ row.configValue }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
      <el-table-column label="可编辑" width="90">
        <template #default="{ row }">
          <el-tag :type="row.editable === 1 ? 'success' : 'info'">{{ row.editable === 1 ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.editable === 1" size="small" type="primary" :loading="savingConfigKey === row.configKey" @click="saveConfig(row)">
            保存
          </el-button>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.hint {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.config-value-input {
  width: 100%;
}
</style>
