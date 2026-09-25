// 编排层本地错误。非法转移不是本错误的职责——它由调度器留痕后转为任务 UNRESOLVED
// （第 04 章 §5.6：非法转移意味着"我们不知道系统处于什么状态"）。

export class OrchestrationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OrchestrationError'
  }
}

export class IllegalTransitionError extends OrchestrationError {
  constructor({ from, event, purpose, payload }) {
    super(`非法转移：${from} --${event}${purpose ? `（目的=${purpose}）` : ''}${payload ? `（载荷=${payload}）` : ''} 未在转移表中登记`)
    this.from = from
    this.event = event
    this.purpose = purpose
    this.payload = payload
  }
}
