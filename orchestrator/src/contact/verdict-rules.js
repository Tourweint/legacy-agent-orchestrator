// 三值判定规则表 —— 第 05 章 §四 的逐行落地（W1–W13 写接口 / R1–R10 读接口）。
//
// 这张表是全系统唯一的判定点（第 05 章 §二）：接触层是执行者，不是决定者。
// 三条写死的行为（第 13 章 阶段 1）：
//   1. 判定必须先看业务码、最后看 HTTP 状态码——顺序由本表的行序实现（C11：写死，单一顺序）
//   2. 只读与写在超时/5xx/401 上处置不同：读可重试（retryable）、写须查证（W7/W9/W11）
//   3. 未列出的组合一律 UNKNOWN（§4.3：白名单式，默认失败是静默的错误源）
//
// C15：行号 W/R 稳定编号，新增或修改语义必须走变更记录（W13 为三审实测新增）。

// 规则行共用的输出字段：verdict（SUCCESS/FAILURE/UNKNOWN）、reasonCode、ambiguous、
// retryable（技术上可安全重试——不表达"业务上应该"，写接口即使标了也必须先查证）。

function response(transportKind, httpStatus, businessCode) {
  return { transportKind, httpStatus, businessCode }
}

const isHttp = (s, status) => s.transportKind === 'response' && s.httpStatus === status
const is5xx = (s) => s.transportKind === 'response' && s.httpStatus !== null && s.httpStatus >= 500
const is4xxExcept = (s, ...excluded) =>
  s.transportKind === 'response' &&
  s.httpStatus !== null &&
  s.httpStatus >= 400 &&
  s.httpStatus < 500 &&
  !excluded.includes(s.httpStatus)

// W4 / W13 的分叉（决策汇总 L1 + D10 实测）：补偿撤销收到 200+400/404 不是"撤销技术失败"——
// 已取消/历史预约/记录不存在都意味着副作用可能早已收敛，必须进 recordId 查证收敛，
// 判失败会触发对已撤销记录的重试撤销（J3 要防的后果）。
function compensationFork(iface, failureVerdict, failureReason) {
  if (iface?.verdictFork === 'compensation') {
    return { verdict: 'UNKNOWN', reasonCode: 'compensation-verify', ambiguous: false, retryable: false, note: '按 recordId 查证收敛（第 06 章 §8.1）' }
  }
  return { verdict: failureVerdict, reasonCode: failureReason, ambiguous: false, retryable: false }
}

export const VERDICT_RULES = [
  // ── 写接口（有副作用）─────────────────────────────────────────────────────
  {
    id: 'W1', kind: 'write',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 200,
    verdict: 'SUCCESS', reasonCode: 'ok', retryable: false,
  },
  {
    id: 'W2', kind: 'write',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 409,
    verdict: 'UNKNOWN', reasonCode: 'conflict-ambiguous', ambiguous: true, retryable: false,
    // 409 是歧义信号：既可能是自己已成功、也可能是别人占了，响应字节级相同——禁止重试，进查证
    note: '歧义信号：查证前禁止重试（第 05 章 §六）',
  },
  {
    id: 'W3', kind: 'write',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 403,
    verdict: 'FAILURE', reasonCode: 'identity-error', retryable: false,
    note: '方法层越权（@PreAuthorize）。绝不能当成功；身份错=系统缺陷，须登记（C12）',
  },
  {
    id: 'W4', kind: 'write',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 400,
    // 参数非法/业务规则拒绝/资源不存在（GET 详情）共用 400，语义无法自动区分——
    // 登记为疑似缺陷、归因需人工确认（一审修正）；补偿撤销语境进查证（D10）
    resolve: (_s, iface) => compensationFork(iface, 'FAILURE', 'bad-request'),
  },
  {
    id: 'W13', kind: 'write',
    match: (s) =>
      s.transportKind === 'response' &&
      (s.businessCode === 404 || s.httpStatus === 404),
    // 资源不存在码分叉（三审 L1）：创建类 → FAILURE（本应由前置命题拦住）；补偿撤销 → 进查证
    // 本系统实测形态是 HTTP 200 + code 404；HTTP 层 404 同语义，一并归入本行（W10 排除 404 的去向）
    resolve: (_s, iface) => compensationFork(iface, 'FAILURE', 'resource-not-found'),
  },
  {
    id: 'W5', kind: 'write',
    match: (s) =>
      s.transportKind === 'response' && s.httpStatus === 200 &&
      s.businessCode !== null && ![200, 400, 403, 404, 409].includes(s.businessCode),
    verdict: 'UNKNOWN', reasonCode: 'unregistered-business-code', retryable: false,
    note: '未登记的业务码：不能默认失败（§4.3），进查证',
  },
  {
    id: 'W6', kind: 'write',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === null,
    verdict: 'UNKNOWN', reasonCode: 'malformed-envelope', retryable: false,
    note: '响应体不是约定形状（可能来自中间层），进查证',
  },
  {
    id: 'W7', kind: 'write',
    match: (s) => isHttp(s, 401),
    verdict: 'FAILURE', reasonCode: 'credential', retryable: false,
    note: '写接口 401 绝不允许"刷新凭证后直接重试"——请求可能已被处理，须先查证（J5/W7）',
  },
  {
    id: 'W8', kind: 'write',
    match: (s) => isHttp(s, 403),
    verdict: 'FAILURE', reasonCode: 'identity-error', retryable: false,
    note: '过滤器层越权。与 W3 同判：身份错=系统缺陷',
  },
  {
    id: 'W9', kind: 'write',
    match: (s) => is5xx(s),
    verdict: 'UNKNOWN', reasonCode: 'server-error', retryable: false,
    note: '服务端出错但请求可能已被处理——不可重试，进查证',
  },
  {
    id: 'W10', kind: 'write',
    match: (s) => is4xxExcept(s, 401, 403, 404),
    verdict: 'UNKNOWN', reasonCode: 'unexpected-http-status', retryable: false,
    note: '未预期形状（404 见 W13）',
  },
  {
    id: 'W11', kind: 'write',
    match: (s) => s.transportKind === 'timeout' || s.transportKind === 'disconnect',
    verdict: 'UNKNOWN', reasonCode: 'no-response', retryable: false,
    note: '最典型的不确定：超时不是失败',
  },
  {
    id: 'W12', kind: 'write',
    match: (s) => s.transportKind === 'unparseable',
    verdict: 'UNKNOWN', reasonCode: 'unparseable-body', retryable: false,
  },

  // ── 读接口（无副作用）─────────────────────────────────────────────────────
  {
    id: 'R1', kind: 'read',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 200,
    verdict: 'SUCCESS', reasonCode: 'ok', retryable: false,
  },
  {
    id: 'R2', kind: 'read',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 400,
    verdict: 'FAILURE', reasonCode: 'bad-request', retryable: false,
    note: '读参数由我们自己组装，可能确实传了它不接受的值——不登记为缺陷',
  },
  {
    id: 'R3', kind: 'read',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 403,
    verdict: 'FAILURE', reasonCode: 'identity-error', retryable: false,
    note: '身份错（方法层），根因在我们这边——登记缺陷',
  },
  {
    id: 'R4', kind: 'read',
    match: (s) => s.transportKind === 'response' && s.httpStatus === 200 && s.businessCode === 409,
    verdict: 'FAILURE', reasonCode: 'conflict-unexpected', retryable: false,
    note: '读接口不会"冲突"，409 在只读语义下只能是异常',
  },
  {
    id: 'R5', kind: 'read',
    match: (s) =>
      s.transportKind === 'response' && s.httpStatus === 200 &&
      s.businessCode !== null && ![200, 400, 403, 409].includes(s.businessCode),
    verdict: 'FAILURE', reasonCode: 'unexpected-business-code', retryable: false,
    note: '读接口拿到不认的码，重试也不会变（含 404）',
  },
  {
    id: 'R6', kind: 'read',
    match: (s) => isHttp(s, 401),
    verdict: 'UNKNOWN', reasonCode: 'credential', retryable: true,
    note: '凭证问题：无副作用，透明重登后允许直接重试（R6/J5）；重试超限 → R10',
  },
  {
    id: 'R7', kind: 'read',
    match: (s) => isHttp(s, 403),
    verdict: 'FAILURE', reasonCode: 'identity-error', retryable: false,
    note: '身份是声明式的，不会变——不重试，登记缺陷',
  },
  {
    id: 'R8', kind: 'read',
    match: (s) => is5xx(s),
    verdict: 'UNKNOWN', reasonCode: 'server-error', retryable: true,
    note: '无副作用，重试安全；重试超限 → R10',
  },
  {
    id: 'R9', kind: 'read',
    match: (s) => s.transportKind === 'timeout' || s.transportKind === 'disconnect',
    verdict: 'UNKNOWN', reasonCode: 'no-response', retryable: true,
    note: '无副作用，重试安全；重试超限 → R10',
  },
  // 读接口"响应体无法解析"未列出 → 默认 UNKNOWN（§4.3，由 DEFAULT_UNKNOWN 承接）
]

// R10 不是信号行，是"读重试超限"的兜底结论（二审：它不是一条独立信号行）
export const READ_RETRY_EXHAUSTED = {
  id: 'R10',
  ruleRow: 'R10',
  verdict: 'FAILURE',
  reasonCode: 'fact-unavailable',
  retryable: false,
  note: '只读重试超限：结论标为"事实不可得"，交命题层按不可得处置（第 08 章 §三）',
}

// 未列出的组合一律 UNKNOWN（§4.3）
export const DEFAULT_UNKNOWN = {
  id: null,
  verdict: 'UNKNOWN',
  reasonCode: 'unlisted-signals',
  retryable: false,
  note: '规则表未列出的信号组合，按保守兜底处理并应登记新行（C15）',
}

/**
 * 执行判定。自上而下匹配，命中即停（§4.1 读法）。
 * @param {'write'|'read'} kind
 * @param {object} signals  extractSignals 的输出
 * @param {object} iface    注册表条目（W4/W13 分叉读取 verdictFork）
 */
export function evaluateVerdict(kind, signals, iface) {
  for (const row of VERDICT_RULES) {
    if (row.kind !== kind) continue
    if (!row.match(signals)) continue
    const resolved = row.resolve
      ? row.resolve(signals, iface)
      : { verdict: row.verdict, reasonCode: row.reasonCode, ambiguous: row.ambiguous ?? false, retryable: row.retryable }
    return { ...resolved, ruleRow: row.id, note: row.note }
  }
  return { ...DEFAULT_UNKNOWN, ruleRow: null }
}

// 供测试与自检使用：确认每一行都有落点、行号连续（C15 的机器可查形态）
export function listRuleRows() {
  return VERDICT_RULES.map((r) => ({ id: r.id, kind: r.kind }))
}
