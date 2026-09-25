// 任务状态（Pinia）—— 第 10 章 §五：只放"当前任务"的跨组件状态：
// 轨迹事件（同源自 SSE）、证据条目、挂起追问、终态结果。
// 事件排序以 seq 为准（§6.3 规格 1）；对话视图的助手消息由事件派生，不自行推断步骤（§6.1）。

import { defineStore } from 'pinia'
import { apiCancel, apiChat, apiEvidence, apiGetTask, apiPostTask, apiReply } from '../api/client.js'
import { openTaskStream } from '../api/sse.js'
import { useSessionStore } from './session.js'

export const PHASES = [
  { key: 'P1', name: '理解', hint: '把你的话解析成意图与槽位' },
  { key: 'P2', name: '判定', hint: '收集事实，逐条核对能否办理' },
  { key: 'P3', name: '调用', hint: '以最小身份向系统发起请求' },
  { key: 'P4', name: '结果', hint: '结果不确定时进入查证收敛' },
  { key: 'P5', name: '恢复', hint: '换方案继续，或撤销已完成步骤' },
  { key: 'P6', name: '留痕', hint: '每一步的依据与结论都可复核' },
]

export const useTaskStore = defineStore('task', {
  state: () => ({
    taskId: null,
    // running | suspended | terminal
    taskStatus: 'idle',
    sseState: 'closed',
    events: [],
    entriesBySeq: {},
    result: null,
    clarify: null,
    // 对话视图的本地消息：用户输入（助手侧消息由事件派生）
    userMessages: [],
    error: null,
    _stream: null,
  }),

  getters: {
    terminalEvent: (s) => s.events.find((e) => e.type === 'terminal') ?? null,
    // 取消按钮矩阵（§4.5/B8）：出现 P3+ 事件即写请求已发出 → 禁用；挂起态可取消
    writeIssued: (s) => s.events.some((e) => (e.phase ?? 'P6') >= 'P3' && ['P3', 'P4', 'P5'].includes(e.phase)),
    canCancel: (s) =>
      s.taskStatus === 'suspended' || (s.taskStatus === 'running' && !s.events.some((e) => ['P3', 'P4', 'P5'].includes(e.phase ?? 'P6'))),
    eventsByPhase: (s) => {
      const grouped = {}
      for (const p of PHASES) grouped[p.key] = []
      for (const e of s.events) {
        const phase = e.phase ?? 'P6'
        if (grouped[phase]) grouped[phase].push(e)
      }
      return grouped
    },
  },

  actions: {
    _reset() {
      this.taskId = null
      this.taskStatus = 'idle'
      this.events = []
      this.entriesBySeq = {}
      this.result = null
      this.clarify = null
      this.userMessages = []
      this.error = null
      this._stream?.close()
      this._stream = null
    },

    _applyEvent(event) {
      // seq 去重（§6.3 规格 1）
      if (this.events.some((e) => e.seq === event.seq)) return
      this.events.push(event)
      this.events.sort((a, b) => a.seq - b.seq)
    },

    async _openStream(taskId) {
      this._stream?.close()
      this._stream = openTaskStream(taskId, {
        onEvent: (event) => {
          this._applyEvent(event)
          if (event.type === 'terminal') this._loadFinal(taskId)
        },
        onState: (s) => {
          this.sseState = s
        },
      })
    },

    async _loadFinal(taskId) {
      // 终态后拉快照与证据链（evidenceRef 解析来源，§6.3 规格 4）
      const snapshot = await apiGetTask(taskId)
      if (snapshot.code === 0) {
        this.result = snapshot.data.result
        this.taskStatus = 'terminal'
      }
      await this.ensureEvidence(taskId)
    },

    /** 证据条目按 seq 入库（TrajectoryItem 展开原始证据时调用；§6.3 规格 4）。 */
    async ensureEvidence(taskId) {
      const evidence = await apiEvidence(taskId)
      if (evidence.code === 0) {
        for (const entry of evidence.data.entries) {
          this.entriesBySeq[entry.seq] = entry
        }
      }
    },

    /**
     * 会话失效的统一出口（N5）：401 = 未登录或登录已失效。
     * 不假装还登录着、不静默重试——退回登录页并说明"登录已过期，请重新登录"。
     */
    _handleAuthError(res) {
      if (res.httpStatus !== 401) return false
      useSessionStore().markExpired('登录已过期，请重新登录。')
      return true
    },

    async startChat(text) {
      this._reset()
      this.userMessages.push({ role: 'user', text })
      // 身份由会话派生（不再传 identity）——写操作只认登录者本人
      const res = await apiChat(text)
      if (res.code !== 0) {
        if (this._handleAuthError(res)) return
        this.error = res.message
        return
      }
      this.taskId = res.data.taskId
      this.taskStatus = 'running'
      await this._openStream(this.taskId)
      this._refreshWhileRunning()
    },

    async startStructured(task) {
      this._reset()
      this.userMessages.push({ role: 'user', text: '[调试] 结构化任务' })
      const res = await apiPostTask(task)
      if (res.code !== 0) {
        if (this._handleAuthError(res)) return
        this.error = res.message
        return
      }
      this.taskId = res.data.taskId
      this.taskStatus = 'running'
      await this._openStream(this.taskId)
      this._refreshWhileRunning()
    },

    async reply(text) {
      if (!this.taskId) return
      this.userMessages.push({ role: 'user', text })
      this.clarify = null
      this.taskStatus = 'running'
      const res = await apiReply(this.taskId, text)
      if (this._handleAuthError(res)) return
      this._refreshWhileRunning()
    },

    async cancel() {
      if (!this.taskId) return
      const res = await apiCancel(this.taskId)
      if (res.code === 0) {
        this.taskStatus = 'terminal'
        this.result = res.data
        this.clarify = null
        await this._loadFinal(this.taskId)
      } else if (!this._handleAuthError(res)) {
        this.error = res.message
      }
    },

    // 挂起/运行态的快照轮询兜底（SSE 为主通道；此轮询只同步状态与 clarify）
    _refreshWhileRunning() {
      const tick = async () => {
        if (!this.taskId || this.taskStatus === 'terminal') return
        const snap = await apiGetTask(this.taskId)
        if (snap.code === 0) {
          const d = snap.data
          if (d.status === 'suspended' && this.taskStatus !== 'suspended') {
            this.taskStatus = 'suspended'
            this.clarify = d.clarify
          } else if (d.status === 'terminal' && this.taskStatus !== 'terminal') {
            // 终态事件未到达时的兜底（正常由 SSE 终态事件驱动）
            this.taskStatus = 'terminal'
            this.result = d.result
          }
        }
        if (this.taskStatus !== 'terminal') {
          setTimeout(tick, 1200)
        }
      }
      setTimeout(tick, 600)
    },
  },
})
