// HTTP 传输 —— 第 02 章 §四 约束 A：全仓库唯一允许发起对存量系统网络请求的位置
// （由 scripts/constraint-check.mjs 机器检查，命中其他文件即为违规）。
//
// 职责仅限传输层：发请求、管超时、把结果归为四类——
//   response    收到响应（可能含 HTTP 错误状态；语义判定不在这里做）
//   timeout     超时（AbortController 中止）
//   disconnect  连接失败 / 被对端断开
//   unparseable 收到了响应但响应体不是合法 JSON（可能是中间层/代理返回）
// 它不知道"业务码"是什么、不判成败、不理解接口语义——那是判定规则表（verdict-rules）的事。
//
// onOutbound 是阶段 6 混沌实验的注入接缝（第 09 章 §二/§3.1；默认 null = 撤防）：
//   撤防零差异（§2.1）：onOutbound 为 null 或返回 null 时，走与"没有这套机制"完全一致的
//   直通路径——不拷贝、不重写、不等待。注入由 ChaosController 决策，分四类动作：
//     block        不转发直接返回故障结果（T1：请求未到达服务端）
//     substitute   不转发返回合成响应（T3/T6/T7：模拟服务端在处理前拒绝/出错——无副作用）
//     drop         真实转发、响应交付前丢弃（★T5：请求已真实到达服务端并落库——响应丢失；
//                  T4：连接断开。§3.1：T5 必须真实转发，禁止伪造）
//     delay        真实转发、响应交付前延迟（T2 慢响应 / T8 边界超时）
//   注入决策与记录由 ChaosController 承担；传输层只执行，不理解故障语义。

import { formatLegacyTimestamp } from '../canonical/time.js'

export class HttpTransport {
  /**
   * @param {object} options
   * @param {string} options.baseUrl        存量系统根地址（真实路径无 /api 前缀，基线 §8.1）
   * @param {Function} [options.fetchImpl]  可注入的 fetch（测试用；默认全局 fetch）
   * @param {Function} [options.onOutbound] 混沌注入接缝：({method, path}) => 决策 | null
   *        决策：{action:'block'|'substitute'|'drop'|'delay', fault:{...}} 或 null（直通）
   */
  constructor({ baseUrl, fetchImpl = globalThis.fetch, onOutbound = null } = {}) {
    if (!baseUrl) throw new Error('HttpTransport 需要 baseUrl')
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
    this.onOutbound = onOutbound
  }

  /**
   * @param {object} req
   * @param {string} req.method
   * @param {string} req.path            以 / 开头，可含已展开的路径参数
   * @param {object} [req.query]         查询参数（值为 Date 时按时间口径转成带 Z 的字符串）
   * @param {object} [req.headers]
   * @param {*} [req.body]               对象时序列化为 JSON
   * @param {number} req.timeoutMs
   */
  async request({ method, path, query, headers, body, timeoutMs }) {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, stringifyQueryValue(item))
      } else {
        url.searchParams.append(key, stringifyQueryValue(value))
      }
    }

    // 注入决策（撤防时 onOutbound 为 null 或返回 null → 零差异直通）
    const decision = this.onOutbound ? this.onOutbound({ method, path: url.pathname }) : null
    const fault = decision?.fault ?? null

    if (decision?.action === 'block') {
      // T1：请求不转发（未到达服务端）
      return { kind: fault.transportKind ?? 'timeout', injected: true, faultNote: fault.note }
    }
    if (decision?.action === 'substitute') {
      // T3/T6/T7：不转发，返回合成响应（模拟服务端在处理前拒绝/出错——无副作用）
      const json = { code: fault.businessCode, message: fault.note }
      return {
        kind: 'response',
        httpStatus: fault.httpStatus,
        json,
        bodyText: JSON.stringify(json),
        injected: true,
        faultNote: fault.note,
      }
    }

    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) return { kind: 'timeout' }
      return { kind: 'disconnect', errorMessage: String(err?.cause?.message || err?.message || err) }
    }

    if (decision?.action === 'drop') {
      // ★T5/T4：请求已真实转发（可能已落库），响应在交付前被丢弃——调用方视角为超时/断连
      clearTimeout(timer)
      return {
        kind: fault.transportKind ?? 'timeout',
        injected: true,
        faultNote: fault.note,
        reachedServer: true,
      }
    }

    const bodyText = await response.text().catch(() => null)
    let json
    try {
      json = bodyText === null || bodyText === '' ? undefined : JSON.parse(bodyText)
    } catch {
      return { kind: 'unparseable', httpStatus: response.status, bodyText: bodyText ?? '' }
    }

    if (decision?.action === 'delay') {
      // T2/T8：响应已收到，交付前延迟——越过超时线则按超时交付（边界行为可复现）
      const remaining = timeoutMs - (Date.now() - startedAt)
      if (remaining <= 0 || (fault.delayMs ?? 0) > remaining) {
        return { kind: 'timeout', injected: true, faultNote: fault.note, reachedServer: true }
      }
      await new Promise((resolve) => setTimeout(resolve, fault.delayMs))
    }

    clearTimeout(timer)
    return { kind: 'response', httpStatus: response.status, json, bodyText: bodyText ?? '' }
  }
}

function stringifyQueryValue(value) {
  if (value instanceof Date) return formatLegacyTimestamp(value)
  return String(value)
}
