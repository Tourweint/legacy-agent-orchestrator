// 接触层网关编排测试 —— 阶段 1 的核心行为：
//   · 读 401 透明重登后重试（R6/J5）；读 5xx/超时有限重试（C13）→ 打满落 R10"事实不可得"
//   · 写接口任何情形都不自动重试（M4/W7）
//   · 结果对象不泄漏协议级信号；凭证不出现在结果与证据链（阶段 1 验收③）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGateway, ok, envelope, httpOnly } from './helpers/fake-legacy.js'
import { ContactError } from '../src/contact/contact-error.js'

test('成功读调用：返回三值结论 + 归一化数据；结果对象不含协议级信号', async () => {
  const { gateway, chain } = makeGateway(() =>
    ok({ id: 5, building: '数智楼', roomNumber: '123', capacity: 48, status: 'ENABLED' }),
  )
  const result = await gateway.call('edu.classroom.detail', { classroomId: 5 })

  assert.equal(result.verdict, 'SUCCESS')
  assert.equal(result.ruleRow, 'R1')
  assert.equal(result.data.classroomId, 5)
  assert.equal(result.data.capacity, 48)
  // 契约：不输出 HTTP 状态码、不输出原始响应体
  for (const forbidden of ['httpStatus', 'businessCode', 'bodyText', 'rawFragment', 'token']) {
    assert.ok(!(forbidden in result), `结果对象不得包含 ${forbidden}`)
  }
  // 原始信号只进证据链（可折叠展示，第 02 章 A5），依据=命中的规则行
  const [entry] = chain.getEntries()
  assert.equal(entry.basis[0].rule, 'R1')
  assert.equal(entry.metadata.httpStatus, 200)
  assert.equal(entry.metadata.businessCode, 200)
})

test('写接口 401：FAILURE（凭证问题）且绝不自动重试（W7）', async () => {
  const { gateway, transport } = makeGateway(() => httpOnly(401))
  const result = await gateway.call('edu.reservation.classroom.create', {
    classroomId: 5,
    start: new Date(Date.UTC(2026, 8, 30, 5, 0)),
    end: new Date(Date.UTC(2026, 8, 30, 6, 0)),
    reason: 'x',
  })
  assert.equal(result.verdict, 'FAILURE')
  assert.equal(result.reasonCode, 'credential')
  assert.equal(result.ruleRow, 'W7')
  assert.equal(transport.callsTo('/reservations/classrooms').length, 1) // 只发了一次
})

test('读接口 401：透明重登后重试成功（R6/J5）——调用方全程无感', async () => {
  let readCount = 0
  const { gateway, transport } = makeGateway(() => {
    readCount += 1
    return readCount === 1 ? httpOnly(401) : ok([])
  })
  const result = await gateway.call('logi.reservation.list', {})

  assert.equal(result.verdict, 'SUCCESS')
  assert.equal(result.ruleRow, 'R1')
  assert.equal(readCount, 2)
  // 重登发生了：登录共两次（首次 + 透明刷新）
  assert.equal(transport.callsTo('/auth/login').length, 2)
})

test('读接口 5xx 打满重试上限：R10 FAILURE + 事实不可得（C13：初始+2 次）', async () => {
  const { gateway, transport } = makeGateway(() => httpOnly(500))
  const result = await gateway.call('logi.reservation.list', {})

  assert.equal(result.verdict, 'FAILURE')
  assert.equal(result.reasonCode, 'fact-unavailable')
  assert.equal(result.ruleRow, 'R10')
  assert.equal(result.factUnavailable, true)
  assert.equal(transport.callsTo('/admin/reservations').length, 3)
})

test('读接口 5xx 一次后恢复：重试成功且不超过上限', async () => {
  let count = 0
  const { gateway } = makeGateway(() => {
    count += 1
    return count === 1 ? httpOnly(500) : ok([])
  })
  const result = await gateway.call('edu.classroom.detail', { classroomId: 5 })
  assert.equal(result.verdict, 'SUCCESS')
  assert.equal(result.ruleRow, 'R1')
})

test('写接口超时：UNKNOWN（歧义不存在），只发一次，永不重试（W11/M4）', async () => {
  const { gateway, transport } = makeGateway(() => ({ kind: 'timeout' }))
  const result = await gateway.call('edu.reservation.classroom.create', {
    classroomId: 5,
    start: new Date(Date.UTC(2026, 8, 30, 5, 0)),
    end: new Date(Date.UTC(2026, 8, 30, 6, 0)),
  })
  assert.equal(result.verdict, 'UNKNOWN')
  assert.equal(result.reasonCode, 'no-response')
  assert.equal(result.ruleRow, 'W11')
  assert.equal(transport.callsTo('/reservations/classrooms').length, 1)
})

test('写接口 200+409：UNKNOWN + 歧义标记，不重试（W2）', async () => {
  const { gateway, transport } = makeGateway(() => envelope(409, '该时间段内教室已被整间预约'))
  const result = await gateway.call('edu.reservation.classroom.create', {
    classroomId: 5,
    start: new Date(Date.UTC(2026, 8, 30, 5, 0)),
    end: new Date(Date.UTC(2026, 8, 30, 6, 0)),
  })
  assert.equal(result.verdict, 'UNKNOWN')
  assert.equal(result.ambiguous, true)
  assert.equal(result.ruleRow, 'W2')
  assert.equal(transport.callsTo('/reservations/classrooms').length, 1)
})

test('W13 分叉走通：补偿撤销收到 200+404 → UNKNOWN（进 recordId 查证），创建类 → FAILURE', async () => {
  const cancelCase = makeGateway(() => envelope(404, '记录不存在'))
  const cancelResult = await cancelCase.gateway.call('edu.reservation.cancel', { recordId: 999 })
  assert.equal(cancelResult.verdict, 'UNKNOWN')
  assert.equal(cancelResult.reasonCode, 'compensation-verify')
  assert.equal(cancelResult.ruleRow, 'W13')

  const createCase = makeGateway(() => envelope(404, '教室不存在'))
  const createResult = await createCase.gateway.call('edu.reservation.classroom.create', {
    classroomId: 999,
    start: new Date(Date.UTC(2026, 8, 30, 5, 0)),
    end: new Date(Date.UTC(2026, 8, 30, 6, 0)),
  })
  assert.equal(createResult.verdict, 'FAILURE')
  assert.equal(createResult.reasonCode, 'resource-not-found')
})

test('initiator 身份：mine 查证必须用登录者本人；没有登录用户即本地报错（不借用任何身份）', async () => {
  const { gateway, transport } = makeGateway(() => ok([]))
  const result = await gateway.call('edu.reservation.mine', {})
  assert.equal(result.verdict, 'SUCCESS')
  const readCall = transport.callsTo('/reservations')[0]
  assert.equal(readCall.headers.Authorization, 'Bearer tok-233') // 登录用户 233 本人的令牌

  // 无登录用户的网关：initiator 调用必须在本地被拒（I5：无权限时不降级猜测、不借用服务身份）
  const anonymous = makeGateway(() => ok([]), { user: null })
  await assert.rejects(
    () => anonymous.gateway.call('edu.reservation.mine', {}),
    (err) => err instanceof ContactError && /登录者本人身份/.test(err.message),
  )
  assert.equal(anonymous.transport.callsTo('/reservations').length, 0) // 一个请求都没发出
})

test('写操作不得借用服务身份：有副作用的接口声明成 TEACHER/STUDENT 时本地拒绝（I5）', async () => {
  const { gateway, store, transport } = makeGateway(() => ok({}))
  const registry = store.registry.interfaces
  // 直接在内存里把写接口声明改成服务身份，验证守卫而不是靠"配置恰好写对"
  const target = registry.find((it) => it.id === 'edu.reservation.classroom.create')
  const original = target.requiredIdentity
  target.requiredIdentity = 'TEACHER'
  try {
    await assert.rejects(
      () =>
        gateway.call('edu.reservation.classroom.create', {
          classroomId: 5,
          start: new Date(Date.UTC(2026, 8, 30, 5, 0)),
          end: new Date(Date.UTC(2026, 8, 30, 6, 0)),
        }),
      (err) => err instanceof ContactError && /写操作只认登录者本人/.test(err.message),
    )
    assert.equal(transport.callsTo('/reservations/classrooms').length, 0)
  } finally {
    target.requiredIdentity = original
  }
})

test('M3 拦截在发出任何请求之前：参数不合格时零 HTTP', async () => {
  const { gateway, transport } = makeGateway(() => ok([]))
  await assert.rejects(
    () => gateway.call('edu.classroom.available', { building: '数智楼' }), // 缺 minCapacity
    ContactError,
  )
  await assert.rejects(
    () => gateway.call('logi.reservation.list', { keyword: '4' }), // keyword 禁用
    ContactError,
  )
  assert.equal(transport.calls.length, 0)
})

test('token 缓存：同一身份连续调用只登录一次；过期（含提前量）后主动重登', async () => {
  // 用注入时钟控制 freshness：30 分钟有效期、5 分钟提前量 → 26 分钟后必须重登
  const BASE = Date.UTC(2026, 9, 25, 8, 0, 0)
  let offsetMs = 0
  const clock = () => new Date(BASE + offsetMs)
  const { gateway, transport } = makeGateway(() => ok([]), { now: clock })

  await gateway.call('edu.classroom.detail', { classroomId: 5 })
  assert.equal(transport.callsTo('/auth/login').length, 1)

  offsetMs = 10 * 60 * 1000 // 10 分钟后：缓存仍新鲜
  await gateway.call('edu.classroom.detail', { classroomId: 5 })
  assert.equal(transport.callsTo('/auth/login').length, 1)

  offsetMs = 26 * 60 * 1000 // 26 分钟后：超过 (30-5) 分钟新鲜窗
  await gateway.call('edu.classroom.detail', { classroomId: 5 })
  assert.equal(transport.callsTo('/auth/login').length, 2)
})

test('凭证不泄漏：token/密码不出现在结果与证据链导出中（验收③）', async () => {
  // 恶意假设：响应体里带了 token 形态的字符串，也会被清洗
  const leakyBody = '{"code":200,"message":"ok","data":{"note":"x","token":"sk-should-not-leak-1"}}'
  const { gateway, chain } = makeGateway(() => ok({ note: 'x' }, leakyBody))
  const result = await gateway.call('logi.maintenance.list', { classroomId: 5 })

  assert.equal(result.verdict, 'SUCCESS')
  const exported = JSON.stringify(chain.exportChain())
  assert.ok(!exported.includes('sk-should-not-leak-1'))
  assert.ok(!exported.includes('test-pw-admin'))
  assert.ok(!exported.includes('tok-admin'))
  const entry = chain.getEntries().find((e) => e.action === 'contact:logi.maintenance.list')
  assert.ok(entry.metadata.rawFragment.includes('[已剔除]'))
})

test('登录响应体永不入证据链（其体内含 token）', async () => {
  const { gateway, chain } = makeGateway(() => ok([]))
  await gateway.call('logi.reservation.list', {})
  const exported = JSON.stringify(chain.exportChain())
  assert.ok(!exported.includes('tok-admin'))
  // 只有业务调用入链，登录动作不在链上
  assert.ok(!chain.getEntries().some((e) => e.action === 'contact:auth.login'))
})
