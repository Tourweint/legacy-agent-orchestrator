// 混沌控制器 —— 第 09 章：命令式、确定性、可重放的故障注入（§六），默认撤防（§七）。
//
// 规格：
//   · 注入粒度 = "接口 + 第 N 次调用"（决策 F1）——精确复现"第一次成功、响应丢失"这类场景
//   · 禁止随机比例注入（§六：随机无法归因）
//   · 默认撤防；撤防时 onOutbound 返回 null（传输层零差异直通，§2.1）
//   · 注入生效时记录注入档案（谁、哪次、什么故障、是否真实到达服务端）——§八 证据项 1
//   · ★T5 响应丢失：真实转发 → 真实落库 → 丢弃响应（§3.1：禁止伪造，否则查证实验自欺）
//
// 故障类型（§三）：T1 超时未到达 / T2 慢响应 / T3 5xx / T4 断连 / ★T5 响应丢失 /
// T6 业务码（200+400/403/409）/ T7 凭证失效 / T8 边界超时。

import { OrchestrationError } from '../orchestration/orchestration-error.js'

const FAULT_DECISIONS = {
  T1: () => ({ action: 'block', fault: { transportKind: 'timeout', note: 'T1 超时（请求未转发——未到达服务端）' } }),
  T2: (spec) => ({
    action: 'delay',
    fault: { type: 'T2', delayMs: spec.delayMs ?? 1000, note: `T2 慢响应（延迟 ${spec.delayMs ?? 1000}ms，低于超时线）` },
  }),
  T3: (spec) => ({
    action: 'substitute',
    fault: {
      httpStatus: spec.httpStatus ?? 500,
      businessCode: spec.businessCode ?? 500,
      note: 'T3 服务端错误（5xx；未转发——模拟服务端在处理前出错，无副作用）',
    },
  }),
  T4: () => ({
    action: 'drop',
    fault: { type: 'T4', transportKind: 'disconnect', note: 'T4 连接断开（请求已真实转发，响应途中断开）' },
  }),
  T5: () => ({
    action: 'drop',
    fault: {
      type: 'T5',
      transportKind: 'timeout',
      note: 'T5 响应丢失（请求已真实转发并到达服务端——可能已落库；响应在返回途中被丢弃）',
    },
  }),
  T6: (spec) => ({
    action: 'substitute',
    fault: {
      httpStatus: spec.httpStatus ?? 200,
      businessCode: spec.businessCode,
      note: `T6 业务码注入（HTTP ${spec.httpStatus ?? 200} + code ${spec.businessCode}；未转发——模拟服务端业务拒绝）`,
    },
  }),
  T7: () => ({
    action: 'substitute',
    fault: { httpStatus: 401, businessCode: null, note: 'T7 凭证失效（HTTP 401）' },
  }),
  T8: (spec) => ({
    action: 'delay',
    fault: { type: 'T8', delayMs: spec.delayMs, note: `T8 边界超时（延迟 ${spec.delayMs}ms，越过超时线）` },
  }),
}

export class ChaosController {
  constructor({ configStore }) {
    this.store = configStore
    this.disarm()
  }

  /**
   * 布防。injects：[{ interface: 接口标识, nth: 第 N 次调用, fault: 'T1'…'T8' | 故障对象 }]
   * 故障对象形态（T6/T2/T8 需要参数）：{ type: 'T6', businessCode: 409, httpStatus: 200, message? }
   */
  arm({ injects }) {
    if (!Array.isArray(injects) || injects.length === 0) {
      throw new OrchestrationError('布防需要至少一条注入指令（不允许"开着但没命中"的模糊状态，§七）')
    }
    this.#specs = injects.map((spec) => {
      const iface = this.store.getInterface(spec.interface)
      const fault = typeof spec.fault === 'string' ? { type: spec.fault } : spec.fault
      if (!FAULT_DECISIONS[fault.type]) {
        throw new OrchestrationError(`未知故障类型: ${fault.type}（§三 清单之外的故障不得注入）`)
      }
      // 注册表路径是模板（/reservations/{id}）——编译为正则以匹配真实请求路径
      const pathPattern = new RegExp('^' + iface.path.replace(/\{[^}]+\}/g, '[^/]+') + '$')
      return { interfaceId: iface.id, method: iface.method, pathPattern, nth: spec.nth ?? 1, fault }
    })
    this.#counters = new Map()
    this.#armed = true
    this.#records = []
    return this
  }

  disarm() {
    this.#armed = false
    this.#specs = []
    this.#counters = new Map()
    // 注入档案（#records）保留——它是实验证据（§八 证据 1），撤防不清除
  }

  get armed() {
    return this.#armed
  }

  get records() {
    return [...this.#records]
  }

  // 传输层接缝：撤防（未布防）返回 null → 传输层零差异直通（§2.1）
  onOutbound({ method, path }) {
    if (!this.#armed) return null
    const matches = this.#specs.filter((s) => s.method === method && s.pathPattern.test(path))
    if (matches.length === 0) return null
    // 同接口的多条注入指令（如 cancel 第 1、2 次各一次）共享调用计数：
    // 计数按接口累计，命中"第 N 次"的那条 spec 生效，其余直通
    const count = (this.#counters.get(matches[0].interfaceId) ?? 0) + 1
    this.#counters.set(matches[0].interfaceId, count)
    const spec = matches.find((s) => s.nth === count)
    if (!spec) return null // 第 N 次之外的调用：直通
    const decision = FAULT_DECISIONS[spec.fault.type](spec.fault)
    this.#records.push({
      interface: spec.interfaceId,
      nth: spec.nth,
      fault: spec.fault,
      method,
      path,
      reachedServer: decision.action === 'drop', // ★T5/T4：已真实到达服务端（§3.1 要求标注）
      decision: decision.action,
      at: new Date().toISOString(),
    })
    return decision
  }

  #armed = false
  #specs = []
  #counters = new Map()
  #records = []
}
