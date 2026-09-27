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

/**
 * 接口的业务语义短名：**取自接口注册表的 `purpose` 首段**（"——"/"（" 之前）。
 * 为什么不另维护一份 id → 名字的映射：两份映射必然漂移（前端 `display-names.js` 里
 * 曾经就有这么一份，删右栏时露出的"call 事件只有 ok"正是它存在的理由消失后的后果）。
 * 例："教室详情——把人读名解析成系统 id（实体消解），并读取 status（F1）" → "教室详情"
 */
export function shortPurpose(purpose) {
  if (typeof purpose !== 'string' || !purpose.trim()) return ''
  return purpose.split(/——|—|\(|（/)[0].trim()
}

/** 从接口注册表派生 id → 业务语义短名（注册表是唯一真相源）。 */
export function buildInterfaceNames(registry) {
  const out = {}
  for (const item of registry?.interfaces ?? []) {
    const label = shortPurpose(item?.purpose)
    if (item?.id && label) out[item.id] = label
  }
  return out
}

/**
 * 写接口 id 集合（sideEffect=true，接口注册表是唯一真相源）。
 * 前端"写请求已发出"的判据（canCancel / 改口窗口）：只读查证调用不算"已开始办理"，
 * 只有真正有副作用的写请求（提交/撤销/占座）才锁住改口。
 */
export function buildWriteInterfaceIds(registry) {
  const out = new Set()
  for (const item of registry?.interfaces ?? []) {
    if (item?.id && item.sideEffect === true) out.add(item.id)
  }
  return out
}

/**
 * 从术语对照表派生 命题 id → 人话名。
 * 引擎配置（config/glossary.yaml）是唯一真相源——界面侧的 `GET /api/meta/glossary` 与
 * 事件文案用的是同一份，因此不会出现"界面说'这个时段是空的'、事件里写 P-SLOT-FREE"。
 */
export function buildPropositionNames(glossary) {
  const out = {}
  for (const [id, name] of Object.entries(glossary?.propositions ?? {})) {
    if (id && typeof name === 'string') out[id] = name
  }
  return out
}

// 判定结论的人话（枚举值直接给用户看等于没说）
const PROPOSITION_OUTCOME_TEXT = {
  SATISFIED: '成立',
  VIOLATED: '不成立',
  UNCONFIRMABLE: '无法确认',
  NOT_APPLICABLE: '不适用',
}

/** 调用结果的附加说明：引擎成功时常见返回就是 "ok"，那就没必要念出来。 */
function callDetailText(summary) {
  const text = typeof summary === 'string' ? summary.trim() : ''
  if (!text || /^(ok|success|已完成)$/i.test(text)) return ''
  return ` · ${text}`
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
 * @param {object} entry 证据条目
 * @param {object} [names]
 * @param {object} [names.factNames]        事实编号 → 人话名（默认内置表）
 * @param {object} [names.interfaceNames]   接口 id → 业务语义短名（buildInterfaceNames 从注册表派生）
 * @param {object} [names.writeInterfaceIds] 写接口 id 集合（buildWriteInterfaceIds 从注册表派生）
 * @param {object} [names.propositionNames] 命题 id → 人话名（buildPropositionNames 从术语对照表派生）
 */
export function mapEntryToEvent(
  entry,
  { factNames = FACT_NAMES, interfaceNames = {}, writeInterfaceIds = new Set(), propositionNames = {} } = {},
) {
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
    const outcome = entry.conclusion?.outcome
    // 命题人话名来自术语对照表：事件文案与界面（GET /api/meta/glossary）同源，不会各说各话
    const label = propositionNames[entry.action.slice('judge:'.length)] ?? '这一项条件'
    const verdictText = PROPOSITION_OUTCOME_TEXT[outcome] ?? '已判定'
    // 证据里若还带了额外说明（不是枚举复述），括注出来
    const extra = summary && summary !== outcome ? `（${summary}）` : ''
    return {
      ...base,
      type: 'proposition-judged',
      status: STATUS_BY_JUDGE_OUTCOME[outcome] ?? 'done',
      text: `${label} · ${verdictText}${extra}`,
    }
  }
  if (entry.action.startsWith('contact:')) {
    const verdict = entry.conclusion?.outcome
    // 未知结论 → "不确定"事件（界面切到"待确认"形态，§6.2）
    if (verdict === 'UNKNOWN') {
      return { ...base, type: 'uncertain', status: 'uncertain', text: '结果待确认，正在核对……' }
    }
    // 事件自带业务语义名（"提交教室预约 · 系统拒绝了这次提交"）——
    // 界面（对话里的折叠块、明细行）因此不必各自再去查证据补名字，
    // 也不会把内部接口标识漏到用户面前（映射缺失时给中性说法，不塞 id）。
    const label = interfaceNames[entry.action.slice('contact:'.length)] ?? '与业务系统交互'
    return {
      ...base,
      type: 'call',
      // isWrite：接口注册表 sideEffect=true 才算是"写请求已发出"——
      // 只读查证调用不算（改口窗口与取消按钮据此判定，见 task.js writeIssued）
      isWrite: writeInterfaceIds.has(entry.action.slice('contact:'.length)),
      status: STATUS_BY_VERDICT[verdict] ?? 'done',
      text: `${label}${callDetailText(summary)}`,
    }
  }
  if (entry.action.startsWith('ask:')) {
    // 需要用户输入（追问/换时段确认）：界面在对话视图出现交互（§6.2）
    return { ...base, type: 'input-required', status: 'running', text: summary }
  }
  if (entry.action.startsWith('decide:')) {
    const outcome = entry.conclusion?.outcome ?? ''
    const event = {
      ...base,
      type: 'decision',
      status: decisionStatus(outcome),
      text: summary,
    }
    // decide:understand 的 ok 路径带结构化载荷（理解卡数据源）；澄清/越界等其他 decide 不带
    const structured = entry.conclusion?.structured
    if (structured) {
      event.intentId = structured.intentId
      event.intentName = structured.intentName
      event.slots = structured.slots
      event.confidence = structured.confidence
    }
    return event
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
