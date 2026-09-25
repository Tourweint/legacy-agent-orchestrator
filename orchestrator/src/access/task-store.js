// 任务注册表（内存态）—— A6：挂起/任务状态不做跨会话持久化，随进程生命周期。
// 保存每任务的事件流订阅器、证据链与（完成后的）最终结果快照，供 SSE 重放与结果查询。

import { EventStream, mapEntryToEvent } from './event-stream.js'

export class TaskStore {
  constructor() {
    this.stream = new EventStream()
    this.tasks = new Map() // taskId → { taskId, status, result, owner, entries(), createdAt }
  }

  /**
   * @param {object} p
   * @param {string} p.taskId
   * @param {string} [p.owner] 发起人（登录用户名；登录方案影响面 #12）——
   *        用于"只能取消/查看自己的任务"；任务仍不跨会话（A6 不变）
   */
  register({ taskId, owner = null, chain, run, stack, runner }) {
    const task = {
      taskId,
      owner,
      status: 'running',
      result: null,
      runner, // 恢复/取消操作经它进入编排层
      stack: stack ?? null, // 聊天任务挂起/恢复所需的运行栈（机器 + 上下文 + 驱动器）
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
    task.stack = null // 终态后不再需要运行栈
    return task
  }

  /** 聊天任务挂起（AWAIT_CLARIFY）：保留运行栈等回复（A6：会话内有效）。 */
  suspend(taskId, clarify) {
    const task = this.tasks.get(taskId)
    if (!task) return null
    task.status = 'suspended'
    task.clarify = clarify
    return task
  }

  get(taskId) {
    return this.tasks.get(taskId) ?? null
  }
}
