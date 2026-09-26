// 任务状态（Pinia）—— 第 10 章 §五 + 会话化改造。
//
// 状态分两层：
//   · **会话**：conversationId + 多轮 turns（一段对话里说的每一句都在这里）
//   · **当前轮**：一次任务自己的事件流 / 证据 / 结果 / 挂起追问
//
// 为什么要分层：一个任务只承载**一轮**（办完即终态），而用户要的是"同一段对话里接着
// 说下一句，并且它记得住上一句"。轮次留在前端（可回看、可继续），**记忆交给引擎**
// （orchestrator 的 conversation-store 按 conversationId 攒结构化摘要）。
//
// 组件只依赖"当前轮"的字段（taskId / taskStatus / events / result…），这些以 getter
// 代理到 activeTurn——于是会话化对轨迹面板、结果卡是透明的。
// 事件排序以 seq 为准（§6.3 规格 1）；助手侧消息由事件派生，不自行推断步骤（§6.1）。

import { defineStore } from 'pinia'
import {
  apiCancel,
  apiChat,
  apiEvidence,
  apiGetTask,
  apiPostTask,
  apiReply,
} from '../api/client.js'
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

function makeTurn(userText, index) {
  return {
    id: `turn-${Date.now()}-${index + 1}`,
    // 这一轮里用户说过的所有话（首句 + 追问的回复）——都显示在对话流里
    userMessages: [userText],
    taskId: null,
    // running | suspended | terminal
    status: 'running',
    events: [],
    entriesBySeq: {},
    result: null,
    clarify: null,
    sseState: 'closed',
    reconnectAttempt: 0,
    reconnectDelay: 0,
  }
}

export const useTaskStore = defineStore('task', {
  state: () => ({
    conversationId: null,
    turns: [],
    activeTurnId: null,
    error: null,
    _stream: null,
  }),

  getters: {
    activeTurn: (s) => s.turns.find((t) => t.id === s.activeTurnId) ?? null,
    hasAnyTurn: (s) => s.turns.length > 0,

    // ---- 以下字段代理"当前轮"，让轨迹/结果组件不必知道会话结构 ----
    taskId: (s) => s.activeTurn?.taskId ?? null,
    taskStatus: (s) => s.activeTurn?.status ?? 'idle',
    sseState: (s) => s.activeTurn?.sseState ?? 'closed',
    reconnectAttempt: (s) => s.activeTurn?.reconnectAttempt ?? 0,
    reconnectDelay: (s) => s.activeTurn?.reconnectDelay ?? 0,
    events: (s) => s.activeTurn?.events ?? [],
    entriesBySeq: (s) => s.activeTurn?.entriesBySeq ?? {},
    result: (s) => s.activeTurn?.result ?? null,
    clarify: (s) => s.activeTurn?.clarify ?? null,

    terminalEvent: (s) => (s.activeTurn?.events ?? []).find((e) => e.type === 'terminal') ?? null,
    // 取消按钮矩阵（§4.5/B8）：出现 P3+ 事件即写请求已发出 → 禁用；挂起态可取消
    writeIssued: (s) =>
      (s.activeTurn?.events ?? []).some(
        (e) => (e.phase ?? 'P6') >= 'P3' && ['P3', 'P4', 'P5'].includes(e.phase),
      ),
    canCancel: (s) =>
      s.activeTurn?.status === 'suspended' ||
      (s.activeTurn?.status === 'running' &&
        !(s.activeTurn?.events ?? []).some((e) => ['P3', 'P4', 'P5'].includes(e.phase ?? 'P6'))),
    eventsByPhase: (s) => {
      const grouped = {}
      for (const p of PHASES) grouped[p.key] = []
      for (const e of s.activeTurn?.events ?? []) {
        const phase = e.phase ?? 'P6'
        if (grouped[phase]) grouped[phase].push(e)
      }
      return grouped
    },
  },

  actions: {
    /** 开一段新会话：轮次与记忆都从头开始（"再办一件"的语义）。 */
    newConversation() {
      this._stream?.close()
      this._stream = null
      this.turns = []
      this.activeTurnId = null
      this.conversationId = null
      this.error = null
    },

    // 兼容旧调用点（结果卡 / 对话面板的"再办一件"）
    _reset() {
      this.newConversation()
    },

    _newTurn(userText) {
      const turn = makeTurn(userText, this.turns.length)
      this.turns.push(turn)
      this.activeTurnId = turn.id
      return turn
    },

    _applyEvent(turn, event) {
      // seq 去重（§6.3 规格 1）
      if (turn.events.some((e) => e.seq === event.seq)) return
      turn.events.push(event)
      turn.events.sort((a, b) => a.seq - b.seq)
    },

    async _openStream(turn) {
      this._stream?.close()
      turn.sseState = 'connecting'
      this._stream = openTaskStream(turn.taskId, {
        onEvent: (event) => {
          this._applyEvent(turn, event)
          if (event.type === 'terminal') this._loadFinal(turn)
        },
        onState: (s) => {
          turn.sseState = s
          if (s === 'open') {
            turn.reconnectAttempt = 0
            turn.reconnectDelay = 0
          }
        },
        onReconnectAttempt: (attempt, delay) => {
          turn.reconnectAttempt = attempt
          turn.reconnectDelay = delay
        },
      })
    },

    async _loadFinal(turn) {
      // 终态后拉快照与证据链（evidenceRef 解析来源，§6.3 规格 4）
      const snapshot = await apiGetTask(turn.taskId)
      if (snapshot.code === 0) {
        turn.result = snapshot.data.result
        turn.status = 'terminal'
      }
      await this.ensureEvidence(turn.taskId)
    },

    /** 证据条目按 seq 入库（TrajectoryItem 展开原始证据时调用；§6.3 规格 4）。 */
    async ensureEvidence(taskId) {
      const evidence = await apiEvidence(taskId)
      if (evidence.code !== 0) return
      const turn = this.turns.find((t) => t.taskId === taskId) ?? this.activeTurn
      if (!turn) return
      for (const entry of evidence.data.entries) {
        turn.entriesBySeq[entry.seq] = entry
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

    /**
     * 说一句话。
     * 会话内继续（不清空、不停用输入框）：带上 conversationId —— 引擎据此把前几轮的
     * 结构化摘要交给理解层，所以"那改成后天下午"接得上上一句的"数智楼123"。
     */
    async startChat(text) {
      this.error = null
      const turn = this._newTurn(text)
      const res = await apiChat(text, this.conversationId)
      if (res.code !== 0) {
        if (this._handleAuthError(res)) return
        this.error = res.message
        turn.status = 'terminal'
        return
      }
      if (res.data?.conversationId) this.conversationId = res.data.conversationId
      turn.taskId = res.data.taskId
      await this._openStream(turn)
      this._refreshWhileRunning(turn)
    },

    async startStructured(task) {
      this.error = null
      const turn = this._newTurn('[调试] 结构化任务')
      const res = await apiPostTask(task)
      if (res.code !== 0) {
        if (this._handleAuthError(res)) return
        this.error = res.message
        turn.status = 'terminal'
        return
      }
      turn.taskId = res.data.taskId
      await this._openStream(turn)
      this._refreshWhileRunning(turn)
    },

    /** 追问回复：仍属**同一轮**（同一个任务），所以不新开轮次，只追加这句话。 */
    async reply(text) {
      const turn = this.activeTurn
      if (!turn?.taskId) return
      turn.userMessages.push(text)
      turn.clarify = null
      turn.status = 'running'
      const res = await apiReply(turn.taskId, text)
      if (this._handleAuthError(res)) return
      this._refreshWhileRunning(turn)
    },

    async cancel() {
      const turn = this.activeTurn
      if (!turn?.taskId) return
      const res = await apiCancel(turn.taskId)
      if (res.code === 0) {
        turn.status = 'terminal'
        turn.result = res.data
        turn.clarify = null
        await this._loadFinal(turn)
      } else if (!this._handleAuthError(res)) {
        this.error = res.message
      }
    },

    // 挂起/运行态的快照轮询兜底（SSE 为主通道；此轮询只同步状态与 clarify）
    _refreshWhileRunning(turn) {
      const tick = async () => {
        if (!turn.taskId || turn.status === 'terminal') return
        const snap = await apiGetTask(turn.taskId)
        if (snap.code === 0) {
          const d = snap.data
          if (d.status === 'suspended' && turn.status !== 'suspended') {
            turn.status = 'suspended'
            turn.clarify = d.clarify
          } else if (d.status === 'terminal' && turn.status !== 'terminal') {
            // 终态事件未到达时的兜底（正常由 SSE 终态事件驱动）
            turn.status = 'terminal'
            turn.result = d.result
          }
        }
        if (turn.status !== 'terminal') {
          setTimeout(tick, 1200)
        }
      }
      setTimeout(tick, 600)
    },
  },
})
