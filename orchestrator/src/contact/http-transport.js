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
// onOutbound 是阶段 6 混沌实验的注入接缝（默认 null = 撤防，行为与"没有这套机制"完全一致）。
// 注入生效时只允许"丢弃真实响应"，不允许伪造响应（第 09 章 §3.1）。

import { formatLegacyTimestamp } from '../canonical/time.js'

export class HttpTransport {
  /**
   * @param {object} options
   * @param {string} options.baseUrl        存量系统根地址（真实路径无 /api 前缀，基线 §8.1）
   * @param {Function} [options.fetchImpl]  可注入的 fetch（测试用；默认全局 fetch）
   * @param {Function} [options.onOutbound] 混沌注入接缝：({method, path}) => ({dropResponse?: boolean}) | null
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

    // 注入接缝：默认撤防。注入只允许"放行请求、丢弃响应"——真实转发已经发生，
    // 存量系统可能已落库，这与真实的响应丢失故障一致（第 09 章）。
    const injected = this.onOutbound ? this.onOutbound({ method, path: url.pathname }) : null

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
    } finally {
      clearTimeout(timer)
    }

    if (injected?.dropResponse) {
      // 响应在传输层被丢弃：调用方视角 = 超时（服务端可能已处理）
      return { kind: 'timeout', injected: true }
    }

    const bodyText = await response.text().catch(() => null)
    let json
    try {
      json = bodyText === null || bodyText === '' ? undefined : JSON.parse(bodyText)
    } catch {
      return { kind: 'unparseable', httpStatus: response.status, bodyText: bodyText ?? '' }
    }
    return { kind: 'response', httpStatus: response.status, json, bodyText: bodyText ?? '' }
  }
}

function stringifyQueryValue(value) {
  if (value instanceof Date) return formatLegacyTimestamp(value)
  return String(value)
}
