// SSE 事件流封装 —— 第 10 章 §6.3：
//   · seq 单调排序去重（不依赖到达顺序）
//   · 断线重连：EventSource 原生携带 Last-Event-ID，服务端按其续传（规格 3）
//   · 终态事件后服务端关闭流；evidenceRef 可解析（解析不到 = 缺陷上报，规格 4）

// 事件 type 闭集（docs/基线文档/对外接口清单.md §四）；引擎对每一帧都带 `event: <type>`。
const EVENT_TYPES = [
  'phase-start',
  'phase-end',
  'fact-collected',
  'proposition-judged',
  'call',
  'decision',
  'uncertain',
  'input-required',
  'cancel-result',
  'audit',
  'terminal',
  'pending-item',
]

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

  const handleFrame = (msg) => {
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

  // ★ 引擎按类型命名发送（`event: <type>`），而 onmessage 只接收**没有** event 字段的默认帧——
  //   只用 onmessage 会一条都收不到（表现为：轨迹永远 0 步、终态事件收不到、EventSource 无限重连）。
  //   类型闭集以 docs/基线文档/对外接口清单.md §四 为准，新增 type 必须先在此登记再补进本表。
  for (const type of EVENT_TYPES) es.addEventListener(type, handleFrame)
  // 兜底：万一出现未命名帧，仍按同一处理器收下（不静默丢步）
  es.onmessage = handleFrame

  return {
    close: () => {
      closedByTerminal = true
      es.close()
      handlers.onState?.('closed')
    },
  }
}
