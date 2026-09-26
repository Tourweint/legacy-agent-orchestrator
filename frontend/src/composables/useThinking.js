// 思考过程归并 —— 把一轮的事件流折成"三层信息"（界面方案 §三 / §四）。
//
// 为什么单独成模块：这是本轮界面改造里**唯一有逻辑**的部分，其余都是摆放。
// 它不依赖 Vue，可被 node 直接单测——规则一旦钉死，界面怎么改都不会走样。
//
// 三层判据（方案 §1.2）：**这条信息会不会改变用户下一步的动作**？
//   L1 会                  → 结论 / 拒绝理由 / 追问 / 待确认时间（直接呈现 `terminal`、`input-required`，不经过本模块）
//   L2 不会、但解释"为什么" → 判定结论、调用结果、不确定、**理解结果** ← 本模块产出 `lines`
//   L3 只有审计价值         → 事实明细、内部决策、审计       ← 本模块产出 `details`（原样交给明细行渲染）
//
// 纪律：文案一律取自事件自带的 `text`（已是人话，由引擎产出）；本模块只做**选择与归并**，不新造句子——
// 否则界面会长出第二份"阶段 → 文案"的映射，和引擎的规则表必然漂移。
//
// 依赖的事实：事件自带 `phase`（阶段）与 `at`（时刻），逐条由 event-stream.js 的 mapEntryToEvent 带上。
// 因此**不依赖** `phase-start/phase-end` 这两个事件（接口清单 §四 标注"预留，尚未产出"）：
// 步数 = 事件条数，耗时 = 首末事件 `at` 之差。

const PHASE_NAMES = { P1: '理解', P2: '判定', P3: '调用', P4: '结果', P5: '恢复', P6: '留痕' }
const PHASE_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

// 需要让用户看见的状态：没办成的、说不准的、事实取不到的。
// `done`（成立）与 `not-applicable`（不适用）都不进"失败链"。
const BAD_STATUS = new Set(['failed', 'uncertain', 'unavailable'])

function keyLine(phase, event, focus = false) {
  return {
    seq: event.seq ?? null,
    phase,
    phaseName: PHASE_NAMES[phase] ?? phase,
    status: event.status ?? 'done',
    text: event.text ?? '',
    focus,
  }
}

function summaryLine(phase, status, text, focus) {
  return { seq: null, phase, phaseName: PHASE_NAMES[phase] ?? phase, status, text, focus }
}

/**
 * 折叠块的默认展开状态。
 * 运行中/挂起 → 全展开（用户要知道它在干什么、才好回答追问）；
 * 有失败链   → 部分展开（用户第一个疑问是"为什么不行"）；
 * 其余       → 收起（结论已经回答了全部问题）。
 * @param {number} failCount 失败链行数（**不含**理解行——理解行总是可见，不构成"没办成"）
 */
export function defaultModeFor(taskStatus, failCount) {
  if (taskStatus === 'running' || taskStatus === 'suspended') return 'full'
  return failCount > 0 ? 'partial' : 'collapsed'
}

/**
 * 归并一轮的事件为一棵可渲染的结构。
 * @param {Array} events  该轮的事件（SSE 与证据链同源，含 seq/phase/type/status/text/at）
 * @param {object} [opts]
 * @param {string} [opts.taskStatus]  idle | running | suspended | terminal
 * @returns {{steps:number, durationMs:number, lines:Array, details:Array, focusCount:number, hiddenCount:number, defaultMode:string}}
 */
export function buildThinking(events = [], { taskStatus = 'idle' } = {}) {
  const list = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const lines = []

  for (const phase of PHASE_ORDER) {
    const inPhase = list.filter((e) => (e.phase ?? 'P6') === phase)
    if (inPhase.length === 0) continue

    // 理解结果：用户最关心"它到底听懂了什么"——即使是 decision，也归 L2（方案 §四 的例外）
    if (phase === 'P1') {
      for (const e of inPhase.filter((ev) => ev.type === 'decision')) lines.push(keyLine(phase, e))
    }

    // 判定：成功的只报计数，失败的逐条列出（"输出结构化"的落点）
    const judged = inPhase.filter((e) => e.type === 'proposition-judged')
    if (judged.length > 0) {
      const bad = judged.filter((e) => BAD_STATUS.has(e.status))
      if (bad.length === 0) {
        lines.push(summaryLine(phase, 'done', `判定 ${judged.length} 项全部通过`, false))
      } else {
        lines.push(summaryLine(phase, 'failed', `判定 ${judged.length} 项，其中 ${bad.length} 项没通过`, true))
        for (const e of bad) lines.push(keyLine(phase, e, true))
      }
    }

    // 调用：同一口径
    const calls = inPhase.filter((e) => e.type === 'call')
    if (calls.length > 0) {
      const bad = calls.filter((e) => BAD_STATUS.has(e.status))
      if (bad.length === 0) {
        lines.push(summaryLine(phase, 'done', `调用 ${calls.length} 次，全部成功`, false))
      } else {
        lines.push(summaryLine(phase, 'failed', `调用 ${calls.length} 次，${bad.length} 次没成功`, true))
        for (const e of bad) lines.push(keyLine(phase, e, true))
      }
    }

    // 不确定：必须被看见（I3：不确定不能悬空，对用户也一样）
    for (const e of inPhase.filter((ev) => ev.type === 'uncertain')) lines.push(keyLine(phase, e, true))
  }

  // "部分展开"的显示集合：把每条失败行**同阶段的上一条**也带上——
  // "这个时段是空的 ✖" 单独出现会缺上下文，"判定 5 项，其中 1 项没通过"才是它的来处。
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].focus) continue
    const prev = lines[i - 1]
    if (prev && prev.phase === lines[i].phase) prev.focus = true
  }
  // 理解结果永远出现在"部分展开"里：它解释了"为什么它这么理解"
  for (const l of lines) if (l.phase === 'P1') l.focus = true

  const focusCount = lines.filter((l) => l.focus).length
  // 失败链 = focus 行里**不属于理解阶段**的那些（理解的可见性不是"没办成"的信号）
  const failCount = lines.filter((l) => l.focus && l.phase !== 'P1').length
  const first = list[0]
  const last = list[list.length - 1]
  const durationMs =
    first?.at && last?.at ? Math.max(0, new Date(last.at).getTime() - new Date(first.at).getTime()) : 0

  return {
    steps: list.length,
    durationMs,
    status: taskStatus,
    lines, // L2 要点（focus=true 的那部分是"部分展开"要显示的）
    details: list, // L3 明细（原样）
    focusCount,
    failCount,
    hiddenCount: lines.length - focusCount,
    defaultMode: defaultModeFor(taskStatus, failCount),
  }
}

/** 毫秒 → "2.4 秒" / "12 秒" / "1 分 12 秒"（一位小数，够用且不啰嗦）。 */
export function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0)
  if (value >= 60_000) {
    const seconds = Math.round(value / 1000)
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  }
  const seconds = Math.round(value / 100) / 10
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`
}
