// 事件流 —— 第 10 章 §6（数据流：边执行边推送）+ §6.3（事件消息结构，阶段 4 必交付契约）。
//
// ★ 同源纪律（§6.1）：界面展示的内容必须与证据链同源——本模块只做"证据条目 → 事件消息"
// 的机械映射，不推断、不补全、不省略。粒度由证据链决定：界面想看而证据链没有的，补的是证据链。
//
// 事件 schema（§6.3）：{ seq, taskId, type, phase, status, evidenceRef, text, at }
// type 闭集（§6.2 + 本次登记的新增项，见 docs/基线文档/对外接口清单.md）：
//   phase-start / phase-end / fact-collected / proposition-judged / decision /
//   uncertain / input-required / cancel-result / audit / terminal / pending-item
// status 闭集：running / done / failed / uncertain / unavailable / not-applicable

const FACT_NAMES = {
  F1: '教室详情',
  F2: '座位布局',
  F3: '时段座位占用',
  F4: '跨身份预约列表',
  F5: '我的预约',
  F6: '维修窗口',
}

const STATUS_BY_FACT_OUTCOME = {
  OBTAINED: 'done',
  UNOBTAINABLE: 'unavailable',
  NOT_APPLICABLE: 'not-applicable',
}

const STATUS_BY_VERDICT = { SUCCESS: 'done', FAILURE: 'failed', UNKNOWN: 'uncertain' }

const STATUS_BY_JUDGE_OUTCOME = {
  SATISFIED: 'done',
  VIOLATED: 'failed',
  UNCONFIRMABLE: 'unavailable',
  NOT_APPLICABLE: 'not-applicable',
}

// 决策结论 → 状态（查不清=不确定；拒绝类=失败；其余按已完成）
const FAILED_DECISIONS = new Set([
  'PROPOSITIONS_FAILED',
  'PROPOSITIONS_UNCONFIRMED',
  'DEGRADE_EXHAUSTED',
  'JUDGE_FAILURE',
])
const UNCERTAIN_DECISIONS = new Set(['VERIFY_INCONCLUSIVE'])

const TERMINAL_STATUS = { DONE: 'done', REJECTED: 'failed', FAILED: 'failed', UNRESOLVED: 'uncertain' }

function decisionStatus(outcome) {
  if (FAILED_DECISIONS.has(outcome)) return 'failed'
  if (UNCERTAIN_DECISIONS.has(outcome)) return 'uncertain'
  return 'done'
}

/**
 * 证据条目 → 事件消息。一一对应：每条证据恰产出一条事件（§6.1 逐条一致）。
 */
export function mapEntryToEvent(entry, factNames = FACT_NAMES) {
  const base = {
    seq: entry.seq,
    taskId: entry.taskId,
    phase: entry.phase ?? 'P6',
    evidenceRef: `${entry.taskId}:${entry.seq}`,
    at: entry.at,
  }
  const summary = entry.conclusion?.summary ?? ''

  if (entry.action.startsWith('collect-fact:')) {
    const factId = entry.action.slice('collect-fact:'.length)
    return {
      ...base,
      type: 'fact-collected',
      status: STATUS_BY_FACT_OUTCOME[entry.conclusion?.outcome] ?? 'done',
      text: `事实 · ${factNames[factId] ?? factId}：${summary || '已获得'}`,
    }
  }
  if (entry.action.startsWith('judge:')) {
    return {
      ...base,
      type: 'proposition-judged',
      status: STATUS_BY_JUDGE_OUTCOME[entry.conclusion?.outcome] ?? 'done',
      text: summary || entry.conclusion?.outcome || '',
    }
  }
  if (entry.action.startsWith('contact:')) {
    const verdict = entry.conclusion?.outcome
    // 未知结论 → "不确定"事件（界面切到"待确认"形态，§6.2）
    if (verdict === 'UNKNOWN') {
      return { ...base, type: 'uncertain', status: 'uncertain', text: '结果待确认，正在核对……' }
    }
    return {
      ...base,
      type: 'call',
      status: STATUS_BY_VERDICT[verdict] ?? 'done',
      text: summary,
    }
  }
  if (entry.action.startsWith('ask:')) {
    // 需要用户输入（追问/换时段确认）：界面在对话视图出现交互（§6.2）
    return { ...base, type: 'input-required', status: 'running', text: summary }
  }
  if (entry.action.startsWith('decide:')) {
    const outcome = entry.conclusion?.outcome ?? ''
    return {
      ...base,
      type: 'decision',
      status: decisionStatus(outcome),
      text: summary,
    }
  }
  if (entry.action.startsWith('audit:')) {
    return {
      ...base,
      type: 'audit',
      status: entry.conclusion?.outcome === 'IGNORED' ? 'done' : 'failed',
      text: summary,
    }
  }
  if (entry.action === 'task-terminal' || entry.action === 'task-force-unresolved') {
    const outcome = entry.conclusion?.outcome ?? 'UNRESOLVED'
    return {
      ...base,
      type: 'terminal',
      status: TERMINAL_STATUS[outcome] ?? 'failed',
      text: summary,
    }
  }
  // 未识别的动作：按登记纪律补映射前先以 decision 兜底展示（不静默丢步，§6.3 规格 4）
  return { ...base, type: 'decision', status: 'done', text: summary }
}

/**
 * 每任务事件流：订阅（实时）+ 重放（断线续传，§6.3 规格 3：按最后 seq 续传）。
 */
export class EventStream {
  constructor() {
    this.subscribers = new Map() // taskId → Set<fn(event)>
  }

  subscribe(taskId, fn) {
    if (!this.subscribers.has(taskId)) this.subscribers.set(taskId, new Set())
    this.subscribers.get(taskId).add(fn)
    return () => this.subscribers.get(taskId)?.delete(fn)
  }

  publish(event) {
    for (const fn of this.subscribers.get(event.taskId) ?? []) {
      try {
        fn(event)
      } catch {
        // 单个订阅者异常不影响其他订阅者与任务执行
      }
    }
  }

  /** 从指定 seq 之后重放（Last-Event-ID 续传；lastSeq=0/缺省 → 全量重放）。 */
  replay(entries, lastSeq, fn) {
    for (const entry of entries) {
      if (entry.seq > (lastSeq ?? 0)) fn(mapEntryToEvent(entry))
    }
  }
}

/** SSE 帧格式。 */
export function sseFrame(event) {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`
}
