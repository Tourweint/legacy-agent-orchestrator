// 接入层 HTTP 服务 —— 第 13 章 阶段 4（L1）：参数形状校验、调用编排层、响应包装、事件流推送。
//
// 禁止项的落实：本层不做任何业务判断（意图是否可办交给判定层）；不自行推断执行步骤
// （事件流与证据链同源，由 event-stream 机械映射）；不输出凭证（证据链写入时已净化）。
// 两条路径汇入同一段编排逻辑（第 03 章 §十）：结构化任务直接进 TaskRunner；
// 自然语言路径（阶段 5）经理解层产出结构化意图后进入同一个 TaskRunner。
//
// 登录（2026-09-25 拓展实现，登录方案影响面 #1/#4/#12/#14/#15）：
//   · 三个登录端点由 auth-endpoints.js 处理；其余端点**一律要求会话**（未登录 → 4010）
//   · 身份不再由请求参数决定：写操作走会话本人的存量令牌，只读事实可借服务只读身份
//   · 任务带 owner（发起人）；回复/取消/查看一个任务时只认它自己的发起人
//   · identity 请求参数 deprecated：**传了也忽略，不传不再报 4004**（三审拍板）
//
// 端点、请求/响应结构、错误码的登记见 docs/基线文档/对外接口清单.md（Gate 3 交付物）。

import { createServer } from 'node:http'
import { EvidenceChain } from '../evidence/evidence-chain.js'
import { ContactGateway } from '../contact/contact-gateway.js'
import { UnderstandingEngine } from '../understanding/understanding.js'
import { LlmClient } from '../understanding/llm-client.js'
import { ProtocolAdapters } from '../contact/adapters.js'
import { JudgmentEngine } from '../judgment/judgment-engine.js'
import { TaskRunner } from '../orchestration/task-runner.js'
import { TaskStore } from './task-store.js'
import { mapEntryToEvent, sseFrame } from './event-stream.js'
import { resolveSession, handleAuthRoute, AUTH_ERROR_CODES } from './auth-endpoints.js'

// 错误码（登记于对外接口清单；形状校验错误在这里，可办性判断在判定层）
export const ERROR_CODES = {
  OK: 0,
  BAD_JSON: 4000,
  UNKNOWN_INTENT: 4001,
  BAD_RESOURCES: 4002,
  BAD_SLOT: 4003,
  BAD_IDENTITY: 4004, // deprecated：identity 参数已作废，仅为旧调用方保留码位说明
  BAD_REQUEST: 4005,
  TASK_NOT_SUSPENDED: 4090,
  TASK_NOT_FOUND: 4040,
  TASK_NOT_OWNED: 4041, // 任务存在但不属于当前登录用户（不暴露其内容）
  ROUTE_NOT_FOUND: 4044,
  INTERNAL: 5000,
}

let taskSeq = 0

function sendJson(res, httpStatus, code, message, data) {
  const body = JSON.stringify({ code, message, data })
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ---- 形状校验（只管形状：字段存在与类型；可办性归判定层）----
// 注意：identity 不再校验——登录后身份由会话派生（三审拍板：传了忽略、不传不报 4004）
function validateTaskBody(body, configStore) {
  if (typeof body.intentId !== 'string' || !body.intentId) return { code: ERROR_CODES.UNKNOWN_INTENT, message: '缺少 intentId' }
  // 目标不是教室的意图（C7 的"我的预约 / 撤销我的预约"）：不要求 resources 与 slot——
  // 它们的目标是"我自己的记录"，由引擎从"我的预约"里定位（意图计划声明 requiresEntityResolution: false）。
  // 未登记的意图照旧走下面的严格校验（不因为读不到计划就放宽）。
  let targetless = false
  try {
    targetless = configStore?.getIntent?.(body.intentId)?.requiresEntityResolution === false
  } catch {
    targetless = false
  }
  if (targetless) return null
  if (!Array.isArray(body.resources) || body.resources.length === 0) return { code: ERROR_CODES.BAD_RESOURCES, message: '缺少 resources（至少一个资源目标）' }
  for (const r of body.resources) {
    const c = r?.classroom
    if (!c || (c.classroomId == null && !(c.building && c.roomNumber))) {
      return { code: ERROR_CODES.BAD_RESOURCES, message: '每个资源需要 classroom.classroomId 或 classroom.building+roomNumber' }
    }
  }
  const start = body.slot?.start ? new Date(body.slot.start) : null
  const end = body.slot?.end ? new Date(body.slot.end) : null
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { code: ERROR_CODES.BAD_SLOT, message: 'slot.start/end 必须是可解析的绝对时刻（ISO 8601）' }
  }
  if (start.getTime() >= end.getTime()) {
    return { code: ERROR_CODES.BAD_SLOT, message: 'slot.start 必须早于 slot.end' }
  }
  return null
}

/**
 * 创建接入层服务。
 * @param {object} deps
 * @param {import('../config/config-store.js').ConfigStore} deps.configStore
 * @param {import('../contact/http-transport.js').HttpTransport} deps.transport  共享传输（唯一出口在接触层）
 * @param {import('../contact/identity-pool.js').IdentityPool} deps.identityPool 服务身份池（只读事实借用）
 * @param {import('../contact/user-token-store.js').UserTokenStore} deps.userTokenStore 登录用户令牌
 * @param {import('./session-store.js').SessionStore} deps.sessionStore  引擎会话
 * @param {object} [deps.chaos]  混沌控制器（只读暴露 armed，供检查脚本机械断言；P2-2）
 */
export function createAccessServer({ configStore, transport, identityPool, adapters, llm, userTokenStore, sessionStore, chaos = null }) {
  const llmClient = llm ?? new LlmClient()
  const adapterImpl = adapters ?? new ProtocolAdapters({ configStore })
  const sessionConstants = configStore.getConstants().session
  // 共享装配（构造期一次）：适配器与身份池跨任务复用；证据链按任务独立
  const sharedGateway = new ContactGateway({ configStore, transport, identityPool, userTokenStore, adapters: adapterImpl })
  const taskStore = new TaskStore()

  // 每任务运行栈：证据链/网关/判定/理解（留档绑定本任务链）/编排
  // 网关视图绑定**本任务的发起人**（登录会话派生）——写操作只认这个人的身份（决定 3）
  function newTaskStack(taskId, session) {
    const chain = new EvidenceChain({ taskId, evidenceConstants: configStore.getConstants().evidence })
    const user = { username: session.username, role: session.role }
    const taskGateway = sharedGateway.forTask(chain, { user })
    const judgment = new JudgmentEngine({ configStore, gateway: taskGateway, evidenceChain: chain })
    const understanding = new UnderstandingEngine({ configStore, llm: llmClient, evidenceChain: chain })
    const runner = new TaskRunner({
      configStore,
      gateway: taskGateway,
      judgmentEngine: judgment,
      evidenceChain: chain,
      understandingEngine: understanding,
      user,
    })
    return { chain, runner }
  }

  // 登录后身份的规范化形态：写操作走本人令牌（网关按接口声明的 initiator 解析）
  function identityOf(session) {
    return { id: session.username, userId: session.userInfo?.id ?? null, role: session.role }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const route = `${req.method} ${url.pathname}`
    try {
      // CORS（开发期前端 5173 跨源；登记于对外接口清单）
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID, Authorization')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (route === 'GET /api/health') {
        sendJson(res, 200, ERROR_CODES.OK, 'ok', {
          status: 'ok',
          tasks: taskStore.tasks.size,
          sessions: sessionStore.size,
          // 布防状态只读暴露（P2-2）：录制前的机械断言取代"人工提醒"，避免录到未布防的空镜
          chaos: { armed: chaos?.armed === true },
        })
        return
      }

      // ---- 登录端点（无需会话；形状与错误码见 auth-endpoints.js）----
      if (
        await handleAuthRoute({
          req,
          res,
          route,
          deps: { sessionStore, userTokenStore, sessionConstants, sendJson, readBody, errorCodes: ERROR_CODES },
        })
      ) {
        return
      }

      // ---- 会话中间件（影响面 #15）：其余端点一律要求已登录；未登录 → 4010 ----
      const session = resolveSession(req, { sessionStore, sessionConstants })
      const requireSession = () => {
        if (session) return true
        sendJson(res, 401, AUTH_ERROR_CODES.UNAUTHORIZED, '未登录（请先登录：POST /api/auth/login）')
        return false
      }

      // 术语对照表（零术语纪律）：界面拿它把 P-xxx / R1 / F4 这类内部编号渲染成人话。
      // 放在受保护端点里（未登录 401）——它不是敏感数据，但保持"除健康检查与登录外一律要会话"的一致口径。
      if (route === 'GET /api/meta/glossary') {
        if (!requireSession()) return
        sendJson(res, 200, ERROR_CODES.OK, 'ok', configStore.getGlossary())
        return
      }
      // 任务归属校验（影响面 #12）：只允许操作自己发起的任务；对他人任务不暴露任何内容
      const ownedTask = (taskId) => {
        const task = taskStore.get(taskId)
        if (!task) return { error: { status: 404, code: ERROR_CODES.TASK_NOT_FOUND, message: '任务不存在' } }
        if (task.owner && task.owner !== session.username) {
          return { error: { status: 404, code: ERROR_CODES.TASK_NOT_OWNED, message: '任务不存在（不属于当前登录用户）' } }
        }
        return { task }
      }

      // 结构化任务入口（无 LLM 路径，第 03 章 §十；G5 调试入口）
      if (route === 'POST /api/tasks') {
        if (!requireSession()) return
        const raw = await readBody(req)
        let body
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, ERROR_CODES.BAD_JSON, '请求体不是合法 JSON')
          return
        }
        const invalid = validateTaskBody(body, configStore)
        if (invalid) {
          sendJson(res, 400, invalid.code, invalid.message)
          return
        }

        // 每任务独立证据链与运行栈；传输/身份池/适配器共享
        taskSeq += 1
        const taskId = `T-${Date.now()}-${taskSeq}`
        const { chain, runner } = newTaskStack(taskId, session)
        taskStore.register({
          taskId,
          owner: session.username,
          chain,
          runner,
          run: runner
            .executeTask({
              intentId: body.intentId,
              // 目标不是教室的意图可以不传 resources / slot（引擎自己从"我的预约"里定位）
              resources: body.resources,
              slot: body.slot ? { start: new Date(body.slot.start), end: new Date(body.slot.end) } : null,
              reason: body.reason,
              identity: identityOf(session),
            })
            .then((result) => {
              taskStore.complete(taskId, result)
              return result
            }),
        })
        // 结果由事件流的终态事件给出（§六：最终结果也由同一条流给出）；另提供 GET 快照兜底
        sendJson(res, 200, ERROR_CODES.OK, 'accepted', { taskId, eventsPath: `/api/tasks/${taskId}/events` })
        return
      }

      // 自然语言入口（阶段 5 开放）：理解层产出结构化意图后汇入同一资源队列（第 03 章 §十）
      if (route === 'POST /api/chat') {
        if (!requireSession()) return
        const raw = await readBody(req)
        let body
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, ERROR_CODES.BAD_JSON, '请求体不是合法 JSON')
          return
        }
        if (typeof body.text !== 'string' || !body.text.trim()) {
          sendJson(res, 400, ERROR_CODES.BAD_JSON, '缺少 text（用户原话）')
          return
        }
        taskSeq += 1
        const taskId = `T-${Date.now()}-${taskSeq}`
        const { chain, runner } = newTaskStack(taskId, session)
        const task = taskStore.register({
          taskId,
          owner: session.username,
          chain,
          runner,
          stack: null, // 挂起时由下方回填运行栈
          run: runner
            .executeChatTask({ text: body.text, identity: identityOf(session) })
            .then((outcome) => {
              if (outcome.suspended) {
                task.stack = outcome.stack
                taskStore.suspend(taskId, outcome.clarify)
              } else {
                taskStore.complete(taskId, outcome.result)
              }
              return outcome
            }),
        })
        void task
        sendJson(res, 200, ERROR_CODES.OK, 'accepted', { taskId, eventsPath: `/api/tasks/${taskId}/events` })
        return
      }

      // 挂起任务的追问回复（B8：AWAIT_CLARIFY 在写请求发出前，取消/回复均生效）
      const replyMatch = /^\/api\/tasks\/([^/]+)\/reply$/.exec(url.pathname)
      if (req.method === 'POST' && replyMatch) {
        if (!requireSession()) return
        const { task, error } = ownedTask(decodeURIComponent(replyMatch[1]))
        if (error) {
          sendJson(res, error.status, error.code, error.message)
          return
        }
        if (task.status !== 'suspended') {
          sendJson(res, 409, ERROR_CODES.TASK_NOT_SUSPENDED, `任务当前状态为 ${task.status}，无法回复（仅挂起中的追问可回复）`)
          return
        }
        const raw = await readBody(req)
        let body
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, ERROR_CODES.BAD_JSON, '请求体不是合法 JSON')
          return
        }
        if (typeof body.text !== 'string' || !body.text.trim()) {
          sendJson(res, 400, ERROR_CODES.BAD_JSON, '缺少 text（回复原话）')
          return
        }
        task.status = 'running'
        task.clarify = null
        runnerFor(task)?.resumeChat({ stack: task.stack, replyText: body.text }).then((outcome) => {
          if (outcome.suspended) {
            task.status = 'suspended'
            task.clarify = outcome.clarify
          } else {
            taskStore.complete(task.taskId, outcome.result)
          }
        })
        sendJson(res, 200, ERROR_CODES.OK, 'accepted', { taskId: task.taskId, eventsPath: `/api/tasks/${task.taskId}/events` })
        return
      }

      // 取消挂起中的任务（B8：写请求发出前生效；提交后的取消是忽略型无边）
      const cancelMatch = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'DELETE' && cancelMatch) {
        if (!requireSession()) return
        const { task, error } = ownedTask(decodeURIComponent(cancelMatch[1]))
        if (error) {
          sendJson(res, error.status, error.code, error.message)
          return
        }
        if (task.status !== 'suspended') {
          sendJson(res, 409, ERROR_CODES.TASK_NOT_SUSPENDED, `任务当前状态为 ${task.status}——已提交后的取消不生效（B8），结果将由查证收敛给出`)
          return
        }
        try {
          const { result } = runnerFor(task).cancelChat({ stack: task.stack })
          taskStore.complete(task.taskId, result)
          sendJson(res, 200, ERROR_CODES.OK, 'cancelled', result)
        } catch (err) {
          sendJson(res, 500, ERROR_CODES.INTERNAL, `取消失败：${err.message}`)
        }
        return
      }

      // 任务结果快照（调试/兜底；主通道是事件流）
      const snapshotMatch = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'GET' && snapshotMatch) {
        if (!requireSession()) return
        const { task, error } = ownedTask(decodeURIComponent(snapshotMatch[1]))
        if (error) {
          sendJson(res, error.status, error.code, error.message)
          return
        }
        sendJson(res, 200, ERROR_CODES.OK, 'ok', {
          taskId: task.taskId,
          status: task.status,
          result: task.result,
          clarify: task.status === 'suspended' ? task.clarify : undefined,
          owner: task.owner ?? null,
          createdAt: task.createdAt,
        })
        return
      }

      // 证据链导出（§6.3 规格 4：evidenceRef 必须可解析——解析不到按缺陷上报）
      const evidenceMatch = /^\/api\/tasks\/([^/]+)\/evidence$/.exec(url.pathname)
      if (req.method === 'GET' && evidenceMatch) {
        if (!requireSession()) return
        const { task, error } = ownedTask(decodeURIComponent(evidenceMatch[1]))
        if (error) {
          sendJson(res, error.status, error.code, error.message)
          return
        }
        sendJson(res, 200, ERROR_CODES.OK, 'ok', { taskId: task.taskId, entries: task.entries() })
        return
      }

      // 事件流（SSE）：重放 + 实时；断线续传按 Last-Event-ID / ?lastSeq（§6.3 规格 3）
      const eventsMatch = /^\/api\/tasks\/([^/]+)\/events$/.exec(url.pathname)
      if (req.method === 'GET' && eventsMatch) {
        if (!requireSession()) return
        const taskId = decodeURIComponent(eventsMatch[1])
        const { task, error } = ownedTask(taskId)
        if (error) {
          sendJson(res, error.status, error.code, error.message)
          return
        }
        const lastSeq =
          Number.parseInt(req.headers['last-event-id'] ?? url.searchParams.get('lastSeq') ?? '0', 10) || 0
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        // 先重放已发生的条目，再订阅实时推送；终态事件后关闭流（§6.3 规格 2/3）
        for (const entry of task.entries()) {
          const event = mapEntryToEvent(entry)
          if (event.seq > lastSeq) res.write(sseFrame(event))
        }
        if (task.status === 'terminal') {
          res.end()
          return
        }
        const unsubscribe = taskStore.stream.subscribe(taskId, (event) => {
          if (event.seq > lastSeq) res.write(sseFrame(event))
          if (event.type === 'terminal') res.end()
        })
        req.on('close', unsubscribe)
        return
      }

      sendJson(res, 404, ERROR_CODES.ROUTE_NOT_FOUND, '未知路由')
    } catch (err) {
      // 接入层不吞错误也不做业务判断：统一 5000 上报（无凭证）
      sendJson(res, 500, ERROR_CODES.INTERNAL, `内部错误：${err.message}`)
    }
  })

  function runnerFor(task) {
    return task.runner
  }

  return { server, taskStore, sessionStore }
}
