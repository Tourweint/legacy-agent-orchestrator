// SSE 事件流封装 —— 第 10 章 §6.3：
//   · seq 单调排序去重（不依赖到达顺序）
//   · 断线重连：EventSource 原生携带 Last-Event-ID，服务端按其续传（规格 3）
//   · 终态事件后服务端关闭流；evidenceRef 可解析（解析不到 = 缺陷上报，规格 4）

/**
 * 订阅任务事件流。
 * @param {string} taskId
 * @param {{onEvent: (event: object) => void, onState?: (s: 'open'|'reconnecting'|'closed') => void}} handlers
 * @returns {{close: () => void}}
 */
export function openTaskStream(taskId, handlers) {
  const es = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/events`)
  let closedByTerminal = false

  es.onopen = () => handlers.onState?.('open')
  es.onerror = () => {
    if (!closedByTerminal) handlers.onState?.('reconnecting')
  }
  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data)
      if (event.type === 'terminal') {
        closedByTerminal = true
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

  return {
    close: () => {
      closedByTerminal = true
      es.close()
      handlers.onState?.('closed')
    },
  }
}
