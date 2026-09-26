// 任务注册表（内存态）—— A6：挂起/任务状态不做跨会话持久化，随进程生命周期。
// 保存每任务的事件流订阅器、证据链与（完成后的）最终结果快照，供 SSE 重放与结果查询。
//
// P1 治理：任务数上限 + 终态/挂起 TTL + 定期清理，防止内存无限增长。

import { EventStream, mapEntryToEvent } from './event-stream.js'

const MAX_TASKS = 1000 // 进程内最大任务数（P1：内存上限）
const TERMINAL_TTL_MS = 30 * 60 * 1000 // 终态任务保留 30 分钟
const SUSPENDED_TTL_MS = 60 * 60 * 1000 // 挂起任务保留 1 小时（追问超时）
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 每 5 分钟清理一次

export class TaskStore {
  constructor({ maxTasks = MAX_TASKS, terminalTtlMs = TERMINAL_TTL_MS, suspendedTtlMs = SUSPENDED_TTL_MS } = {}) {
    this.stream = new EventStream()
<<<<<<< HEAD
    this.tasks = new Map() // taskId → { taskId, status, result, owner, entries(), createdAt }
  }

  /**
   * @param {object} p
   * @param {string} p.taskId
   * @param {string} [p.owner] 发起人（登录用户名；登录方案影响面 #12）——
   *        用于"只能取消/查看自己的任务"；任务仍不跨会话（A6 不变）
   */
  register({ taskId, owner = null, chain, run, stack, runner }) {
=======
    this.tasks = new Map() // taskId → { taskId, status, result, entries(), createdAt, completedAt, ... }
    this.maxTasks = maxTasks
    this.terminalTtlMs = terminalTtlMs
    this.suspendedTtlMs = suspendedTtlMs
    // 启动定期清理（unref 不阻止进程退出）
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS)
    if (this._cleanupTimer.unref) this._cleanupTimer.unref()
  }

  register({ taskId, chain, run, stack, runner }) {
    // 超过上限时先清理最老的终态任务
    if (this.tasks.size >= this.maxTasks) {
      this._evictOldestTerminal()
    }
>>>>>>> ee803542ba91a4ad7d47213fca4cd7dfa3eb65c2
    const task = {
      taskId,
      owner,
      status: 'running',
      result: null,
      runner, // 恢复/取消操作经它进入编排层
      stack: stack ?? null, // 聊天任务挂起/恢复所需的运行栈（机器 + 上下文 + 驱动器）
      run, // 运行 Promise（调用方可 await；服务器不 await——结果走事件流）
      createdAt: new Date().toISOString(),
      completedAt: null,
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
    task.runner = null // 释放运行时引用
    task.completedAt = new Date().toISOString()
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

  /** 定期清理过期任务（P1：TTL）。 */
  _cleanup() {
    const now = Date.now()
    let removed = 0
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'terminal' && task.completedAt) {
        if (now - new Date(task.completedAt).getTime() > this.terminalTtlMs) {
          this.tasks.delete(taskId)
          removed += 1
        }
      } else if (task.status === 'suspended') {
        if (now - new Date(task.createdAt).getTime() > this.suspendedTtlMs) {
          this.tasks.delete(taskId)
          removed += 1
        }
      }
    }
    if (removed > 0) {
      console.log(`[orchestrator] TaskStore 清理过期任务 ${removed} 个，当前 ${this.tasks.size} 个`)
    }
  }

  /** 超过上限时驱逐最老的终态任务（P1：内存上限兜底）。 */
  _evictOldestTerminal() {
    let oldestId = null
    let oldestTime = Infinity
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'terminal' && task.completedAt) {
        const t = new Date(task.completedAt).getTime()
        if (t < oldestTime) {
          oldestTime = t
          oldestId = taskId
        }
      }
    }
    if (oldestId) {
      this.tasks.delete(oldestId)
      console.log(`[orchestrator] TaskStore 上限驱逐最老终态任务 ${oldestId}`)
    }
  }

  /** 关闭清理定时器（测试/关闭时调用）。 */
  close() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
      this._cleanupTimer = null
    }
  }
}
