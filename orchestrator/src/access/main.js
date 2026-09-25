// 编排引擎入口 —— 阶段 4：装配共享栈（配置/传输/身份池）并监听 8090（决策 A2）。
//
// 启动前置（第 11 章 §四）：存量系统(8080)、MariaDB、Redis 应已就绪——本进程不自检它们的
// 状态；探活由部署脚本承担（deploy/scripts/smoke 覆盖三身份登录）。
//
// 用法：npm start   （环境变量：ORCH_PORT 覆盖端口；ORCH_LEGACY_*_PASSWORD 注入凭证）

import { ConfigStore } from '../config/config-store.js'
import { HttpTransport } from '../contact/http-transport.js'
import { IdentityPool } from '../contact/identity-pool.js'
import { ProtocolAdapters } from '../contact/adapters.js'
import { createAccessServer } from './http-server.js'

const store = new ConfigStore()
const constants = store.getConstants()
const baseUrl =
  process.env[constants.contact.legacyBaseUrlEnv] || constants.contact.legacyBaseUrlDefault
const port = Number.parseInt(process.env.ORCH_PORT ?? '8090', 10)

const transport = new HttpTransport({ baseUrl })
const adapters = new ProtocolAdapters({ configStore: store })
const identityPool = new IdentityPool({ configStore: store, transport, adapters, constants })

const { server } = createAccessServer({ configStore: store, transport, identityPool, adapters })
server.listen(port, () => {
  console.log(`[orchestrator] 编排引擎已启动 → http://localhost:${port}`)
  console.log(`[orchestrator] 存量系统：${baseUrl}`)
  console.log('[orchestrator] 端点：POST /api/tasks · GET /api/tasks/:id · GET /api/tasks/:id/events (SSE) · GET /api/health')
})
