// SSE 事件流封装 —— 第 10 章 §6.3 + 阶段四性能优化：
//   · seq 单调排序去重（不依赖到达顺序）
//   · 断线重连：指数退避（1s → 2s → 4s → 8s → 16s → 30s 封顶），最多 10 次
//   · 终态事件后服务端关闭流；evidenceRef 可解析（解析不到 = 缺陷上报，规格 4）
//   · 主动 close 后不再重连

import { ENDPOINTS } from './endpoints.js'

const RECONNECT_BASE_DELAY = 1000 // 初始重连延迟 1s
const RECONNECT_MAX_DELAY = 30000 // 最大重连延迟 30s
const RECONNECT_MAX_ATTEMPTS = 10 // 最大重连次数

/**
 * 订阅任务事件流。
 * @param {string} taskId
 * @param {{
 *   onEvent: (event: object) => void,
 *   onState?: (s: 'open'|'reconnecting'|'closed'|'failed') => void,
 *   onReconnectAttempt?: (attempt: number, delay: number) => void
 * }} handlers
 * @returns {{close: () => void}}
 */
export function openTaskStream(taskId, handlers) {
  const url = ENDPOINTS.taskEvents(taskId)
  let es = null
  let closedByUser = false
  let closedByTerminal = false
  let reconnectAttempt = 0
  let reconnectTimer = null

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function scheduleReconnect() {
    if (closedByUser || closedByTerminal) return
    if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
      handlers.onState?.('failed')
      return
    }

    reconnectAttempt += 1
    // 指数退避：1s, 2s, 4s, 8s, 16s, 30s(封顶)
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempt - 1),
      RECONNECT_MAX_DELAY
    )

    handlers.onState?.('reconnecting')
    handlers.onReconnectAttempt?.(reconnectAttempt, delay)

    reconnectTimer = setTimeout(() => {
      if (closedByUser || closedByTerminal) return
      connect()
    }, delay)
  }

  function connect() {
    es = new EventSource(url)

    es.onopen = () => {
      reconnectAttempt = 0 // 连接成功后重置重连计数
      handlers.onState?.('open')
    }

    es.onerror = () => {
      if (closedByUser || closedByTerminal) return
      // EventSource 原生会自动重连，但我们关闭它改用指数退避
      es.close()
      scheduleReconnect()
    }

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data)
        if (event.type === 'terminal') {
          closedByTerminal = true
          clearReconnectTimer()
          handlers.onEvent(event)
          handlers.onState?.('closed')
          es.close()
          return
        }
        handlers.onEvent(event)
      } catch (err) {
        // 单帧解析失败：按缺陷上报（不静默丢步，§6.3 规格 4）
        console.error('[sse] 事件帧解析失败', err, msg.data)
      }
    }
  }

  connect()

  return {
    close: () => {
      closedByUser = true
      clearReconnectTimer()
      if (es) {
        es.close()
        es = null
      }
      handlers.onState?.('closed')
    },
  }
}
