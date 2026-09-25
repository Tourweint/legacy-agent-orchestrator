// 编排引擎入口 —— 阶段 4：装配共享栈（配置/传输/身份池）并监听 8090（决策 A2）。
//
// 启动前置（第 11 章 §四）：存量系统(8080)、MariaDB、Redis 应已就绪——本进程不自检它们的
// 状态；探活由部署脚本承担（deploy/scripts/demo-checklist.sh 覆盖 14 项检查）。
//
// 混沌（第 09 章 §七）：默认撤防。仅当环境变量 ORCH_CHAOS_INJECT（JSON 布防指令）存在时
// 才布防——用于第 5 幕 T5 演示与实验复跑（deploy/scripts/inject-once.mjs 生成）；注入生效时
// 证据链 metadata 会携带 injected/faultNote（§七 可见性要求）。
//
// 用法：npm start   （环境变量：ORCH_PORT 覆盖端口；ORCH_LEGACY_*_PASSWORD 注入凭证）

import { ConfigStore } from '../config/config-store.js'
import { HttpTransport } from '../contact/http-transport.js'
import { IdentityPool } from '../contact/identity-pool.js'
import { UserTokenStore } from '../contact/user-token-store.js'
import { ProtocolAdapters } from '../contact/adapters.js'
import { ChaosController } from '../chaos/chaos-controller.js'
import { SessionStore } from './session-store.js'
import { createAccessServer } from './http-server.js'

const store = new ConfigStore()
const constants = store.getConstants()
const baseUrl =
  process.env[constants.contact.legacyBaseUrlEnv] || constants.contact.legacyBaseUrlDefault
const port = Number.parseInt(process.env.ORCH_PORT ?? '8090', 10)

const chaos = new ChaosController({ configStore: store })
if (process.env.ORCH_CHAOS_INJECT) {
  try {
    chaos.arm(JSON.parse(process.env.ORCH_CHAOS_INJECT))
    console.log('[orchestrator] ⚠ 混沌已布防（ORCH_CHAOS_INJECT）——演示路径必须撤防运行！')
  } catch (err) {
    console.error(`[orchestrator] 布防指令解析失败：${err.message}（以撤防启动）`)
  }
}

const transport = new HttpTransport({
  baseUrl,
  onOutbound: chaos.armed ? (info) => chaos.onOutbound(info) : null,
})
const adapters = new ProtocolAdapters({ configStore: store })
const identityPool = new IdentityPool({ configStore: store, transport, adapters, constants })
// 登录（2026-09-25）：用户令牌注册表（写操作走本人）+ 引擎会话（前端只拿引擎会话令牌）
const userTokenStore = new UserTokenStore({ configStore: store, transport, adapters, constants })
const sessionStore = new SessionStore({ constants })

// 启动自检：服务只读身份的凭证必须齐备（2026-09-25 冒烟实测踩到）
// 缺凭证时引擎本来也能"起来"，但每个任务都会以"任务异常终止"收场——看起来像业务问题、
// 其实是环境问题。宁可启动即失败并指明缺哪个变量（一键启动脚本已内置演示账号默认值）。
const missingCredentials = identityPool.missingCredentials()
if (missingCredentials.length > 0) {
  console.error('[orchestrator] 启动中止：缺少服务身份凭证（跨权限域事实与教室详情都靠它读）')
  for (const item of missingCredentials) {
    console.error(`  · ${item.id} 需要环境变量 ${item.envName}`)
  }
  console.error('  演示环境可用一键启动（会内置演示账号默认值）：start-all.bat engine')
  console.error('  手工启动示例：ORCH_LEGACY_ADMIN_PASSWORD=... ORCH_LEGACY_TEACHER_PASSWORD=... npm start')
  process.exit(1)
}

const { server } = createAccessServer({
  configStore: store,
  transport,
  identityPool,
  userTokenStore,
  sessionStore,
  adapters,
  chaos,
})
server.listen(port, () => {
  console.log(`[orchestrator] 编排引擎已启动 → http://localhost:${port}`)
  console.log(`[orchestrator] 存量系统：${baseUrl}`)
  console.log('[orchestrator] 端点：POST /api/auth/login · GET /api/auth/me · POST /api/chat · POST /api/tasks · GET /api/tasks/:id/events (SSE) · GET /api/health')
  console.log('[orchestrator] 登录后所有业务端点需携带会话（Cookie orch_session 或 Authorization: Bearer）')
})
