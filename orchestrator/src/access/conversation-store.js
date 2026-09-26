// 会话记忆（内存态）—— 让"上一句说的"能被下一句用上。
//
// 为什么要有它：一个 chat 任务只承载**一轮**（一次理解 + 一次办理），任务落终态后
// 运行栈随之销毁——于是新起一轮时理解层看不到任何上文，用户说"那改成下午"就是孤句。
// 本模块把每一轮的**结构化摘要**（原话 + 意图 + 槽位 + 结果）按 conversationId 攒起来，
// 下一轮把它作为理解层的历史注入，从而"记得住刚才说的是哪间教室、哪个时段"。
//
// 纪律：
//   · 内存态、不跨进程持久化（A6 不变）；仅**同一登录用户**内可见（不跨用户泄露）
//   · 只存结构化摘要，不存模型原始输出、不存原始响应、不存任何凭证
//   · 有上限：每会话轮数上限 + 注入历史条数上限（防止上下文与内存无限增长）

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000 // 空闲 2 小时回收（与引擎会话同量级）
const DEFAULT_MAX_TURNS = 20 // 每会话保留的轮次上限
const DEFAULT_HISTORY_LIMIT = 6 // 注入理解层的最近轮数

export class ConversationStore {
  constructor({
    ttlMs = DEFAULT_TTL_MS,
    maxTurns = DEFAULT_MAX_TURNS,
    historyLimit = DEFAULT_HISTORY_LIMIT,
    now = () => Date.now(),
  } = {}) {
    this.conversations = new Map() // conversationId → { conversationId, username, turns[], updatedAt }
    this.ttlMs = ttlMs
    this.maxTurns = maxTurns
    this.historyLimit = historyLimit
    this.now = now
  }

  size() {
    return this.conversations.size
  }

  /**
   * 校验前端回传的会话 id。
   * 未知 id（如引擎重启过）→ 照用，按新会话接纳；**已知但不属于该用户 → 另发新 id**
   * （绝不覆盖或读到他人在先的会话）。
   */
  resolveId(candidate, username, nextId) {
    if (typeof candidate === 'string' && candidate) {
      const existing = this.conversations.get(candidate)
      if (!existing || existing.username === username) return candidate
    }
    return nextId()
  }

  /**
   * 取（或建）会话。
   * 已存在但**不属于该用户** → 返回 null：不读、不写、更不覆盖（越权一律当作不存在）。
   * 正常路径上 resolveId 已经挡在前面，这里是二道防线。
   */
  ensure(conversationId, username) {
    const existing = this.conversations.get(conversationId)
    if (existing) {
      return existing.username === username ? existing : null
    }
    const created = { conversationId, username, turns: [], updatedAt: this.now() }
    this.conversations.set(conversationId, created)
    return created
  }

  /** 记一轮：只留结构化摘要（原话 / 意图 / 槽位 / 结果）；越权时返回 null 不落库。 */
  recordTurn(conversationId, username, turn) {
    const conv = this.ensure(conversationId, username)
    if (!conv) return null
    conv.turns.push({
      text: typeof turn?.text === 'string' ? turn.text : '',
      intent: turn?.intent ?? null,
      slots: turn?.slots ?? {},
      outcome: turn?.outcome ?? null,
      at: this.now(),
    })
    if (conv.turns.length > this.maxTurns) {
      conv.turns.splice(0, conv.turns.length - this.maxTurns)
    }
    conv.updatedAt = this.now()
    return conv
  }

  /**
   * 注入理解层的历史（最近 N 轮）。
   * 助手侧放**结构化摘要**而不是上一轮的原始文本：模型需要照看的只是"刚才说的是哪间教室、
   * 哪个时段、办成了没有"这些事实，把自然语言回复塞回去反而会让它模仿措辞。
   */
  historyFor(conversationId, username) {
    const conv = this.conversations.get(conversationId)
    if (!conv || conv.username !== username) return []
    const out = []
    for (const turn of conv.turns.slice(-this.historyLimit)) {
      out.push({ role: 'user', content: turn.text })
      out.push({
        role: 'assistant',
        content: JSON.stringify({ intent: turn.intent, slots: turn.slots, outcome: turn.outcome }),
      })
    }
    return out
  }

  /** 清理空闲超时的会话，返回清理条数。 */
  cleanup() {
    const now = this.now()
    let removed = 0
    for (const [id, conv] of this.conversations) {
      if (now - conv.updatedAt > this.ttlMs) {
        this.conversations.delete(id)
        removed += 1
      }
    }
    return removed
  }
}
