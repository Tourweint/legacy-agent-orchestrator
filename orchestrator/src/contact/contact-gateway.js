// 接触层网关 —— 对上层（判定层/编排层）的唯一入口（第 13 章 阶段 1）。
//
// 契约：输入"逻辑调用名 + 语义化参数"，输出"三值结论 + 原因分类 + 依据"。
// 不输出 HTTP 状态码、不输出原始响应体、不输出凭证——原始信号的完整形态只进证据链
// （第 05 章 §八 evidence；第 02 章 A5：证据链保留原响应片段供折叠展示）。
// 这样编排层永远写不出 `if (httpStatus === 409)`——判定规则无处可散落。
//
// 重试纪律（第 05 章 R6/R8/R9 + 第 01 章 M4）：只有读接口按规则表 retryable 标记做
// 有限重试（C13：2 次短间隔）；读 401 先透明重登（J5）；写接口任何情形都不自动重试。
// 重试上限打满后的兜底是 R10：FAILURE + "事实不可得"。

import { ContactError } from './contact-error.js'
import { evaluateVerdict, READ_RETRY_EXHAUSTED } from './verdict-rules.js'
import { scrubTextSecrets } from '../evidence/redact.js'

// 登录接口的原始响应体含 token——不进任何证据（结构化清洗兜不住自由文本里的形态）
const FRAGMENT_SKIPPED_INTERFACES = new Set(['auth.login'])

export class ContactGateway {
  /**
   * @param {object} options
   * @param {import('../config/config-store.js').ConfigStore} options.configStore
   * @param {import('./http-transport.js').HttpTransport} options.transport
   * @param {import('./identity-pool.js').IdentityPool} options.identityPool
   * @param {import('./adapters.js').ProtocolAdapters} options.adapters
   * @param {import('../evidence/evidence-chain.js').EvidenceChain|null} [options.evidenceChain]
   * @param {() => Date} [options.now]
   */
  constructor({ configStore, transport, identityPool, adapters, evidenceChain = null, now = () => new Date() }) {
    this.store = configStore
    this.transport = transport
    this.pool = identityPool
    this.adapters = adapters
    this.evidenceChain = evidenceChain
    this.now = now
  }

  /**
   * 发起一次对存量系统的逻辑调用（全系统唯一入口）。
   * @param {string} interfaceId  注册表接口标识
   * @param {object} params       语义化参数（绝对时刻用 Date；见 adapters 的参数契约）
   * @param {{initiatorIdentity?: string, evidenceChain?: object, phase?: string}} [options]
   *        evidenceChain：按任务覆盖证据链（阶段 4：每任务一条链，网关其余状态共享）；
   *        phase：轨迹阶段标记（P2 事实 / P3 提交 / P4 查证 / P5 恢复），随证据条目留档
   * @returns {Promise<{interfaceId: string, verdict: 'SUCCESS'|'FAILURE'|'UNKNOWN',
   *    reasonCode: string, ambiguous: boolean, retryable: boolean, elapsedMs: number,
   *    data: *, ruleRow: string|null, evidenceRef: {taskId: string, seq: number}|null, note?: string,
   *    factUnavailable?: boolean}>}
   */
  async call(interfaceId, params = {}, { initiatorIdentity, evidenceChain, phase } = {}) {
    const chain = evidenceChain ?? this.evidenceChain
    const iface = this.store.getInterface(interfaceId)
    const kind = iface.sideEffect ? 'write' : 'read'
    const timeoutClass = iface.timeoutClass ?? (kind === 'write' ? 'write' : 'read')
    const timeoutMs = this.store.getConstants().timeoutsMs[timeoutClass]
    if (!timeoutMs) throw new ContactError(`常量集合缺少超时档: ${timeoutClass}`)

    // requiredIdentity=initiator：查证/查重必须用"发起写入时的同一身份"（第 01 章 §6.4 ⑨）
    let identityId = iface.requiredIdentity
    if (identityId === 'initiator') {
      if (!initiatorIdentity) throw new ContactError(`接口 ${interfaceId} 需要发起时身份（initiatorIdentity）`)
      identityId = initiatorIdentity
    } else if (identityId === 'none') {
      identityId = null
    }

    // 请求构造在本地完成（含 M3 式硬校验）——参数不合格时根本不发出请求
    const wire = this.adapters.buildRequest(iface, params)

    const maxRetries = kind === 'read' ? this.store.getConstants().contact?.readRetry?.maxRetries ?? 2 : 0
    const retryDelayMs = this.store.getConstants().contact?.readRetry?.delayMs ?? 200
    const retryConfig = { maxRetries, retryDelayMs }

    let attempt = 0
    let forceRefresh = false
    let transportResult
    let signals
    let outcome
    let firstAttempt = null // 首次尝试的判定（重试在内部发生时，证据链仍可见——§八 证据 3）
    const startedAt = this.now().getTime()

    while (true) {
      attempt += 1
      const authorization = identityId ? await this.pool.getAuthorization(identityId, { forceRefresh }) : null
      forceRefresh = false
      transportResult = await this.transport.request({
        ...wire,
        headers: { ...(authorization ? { Authorization: authorization } : {}), ...wire.headers },
        timeoutMs,
      })
      signals = this.adapters.extractSignals(transportResult)
      outcome = evaluateVerdict(kind, signals, iface)
      if (attempt === 1) {
        // 首判留档：若发生内部重试（R6/R8/R9），第一次的判定仍可被复核（§八 证据 3）
        firstAttempt = { verdict: outcome.verdict, ruleRow: outcome.ruleRow, reasonCode: outcome.reasonCode }
      }

      const retriesLeft = attempt <= retryConfig.maxRetries
      if (kind === 'read' && outcome.retryable && retriesLeft) {
        // 读 401：透明重登（凭证刷新只在网关内部，M6）；其他瞬态：短间隔后重试（C13 不做指数退避）
        if (outcome.reasonCode === 'credential') {
          this.pool.invalidate(identityId)
          forceRefresh = true
        } else {
          await sleep(retryConfig.retryDelayMs)
        }
        continue
      }
      break
    }

    const elapsedMs = this.now().getTime() - startedAt

    // 读重试打满仍停在"可重试"的 UNKNOWN 上 → R10 兜底：FAILURE + 事实不可得
    const exhausted =
      kind === 'read' && outcome.retryable && attempt > retryConfig.maxRetries
    const finalOutcome = exhausted ? { ...READ_RETRY_EXHAUSTED, ambiguous: false } : outcome
    const factUnavailable = exhausted ? { factUnavailable: true } : {}

    const data =
      finalOutcome.verdict === 'SUCCESS' ? this.adapters.normalizeData(iface, signals.data) : undefined

    const evidenceRef = this.#recordEvidence({
      chain,
      identityId,
      transportResult,
      firstAttempt,
      iface,
      wire,
      params,
      attempt,
      signals,
      finalOutcome,
      elapsedMs,
      phase,
    })

    // 结果对象只含三值结论与语义数据——协议级信号绝不外泄（第 13 章 阶段 1 契约）
    return {
      interfaceId,
      verdict: finalOutcome.verdict,
      reasonCode: finalOutcome.reasonCode,
      ambiguous: finalOutcome.ambiguous ?? false,
      retryable: finalOutcome.retryable,
      elapsedMs,
      data,
      ruleRow: finalOutcome.ruleRow,
      evidenceRef,
      ...(finalOutcome.note ? { note: finalOutcome.note } : {}),
      ...factUnavailable,
    }
  }

  /**
   * 判定依据落证据链（I4/P6）：依据=命中的规则行号；附加档=协议级信号+清洗后的响应片段。
   * 原始片段先剔凭证形态再截断（C16）；登录响应整段跳过（其体内有 token）。
   */
  #recordEvidence({ chain, identityId, transportResult, firstAttempt, iface, wire, params, attempt, signals, finalOutcome, elapsedMs, phase }) {
    if (!chain) return null
    let rawFragment = ''
    if (signals.transportKind === 'response' && !FRAGMENT_SKIPPED_INTERFACES.has(iface.id)) {
      rawFragment = scrubTextSecrets(String(signals.bodyText ?? '')).slice(
        0,
        this.store.getConstants().evidence?.rawFragmentMaxLength ?? 500,
      )
    }
    const entry = chain.record({
      action: `contact:${iface.id}`,
      input: { method: wire.method, path: wire.path, params, attempt },
      basis: finalOutcome.ruleRow ? [{ rule: finalOutcome.ruleRow }] : [{ detail: '规则表未列出，保守兜底 UNKNOWN' }],
      conclusion: {
        outcome: finalOutcome.verdict,
        summary: `${finalOutcome.reasonCode}${finalOutcome.ambiguous ? '（歧义信号）' : ''}`,
      },
      metadata: {
        identity: identityId ?? null,
        injected: transportResult.injected === true || undefined,
        faultNote: transportResult.faultNote,
        transportKind: signals.transportKind,
        httpStatus: signals.httpStatus,
        businessCode: signals.businessCode,
        serverMessage: signals.message,
        rawFragment,
        elapsedMs,
        ...(attempt > 1 && firstAttempt ? { attempts: attempt, firstAttempt } : {}),
      },
      ...(phase ? { phase } : {}),
    })
    return { taskId: entry.taskId, seq: entry.seq }
  }

  /** 阶段 4：为单个任务派生网关视图——传输/身份池/适配器共享，证据链独立。 */
  forTask(evidenceChain) {
    return new ContactGateway({
      configStore: this.store,
      transport: this.transport,
      identityPool: this.pool,
      adapters: this.adapters,
      evidenceChain,
    })
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
