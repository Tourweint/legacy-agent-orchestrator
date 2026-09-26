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
import { ProtocolAdapters } from '../contact/adapters.js'
import { ChaosController } from '../chaos/chaos-controller.js'
import { createAccessServer } from './http-server.js'

const store = new ConfigStore()
const constants = store.getConstants()
const baseUrl =
  process.env[constants.contact.legacyBaseUrlEnv] || constants.contact.legacyBaseUrlDefault
const port = Number.parseInt(process.env.ORCH_PORT ?? '8090', 10)
// P1：默认只绑定本机回环地址，避免 8090 暴露到非本机网络；
// 如需对外提供服务，显式设置 ORCH_BIND_HOST=0.0.0.0 或具体网卡地址。
const bindHost = process.env.ORCH_BIND_HOST ?? '127.0.0.1'

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

const { server } = createAccessServer({ configStore: store, transport, identityPool, adapters })
server.listen(port, bindHost, () => {
  console.log(`[orchestrator] 编排引擎已启动 → http://${bindHost}:${port}`)
  console.log(`[orchestrator] 存量系统：${baseUrl}`)
  console.log('[orchestrator] 端点：POST /api/chat · POST /api/tasks · GET /api/tasks/:id · GET /api/tasks/:id/events (SSE) · GET /api/health')
})
