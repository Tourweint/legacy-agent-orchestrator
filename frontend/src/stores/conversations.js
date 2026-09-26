// 会话列表与本地留存（localStorage）—— 界面方案 §二 / §五。
//
// 分工：**当前会话的轮次活在 task store 里**（响应式，SSE 驱动）；本 store 只管
// "有哪些会话、每段会话的快照"，并落到 localStorage——于是刷新页面还能接着看、左栏能切换。
//
// 留存边界（有意为之的取舍，写在这里免得日后当 bug）：
//   · 存：每轮的**用户原话、事件（对话与结论都由此派生）、结果**——不存这些，切过去的会话就是空的
//   · 不存：**证据链明细**（entriesBySeq）。它体积最大且可重拉；拉不到时界面如实说"留痕已不在"
//   · 有上限：会话数 30 / 每会话 20 轮 / 每轮 150 条事件，超出丢最老的（防 localStorage 撑爆）
//   · 按**登录用户名**隔离：同一浏览器换了人登录，不该看到上一个人的对话
//   · 引擎侧另有一套"会话记忆"（按 conversationId 攒结构化摘要）——两者不同层，别混淆

import { defineStore } from 'pinia'

const STORAGE_KEY = 'orch.conversations.v1'
const MAX_CONVERSATIONS = 30
const MAX_TURNS = 20
const MAX_EVENTS_PER_TURN = 150
const WRITE_DEBOUNCE_MS = 400

/** 轮次 → 可存储快照（裁掉证据明细与流状态）。 */
export function trimTurn(turn) {
  return {
    id: turn.id,
    userMessages: [...(turn.userMessages ?? [])],
    taskId: turn.taskId ?? null,
    status: turn.status ?? 'terminal',
    cancelled: turn.cancelled === true,
    result: turn.result ?? null,
    events: (turn.events ?? []).slice(-MAX_EVENTS_PER_TURN),
  }
}

/** 会话 → 可存储快照（写入 localStorage 的就是它）。 */
export function trimConversation({ id, title, turns, owner, updatedAt }) {
  const firstLine = (turns?.[0]?.userMessages?.[0] ?? '').replace(/\s+/g, ' ').trim()
  return {
    id,
    owner: owner ?? null,
    title: (title || firstLine || '新对话').slice(0, 40),
    turns: (turns ?? []).slice(-MAX_TURNS).map(trimTurn),
    updatedAt: updatedAt ?? Date.now(),
  }
}

function readItems() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.items) ? parsed.items : []
  } catch {
    return [] // 存储损坏或不可用（隐私模式）：当作空列表，不阻塞界面
  }
}

function writeItems(items) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ items }))
  } catch {
    // 配额满：静默降级为"本次不持久化"，界面照常可用
  }
}

let writeTimer = null

export const useConversationsStore = defineStore('conversations', {
  state: () => ({
    items: [],
    activeId: null,
  }),

  getters: {
    sorted: (s) => [...s.items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
  },

  actions: {
    /** 装载当前用户的会话（切换登录用户时重新调用）。 */
    load(owner = null) {
      this.items = readItems().filter((c) => (owner ? c.owner === owner : true))
      this.activeId = null
    },

    upsert(snapshot) {
      const item = trimConversation(snapshot)
      if (!item.id) return
      const idx = this.items.findIndex((c) => c.id === item.id)
      if (idx >= 0) this.items.splice(idx, 1, item)
      else this.items.unshift(item)
      if (this.items.length > MAX_CONVERSATIONS) this.items.length = MAX_CONVERSATIONS
      this.activeId = item.id
      this._scheduleWrite()
    },

    remove(id) {
      this.items = this.items.filter((c) => c.id !== id)
      if (this.activeId === id) this.activeId = null
      this._scheduleWrite()
    },

    clearAll() {
      this.items = []
      this.activeId = null
      writeItems([])
    },

    /** 落盘节流：一轮任务会持续吐事件，不能每条都写 localStorage。 */
    _scheduleWrite() {
      if (writeTimer) return
      writeTimer = setTimeout(() => {
        writeTimer = null
        writeItems(this.items)
      }, WRITE_DEBOUNCE_MS)
    },
  },
})
