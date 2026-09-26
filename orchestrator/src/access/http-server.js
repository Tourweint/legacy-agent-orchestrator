// 接入层 HTTP 服务 —— 第 13 章 阶段 4（L1）：参数形状校验、调用编排层、响应包装、事件流推送。
//
// 禁止项的落实：本层不做任何业务判断（意图是否可办交给判定层）；不自行推断执行步骤
// （事件流与证据链同源，由 event-stream 机械映射）；不输出凭证（证据链写入时已净化）。
// 两条路径汇入同一段编排逻辑（第 03 章 §十）：结构化任务直接进 TaskRunner；
// 自然语言路径（阶段 5）经理解层产出结构化意图后进入同一个 TaskRunner。
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

// 错误码（登记于对外接口清单；形状校验错误在这里，可办性判断在判定层）
export const ERROR_CODES = {
  OK: 0,
  BAD_JSON: 4000,
  UNKNOWN_INTENT: 4001,
  BAD_RESOURCES: 4002,
  BAD_SLOT: 4003,
  BAD_IDENTITY: 4004,
  TASK_NOT_SUSPENDED: 4090,
  TASK_NOT_FOUND: 4040,
  ROUTE_NOT_FOUND: 4044,
  INTERNAL: 5000,
}

let taskSeq = 0

// CORS 显式来源（P1：不使用 *；开发期前端 5173，可通过环境变量覆盖）
const ALLOWED_ORIGIN = process.env.ORCH_CORS_ORIGIN || 'http://localhost:5173'

const MAX_BODY_BYTES = 64 * 1024 // 64 KB（P1：请求体上限，防内存耗尽）
const MAX_FIELD_LENGTH = 4096 // 单字段上限（text/reason/教室名等）

function sendJson(res, httpStatus, code, message, data) {
  const body = JSON.stringify({ code, message, data })
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      total += c.length
      if (total > MAX_BODY_BYTES) {
        aborted = true
        req.destroy()
        const err = new Error('请求体超过 64 KB 上限')
        err.code = 'PAYLOAD_TOO_LARGE'
        reject(err)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => {
      if (!aborted) reject(err)
    })
  })
}

// 严格 UTC 绝对时刻校验（P1：禁止无时区字符串，避免本地时区歧义）
function parseUtcInstant(value) {
  if (typeof value !== 'string' || !value) return null
  // 必须以 Z 结尾，或包含明确时区偏移（+08:00 / -05:00）
  if (!/Z$|[+-]\d{2}:\d{2}$/.test(value)) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

// ---- 形状校验（只管形状：字段存在与类型；可办性归判定层）----
function validateTaskBody(body) {
  if (typeof body.intentId !== 'string' || !body.intentId) return { code: ERROR_CODES.UNKNOWN_INTENT, message: '缺少 intentId' }
  if (body.intentId.length > 128) return { code: ERROR_CODES.UNKNOWN_INTENT, message: 'intentId 过长' }
  if (typeof body.identity !== 'string' || !body.identity) return { code: ERROR_CODES.BAD_IDENTITY, message: '缺少 identity（业务身份标识）' }
  if (body.identity.length > 64) return { code: ERROR_CODES.BAD_IDENTITY, message: 'identity 过长' }
  if (body.reason != null && (typeof body.reason !== 'string' || body.reason.length > MAX_FIELD_LENGTH)) {
    return { code: ERROR_CODES.BAD_JSON, message: 'reason 过长（上限 4096 字符）' }
  }
  if (!Array.isArray(body.resources) || body.resources.length === 0) return { code: ERROR_CODES.BAD_RESOURCES, message: '缺少 resources（至少一个资源目标）' }
  if (body.resources.length > 10) return { code: ERROR_CODES.BAD_RESOURCES, message: 'resources 过多（上限 10 个）' }
  for (const r of body.resources) {
    const c = r?.classroom
    if (!c || (c.classroomId == null && !(c.building && c.roomNumber))) {
      return { code: ERROR_CODES.BAD_RESOURCES, message: '每个资源需要 classroom.classroomId 或 classroom.building+roomNumber' }
    }
    if (c.building != null && (typeof c.building !== 'string' || c.building.length > 64)) {
      return { code: ERROR_CODES.BAD_RESOURCES, message: 'classroom.building 过长' }
    }
    if (c.roomNumber != null && (typeof c.roomNumber !== 'string' || c.roomNumber.length > 32)) {
      return { code: ERROR_CODES.BAD_RESOURCES, message: 'classroom.roomNumber 过长' }
    }
  }
  const start = parseUtcInstant(body.slot?.start)
  const end = parseUtcInstant(body.slot?.end)
  if (!start || !end) {
    return { code: ERROR_CODES.BAD_SLOT, message: 'slot.start/end 必须是带时区的绝对时刻（如 2026-09-30T05:00:00Z），禁止无时区字符串' }
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
 * @param {import('../contact/identity-pool.js').IdentityPool} deps.identityPool 共享身份池（token 缓存跨任务）
 */
export function createAccessServer({ configStore, transport, identityPool, adapters, llm }) {
  const llmClient = llm ?? new LlmClient()
  const adapterImpl = adapters ?? new ProtocolAdapters({ configStore })
  // 共享装配（构造期一次）：适配器与身份池跨任务复用；证据链按任务独立
  const sharedGateway = new ContactGateway({ configStore, transport, identityPool, adapters: adapterImpl })
  const taskStore = new TaskStore()

  // 每任务运行栈：证据链/网关/判定/理解（留档绑定本任务链）/编排
  function newTaskStack(taskId) {
    const chain = new EvidenceChain({ taskId, evidenceConstants: configStore.getConstants().evidence })
    const taskGateway = sharedGateway.forTask(chain)
    const judgment = new JudgmentEngine({ configStore, gateway: taskGateway, evidenceChain: chain })
    const understanding = new UnderstandingEngine({ configStore, llm: llmClient, evidenceChain: chain })
    const runner = new TaskRunner({
      configStore,
      gateway: taskGateway,
      judgmentEngine: judgment,
      evidenceChain: chain,
      understandingEngine: understanding,
    })
    return { chain, runner }
  }

  // P1：后台任务安全执行——任意异常必须收敛为终态，不得悬空（I3）
  function runTaskSafely({ taskId, chain, promiseFactory, onSuccess }) {
    return Promise.resolve()
      .then(() => promiseFactory())
      .then((outcome) => {
        onSuccess?.(outcome)
        return outcome
      })
      .catch((err) => {
        // 写入证据链（action 与终态映射见 event-stream.js：task-force-unresolved → UNRESOLVED）
        try {
          chain.record({
            action: 'task-force-unresolved',
            basis: [{ spec: 'I3-每次调用必须有唯一结论' }, { detail: `接入层捕获未处理异常: ${err.name}` }],
            conclusion: {
              outcome: 'UNRESOLVED',
              summary: `任务执行异常，已登记为不可恢复（${err.name}: ${err.message}）`,
            },
            phase: 'P6',
            metadata: { errorName: err.name },
          })
        } catch (recordErr) {
          // 证据链写入也失败时，至少保证任务状态收敛
          console.error(`[orchestrator] 证据链写入失败（任务 ${taskId}）:`, recordErr.message)
        }
        const result = {
          terminal: 'UNRESOLVED',
          steps: 0,
          results: [],
          compensations: [],
          conclusion: `任务执行异常，已登记为不可恢复（${err.name}: ${err.message}）`,
        }
        taskStore.complete(taskId, result)
        return result
      })
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const route = `${req.method} ${url.pathname}`
    try {
      // CORS（P1：显式来源，不使用 *；开发期前端 5173）
      res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (route === 'GET /api/health') {
        sendJson(res, 200, ERROR_CODES.OK, 'ok', { status: 'ok', tasks: taskStore.tasks.size })
        return
      }

      // 结构化任务入口（无 LLM 路径，第 03 章 §十；G5 调试入口）
      if (route === 'POST /api/tasks') {
        const raw = await readBody(req)
        let body
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, ERROR_CODES.BAD_JSON, '请求体不是合法 JSON')
          return
        }
        const invalid = validateTaskBody(body)
        if (invalid) {
          sendJson(res, 400, invalid.code, invalid.message)
          return
        }

        // 每任务独立证据链与运行栈；传输/身份池/适配器共享
        taskSeq += 1
        const taskId = `T-${Date.now()}-${taskSeq}`
        const { chain, runner } = newTaskStack(taskId)
        taskStore.register({
          taskId,
          chain,
          runner,
          run: runTaskSafely({
            taskId,
            chain,
            promiseFactory: () =>
              runner.executeTask({
                intentId: body.intentId,
                resources: body.resources,
                slot: { start: parseUtcInstant(body.slot.start), end: parseUtcInstant(body.slot.end) },
                reason: body.reason,
                identity: { id: body.identity },
              }),
            onSuccess: (result) => taskStore.complete(taskId, result),
          }),
        })
        // 结果由事件流的终态事件给出（§六：最终结果也由同一条流给出）；另提供 GET 快照兜底
        sendJson(res, 200, ERROR_CODES.OK, 'accepted', { taskId, eventsPath: `/api/tasks/${taskId}/events` })
        return
      }

      // 自然语言入口（阶段 5 开放）：理解层产出结构化意图后汇入同一资源队列（第 03 章 §十）
      if (route === 'POST /api/chat') {
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
        if (typeof body.identity !== 'string' || !body.identity) {
          sendJson(res, 400, ERROR_CODES.BAD_IDENTITY, '缺少 identity（业务身份标识）')
          return
        }
        taskSeq += 1
        const taskId = `T-${Date.now()}-${taskSeq}`
        const { chain, runner } = newTaskStack(taskId)
        const task = taskStore.register({
          taskId,
          chain,
          runner,
          stack: null, // 挂起时由下方回填运行栈
          run: runTaskSafely({
            taskId,
            chain,
            promiseFactory: () => runner.executeChatTask({ text: body.text, identity: { id: body.identity } }),
            onSuccess: (outcome) => {
              if (outcome.suspended) {
                task.stack = outcome.stack
                taskStore.suspend(taskId, outcome.clarify)
              } else {
                taskStore.complete(taskId, outcome.result)
              }
            },
          }),
        })
        void task
        sendJson(res, 200, ERROR_CODES.OK, 'accepted', { taskId, eventsPath: `/api/tasks/${taskId}/events` })
        return
      }

      // 挂起任务的追问回复（B8：AWAIT_CLARIFY 在写请求发出前，取消/回复均生效）
      const replyMatch = /^\/api\/tasks\/([^/]+)\/reply$/.exec(url.pathname)
      if (req.method === 'POST' && replyMatch) {
        const task = taskStore.get(decodeURIComponent(replyMatch[1]))
        if (!task) {
          sendJson(res, 404, ERROR_CODES.TASK_NOT_FOUND, '任务不存在')
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
        const task = taskStore.get(decodeURIComponent(cancelMatch[1]))
        if (!task) {
          sendJson(res, 404, ERROR_CODES.TASK_NOT_FOUND, '任务不存在')
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
        const task = taskStore.get(decodeURIComponent(snapshotMatch[1]))
        if (!task) {
          sendJson(res, 404, ERROR_CODES.TASK_NOT_FOUND, '任务不存在（或进程重启后丢失：任务态不跨会话，A6）')
          return
        }
        sendJson(res, 200, ERROR_CODES.OK, 'ok', {
          taskId: task.taskId,
          status: task.status,
          result: task.result,
          clarify: task.status === 'suspended' ? task.clarify : undefined,
          createdAt: task.createdAt,
        })
        return
      }

      // 证据链导出（§6.3 规格 4：evidenceRef 必须可解析——解析不到按缺陷上报）
      const evidenceMatch = /^\/api\/tasks\/([^/]+)\/evidence$/.exec(url.pathname)
      if (req.method === 'GET' && evidenceMatch) {
        const task = taskStore.get(decodeURIComponent(evidenceMatch[1]))
        if (!task) {
          sendJson(res, 404, ERROR_CODES.TASK_NOT_FOUND, '任务不存在')
          return
        }
        sendJson(res, 200, ERROR_CODES.OK, 'ok', { taskId: task.taskId, entries: task.entries() })
        return
      }

      // 事件流（SSE）：重放 + 实时；断线续传按 Last-Event-ID / ?lastSeq（§6.3 规格 3）
      const eventsMatch = /^\/api\/tasks\/([^/]+)\/events$/.exec(url.pathname)
      if (req.method === 'GET' && eventsMatch) {
        const taskId = decodeURIComponent(eventsMatch[1])
        const task = taskStore.get(taskId)
        if (!task) {
          sendJson(res, 404, ERROR_CODES.TASK_NOT_FOUND, '任务不存在')
          return
        }
        const lastSeq =
          Number.parseInt(req.headers['last-event-id'] ?? url.searchParams.get('lastSeq') ?? '0', 10) || 0
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        })
        // P1：快照点分界——先订阅，再取快照，再重放；
        // 订阅只推送 seq > snapshotSeq 的新事件，重放只写 seq <= snapshotSeq 的历史条目；
        // 先订阅保证快照之后产生的事件不丢失，快照分界保证不重复。
        let streamEnded = false
        let snapshotSeq = 0
        const writeEvent = (event) => {
          if (streamEnded || res.writableEnded) return
          if (event.seq <= lastSeq) return
          res.write(sseFrame(event))
          if (event.type === 'terminal') {
            streamEnded = true
            res.end()
          }
        }
        // 先订阅（只推送快照之后的新事件）
        const unsubscribe = taskStore.stream.subscribe(taskId, (event) => {
          if (event.seq > snapshotSeq) writeEvent(event)
        })
        req.on('close', () => {
          streamEnded = true
          unsubscribe()
        })
        // 再取快照（此时起新事件由订阅捕获）
        const entriesSnapshot = task.entries()
        snapshotSeq = entriesSnapshot.length > 0 ? entriesSnapshot[entriesSnapshot.length - 1].seq : 0
        // 再重放快照点及之前的历史条目
        for (const entry of entriesSnapshot) {
          if (streamEnded) break
          const event = mapEntryToEvent(entry)
          writeEvent(event)
        }
        // 终态任务：重放完毕后关闭（终态事件已在重放中写入）
        if (task.status === 'terminal' && !streamEnded && !res.writableEnded) {
          streamEnded = true
          unsubscribe()
          res.end()
        }
        return // SSE 处理完毕，不再继续路由匹配
      }

      sendJson(res, 404, ERROR_CODES.ROUTE_NOT_FOUND, '未知路由')
    } catch (err) {
      // P1：请求体超限返回 413
      if (err.code === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, ERROR_CODES.BAD_JSON, err.message)
        return
      }
      // 接入层不吞错误也不做业务判断：统一 5000 上报（无凭证）
      sendJson(res, 500, ERROR_CODES.INTERNAL, `内部错误：${err.message}`)
    }
  })

  function runnerFor(task) {
    return task.runner
  }

  return { server, taskStore }
}
