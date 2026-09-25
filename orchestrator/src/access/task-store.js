// 任务注册表（内存态）—— A6：挂起/任务状态不做跨会话持久化，随进程生命周期。
// 保存每任务的事件流订阅器、证据链与（完成后的）最终结果快照，供 SSE 重放与结果查询。

import { EventStream, mapEntryToEvent } from './event-stream.js'

export class TaskStore {
  constructor() {
    this.stream = new EventStream()
    this.tasks = new Map() // taskId → { taskId, status: 'running'|'terminal', result, entries(), createdAt }
  }

  register({ taskId, chain, run }) {
    const task = {
      taskId,
      status: 'running',
      result: null,
      run, // 运行 Promise（调用方可 await；服务器不 await——结果走事件流）
      createdAt: new Date().toISOString(),
      entries: () => chain.getEntries(),
    }
    this.tasks.set(taskId, task)
    // 同源推送：证据链每落一条，立即映射为事件发布给订阅者
    chain.onAppend((entry) => {
      this.stream.publish(mapEntryToEvent(entry))
    })
    return task
  }

  /** 运行结束后由服务器回填终态快照；终态事件本身由证据链的 task-terminal 条目映射而来。 */
  complete(taskId, result) {
    const task = this.tasks.get(taskId)
    if (!task) return null
    task.status = 'terminal'
    task.result = result
    return task
  }

  get(taskId) {
    return this.tasks.get(taskId) ?? null
  }
}
