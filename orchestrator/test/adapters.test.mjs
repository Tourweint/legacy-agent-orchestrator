// 协议适配器测试 —— snake/camel 字段映射、时间口径（请求带 Z / 响应按 UTC 解释）、
// M3 式本地拦截（min_capacity 必填、building 必填、keyword 禁用）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigStore } from '../src/config/config-store.js'
import { ProtocolAdapters } from '../src/contact/adapters.js'
import { ContactError } from '../src/contact/contact-error.js'
import { interpretLegacyTimestamp } from '../src/canonical/time.js'

const store = new ConfigStore()
const adapters = new ProtocolAdapters({ configStore: store })
const iface = (id) => store.getInterface(id)

const START = new Date(Date.UTC(2026, 8, 30, 5, 0, 0)) // 北京 13:00
const END = new Date(Date.UTC(2026, 8, 30, 6, 0, 0)) // 北京 14:00

test('创建预约请求体按源码 @JsonProperty 走 snake_case，时间带 Z', () => {
  const wire = adapters.buildRequest(iface('edu.reservation.classroom.create'), {
    classroomId: 4,
    start: START,
    end: END,
    reason: '教学活动',
  })
  assert.equal(wire.method, 'POST')
  assert.equal(wire.path, '/reservations/classrooms')
  assert.deepEqual(wire.body, {
    classroom_id: 4,
    start_time: '2026-09-30T05:00:00Z',
    end_time: '2026-09-30T06:00:00Z',
    reason: '教学活动',
  })
})

test('座位预约与教室创建字段不同（seat_id），不得共用形状', () => {
  const wire = adapters.buildRequest(iface('edu.reservation.seat.create'), {
    seatId: 309,
    start: START,
    end: END,
  })
  assert.deepEqual(wire.body, {
    seat_id: 309,
    start_time: '2026-09-30T05:00:00Z',
    end_time: '2026-09-30T06:00:00Z',
  })
})

test('时段占用查询：路径参数展开 + 查询参数 start_time/end_time', () => {
  const wire = adapters.buildRequest(iface('edu.classroom.reservedSeats'), {
    classroomId: 4,
    start: START,
    end: END,
  })
  assert.equal(wire.path, '/classrooms/4/reserved_seats')
  assert.deepEqual(wire.query, { start_time: '2026-09-30T05:00:00Z', end_time: '2026-09-30T06:00:00Z' })
})

test('撤销请求按 recordId 展开 DELETE 路径', () => {
  const wire = adapters.buildRequest(iface('edu.reservation.cancel'), { recordId: 115 })
  assert.equal(wire.method, 'DELETE')
  assert.equal(wire.path, '/reservations/115')
})

test('M3 拦截：available_list 缺 min_capacity / 缺 building 时请求根本不构造', () => {
  assert.throws(
    () => adapters.buildRequest(iface('edu.classroom.available'), { building: '数智楼' }),
    (err) => err instanceof ContactError && /minCapacity/.test(err.message),
  )
  assert.throws(
    () => adapters.buildRequest(iface('edu.classroom.available'), { minCapacity: 48 }),
    (err) => err instanceof ContactError && /building/.test(err.message),
  )
})

test('M3 拦截：管理端预约列表禁止 keyword 参数', () => {
  assert.throws(
    () => adapters.buildRequest(iface('logi.reservation.list'), { keyword: '4' }),
    (err) => err instanceof ContactError && /keyword/.test(err.message),
  )
  // 不带参数（唯一可靠用法）正常构造
  const wire = adapters.buildRequest(iface('logi.reservation.list'), {})
  assert.equal(wire.path, '/admin/reservations')
})

test('时间参数必须是绝对时刻（Date）——字符串拒绝，时区解释权不回流调用方', () => {
  assert.throws(
    () => adapters.buildRequest(iface('edu.classroom.reservedSeats'), { classroomId: 4, start: '2026-09-30T05:00:00Z', end: END }),
    ContactError,
  )
})

test('响应归一化：出参无时区时间字符串按 UTC 解释为绝对时刻', () => {
  const rows = [
    {
      id: 118,
      userId: 3,
      username: '233',
      resourceType: 'CLASSROOM',
      resourceId: 5,
      resourceName: '数智楼 123',
      reserveDate: '2026-09-30',
      startTime: '2026-09-30T04:30:00',
      endTime: '2026-09-30T06:00:00',
      reason: '教学',
      status: 'ACTIVE',
    },
  ]
  const normalized = adapters.normalizeData(iface('logi.reservation.list'), rows)
  assert.equal(normalized[0].recordId, 118)
  assert.equal(normalized[0].start.getTime(), Date.UTC(2026, 8, 30, 4, 30))
  assert.equal(normalized[0].end.getTime(), Date.UTC(2026, 8, 30, 6, 0))
  assert.equal(normalized[0].status, 'ACTIVE')
})

test('响应归一化：创建成功 data 即记录 id；座位占用返回座位 id 数组', () => {
  assert.deepEqual(adapters.normalizeData(iface('edu.reservation.classroom.create'), 115), { recordId: 115 })
  const seats = adapters.normalizeData(iface('edu.classroom.reservedSeats'), [309, 310])
  assert.deepEqual(seats, { seatIds: [309, 310], occupiedSeatCount: 2 })
})

test('extractSignals：envelope 提取业务码；非对象体判 code 缺失', () => {
  const good = adapters.extractSignals({
    kind: 'response',
    httpStatus: 200,
    json: { code: 409, message: '冲突', data: null },
    bodyText: '{}',
  })
  assert.equal(good.businessCode, 409)
  assert.equal(good.hasData, false)

  const broken = adapters.extractSignals({ kind: 'response', httpStatus: 200, json: [1, 2], bodyText: '[1,2]' })
  assert.equal(broken.businessCode, null) // 数组不是约定 envelope → W6

  const none = adapters.extractSignals({ kind: 'timeout' })
  assert.equal(none.transportKind, 'timeout')
  assert.equal(none.httpStatus, null)
})

test('时间归一化与 canonical/time 同源：同一字符串两种解释下结论不同的陷阱不会重现', () => {
  // 归一化出的绝对时刻参与重叠判定时，与直接用 interpretLegacyTimestamp 的结果一致
  const row = { startTime: '2026-09-30T04:30:00' }
  const normalized = adapters.normalizeData(iface('edu.reservation.mine'), [row])
  assert.equal(
    normalized[0].start.getTime(),
    interpretLegacyTimestamp('2026-09-30T04:30:00').getTime(),
  )
})
