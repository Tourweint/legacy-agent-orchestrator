// 混沌层测试 —— 第 09 章：撤防零差异、命令式注入（接口+第N次）、T5 真实转发、T6 合成响应。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChaosController } from '../src/chaos/chaos-controller.js'
import { HttpTransport } from '../src/contact/http-transport.js'
import { ConfigStore } from '../src/config/config-store.js'

const store = new ConfigStore()

function fakeFetch(log) {
  return async (url, opts) => {
    log.push(`${opts?.method ?? 'GET'} ${url.pathname}`)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 200, message: 'ok', data: 77 }),
    }
  }
}

test('默认撤防：onOutbound 返回 null，传输层零差异直通', () => {
  const chaos = new ChaosController({ configStore: store })
  assert.equal(chaos.armed, false)
  assert.equal(chaos.onOutbound({ method: 'POST', path: '/reservations/classrooms' }), null)
  assert.equal(chaos.records.length, 0)
})

test('布防规格：空注入指令 / 未知故障类型 → 拒绝（§七：不允许模糊状态）', () => {
  const chaos = new ChaosController({ configStore: store })
  assert.throws(() => chaos.arm({ injects: [] }), OrchestrationCheck)
  assert.throws(
    () => chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T99' }] }),
    (err) => /未知故障类型/.test(err.message),
  )
  function OrchestrationCheck(err) {
    return /至少一条注入指令/.test(err.message)
  }
})

test('注入粒度（F1）：接口 + 第 N 次调用——第 1 次直通、第 2 次注入、第 3 次直通', () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 2, fault: 'T5' }] })
  const info = { method: 'POST', path: '/reservations/classrooms' }
  assert.equal(chaos.onOutbound(info), null) // 第 1 次：直通
  const d2 = chaos.onOutbound(info) // 第 2 次：注入
  assert.equal(d2.action, 'drop')
  assert.equal(chaos.onOutbound(info), null) // 第 3 次：直通
  assert.equal(chaos.records.length, 1)
  assert.equal(chaos.records[0].reachedServer, true) // ★T5 已真实到达服务端
})

test('接口匹配按注册表 method+path：同路径不同方法不误伤', () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.reservation.cancel', nth: 1, fault: 'T5' }] })
  // GET /reservations（mine）与 GET /reservations/115 都不匹配 cancel（DELETE + 模板路径）
  assert.equal(chaos.onOutbound({ method: 'GET', path: '/reservations' }), null)
  assert.equal(chaos.onOutbound({ method: 'GET', path: '/reservations/115' }), null)
  const d = chaos.onOutbound({ method: 'DELETE', path: '/reservations/115' }) // nth=1：第一次 DELETE 即注入
  assert.equal(d.action, 'drop')
})

test('T6 合成响应：businessCode 进入 fault 决策', () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: { type: 'T6', businessCode: 409, httpStatus: 200 } }] })
  const d = chaos.onOutbound({ method: 'POST', path: '/reservations/classrooms' })
  assert.equal(d.action, 'substitute')
  assert.equal(d.fault.businessCode, 409)
  assert.equal(d.fault.httpStatus, 200)
})

// ---- 传输层集成：四类动作的执行 ----

test('撤防传输：与无机制完全一致（fetch 正常、结果无 injected 标记）', async () => {
  const log = []
  const transport = new HttpTransport({ baseUrl: 'http://legacy.test', fetchImpl: fakeFetch(log) })
  const r = await transport.request({ method: 'GET', path: '/classrooms/5', timeoutMs: 3000 })
  assert.equal(r.kind, 'response')
  assert.equal(r.httpStatus, 200)
  assert.equal(r.injected, undefined)
  assert.equal(log.length, 1)
})

test('T1 block：不转发直接返回超时（fetch 未被调用）', async () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T1' }] })
  const log = []
  const transport = new HttpTransport({ baseUrl: 'http://legacy.test', fetchImpl: fakeFetch(log), onOutbound: (i) => chaos.onOutbound(i) })
  const r = await transport.request({ method: 'POST', path: '/reservations/classrooms', timeoutMs: 3000 })
  assert.equal(r.kind, 'timeout')
  assert.equal(r.injected, true)
  assert.ok(r.faultNote.includes('未转发'))
  assert.equal(log.length, 0) // 请求未到达"服务端"
})

test('★T5 drop：真实转发（fetch 已调用）→ 响应丢弃 → 超时 + reachedServer', async () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T5' }] })
  const log = []
  const transport = new HttpTransport({ baseUrl: 'http://legacy.test', fetchImpl: fakeFetch(log), onOutbound: (i) => chaos.onOutbound(i) })
  const r = await transport.request({ method: 'POST', path: '/reservations/classrooms', timeoutMs: 3000 })
  assert.equal(r.kind, 'timeout') // 调用方视角：超时
  assert.equal(r.injected, true)
  assert.equal(r.reachedServer, true) // §3.1：请求已真实到达（写库已发生）
  assert.equal(log.length, 1) // 真实转发（禁止伪造）
  assert.ok(r.faultNote.includes('真实转发'))
})

test('T6 substitute：不转发，返回合成响应 200+409', async () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: { type: 'T6', businessCode: 409, httpStatus: 200 } }] })
  const log = []
  const transport = new HttpTransport({ baseUrl: 'http://legacy.test', fetchImpl: fakeFetch(log), onOutbound: (i) => chaos.onOutbound(i) })
  const r = await transport.request({ method: 'POST', path: '/reservations/classrooms', timeoutMs: 3000 })
  assert.equal(r.kind, 'response')
  assert.equal(r.httpStatus, 200)
  assert.equal(r.json.code, 409) // 判定层将按 W2 判 UNKNOWN + 歧义
  assert.equal(r.injected, true)
  assert.equal(log.length, 0) // 无副作用（模拟服务端业务拒绝）
})

test('T2 delay（低于超时线）：响应成功交付', async () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.classroom.detail', nth: 1, fault: { type: 'T2', delayMs: 100 } }] })
  const transport = new HttpTransport({ baseUrl: 'http://legacy.test', fetchImpl: fakeFetch([]), onOutbound: (i) => chaos.onOutbound(i) })
  const r = await transport.request({ method: 'GET', path: '/classrooms/5', timeoutMs: 3000 })
  assert.equal(r.kind, 'response')
  assert.equal(r.json.code, 200)
})

test('T8 delay（越过超时线）：按超时交付（边界可复现）', async () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.classroom.detail', nth: 1, fault: { type: 'T8', delayMs: 4000 } }] })
  const transport = new HttpTransport({ baseUrl: 'http://legacy.test', fetchImpl: fakeFetch([]), onOutbound: (i) => chaos.onOutbound(i) })
  const r = await transport.request({ method: 'GET', path: '/classrooms/5', timeoutMs: 300 })
  assert.equal(r.kind, 'timeout')
  assert.equal(r.injected, true)
})

test('撤防后注入停止（§七：演示路径必须是撤防状态）', () => {
  const chaos = new ChaosController({ configStore: store })
  chaos.arm({ injects: [{ interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T5' }] })
  chaos.disarm()
  assert.equal(chaos.armed, false)
  assert.equal(chaos.onOutbound({ method: 'POST', path: '/reservations/classrooms' }), null)
  assert.equal(chaos.records.length, 0)
})
