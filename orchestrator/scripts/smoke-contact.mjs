// 接触层真实冒烟 —— 对在线存量系统做最小充分验证（阶段 1：先能真实调通一个只读接口）。
//
// 前置：
//   1. 存量系统已启动（地址来自 constants.yaml 的 contact 节，缺省指向本机 8080；
//      启动方式见 deploy/scripts/start-legacy.sh）
//   2. 凭证以环境变量注入（密码绝不写进代码/文档/提交）：
//        ORCH_LEGACY_ADMIN_PASSWORD=...  ORCH_LEGACY_TEACHER_PASSWORD=...
// 用法示例：
//   ORCH_LEGACY_ADMIN_PASSWORD=admin ORCH_LEGACY_TEACHER_PASSWORD=233 node scripts/smoke-contact.mjs
//
// 冒烟步骤（全部只读，零副作用）：
//   ① ADMIN 登录 → 管理端预约全量列表（不带 keyword，验收"查证支点"可调）
//   ② TEACHER 登录 → 教室详情（数智楼 123，id=5，演示主角）
//   ③ 教室时段占用（reserved_seats，带 Z 的时间入参）

import { ConfigStore } from '../src/config/config-store.js'
import { HttpTransport } from '../src/contact/http-transport.js'
import { IdentityPool } from '../src/contact/identity-pool.js'
import { ProtocolAdapters } from '../src/contact/adapters.js'
import { ContactGateway } from '../src/contact/contact-gateway.js'
import { resolveRelativeRange, describeRange } from '../src/canonical/time.js'

const store = new ConfigStore()
const constants = store.getConstants()
const baseEnv = constants.contact.legacyBaseUrlEnv
const baseUrl = process.env[baseEnv] || constants.contact.legacyBaseUrlDefault

const missing = ['ORCH_LEGACY_ADMIN_PASSWORD', 'ORCH_LEGACY_TEACHER_PASSWORD'].filter((k) => !process.env[k])
if (missing.length > 0) {
  console.error(`缺少凭证环境变量: ${missing.join(', ')}`)
  console.error('用法示例：ORCH_LEGACY_ADMIN_PASSWORD=admin ORCH_LEGACY_TEACHER_PASSWORD=233 node scripts/smoke-contact.mjs')
  process.exit(1)
}

const transport = new HttpTransport({ baseUrl })
const adapters = new ProtocolAdapters({ configStore: store })
const pool = new IdentityPool({ configStore: store, transport, adapters, constants })
const gateway = new ContactGateway({ configStore: store, transport, identityPool: pool, adapters })

console.log(`存量系统：${baseUrl}`)

// ① ADMIN：管理端全量预约列表（查证支点）
const adminList = await gateway.call('logi.reservation.list', {})
console.log(`\n① logi.reservation.list（ADMIN）`)
console.log(`   verdict=${adminList.verdict} rule=${adminList.ruleRow} elapsed=${adminList.elapsedMs}ms`)
if (adminList.verdict === 'SUCCESS') {
  console.log(`   全量记录数=${adminList.data.length}（复位基线应为 86）`)
  const active = adminList.data.filter((r) => r.status === 'ACTIVE')
  console.log(`   其中 ACTIVE=${active.length}（J3 口径：查证比对仅计 ACTIVE）`)
} else {
  console.log(`   note=${adminList.note ?? ''}`)
}

// ② TEACHER：教室详情（实体消解 + status）
const detail = await gateway.call('edu.classroom.detail', { classroomId: 5 })
console.log(`\n② edu.classroom.detail（TEACHER，id=5 数智楼 123）`)
console.log(`   verdict=${detail.verdict} rule=${detail.ruleRow} elapsed=${detail.elapsedMs}ms`)
if (detail.verdict === 'SUCCESS') {
  console.log(`   ${detail.data.building} ${detail.data.roomNumber} 容量=${detail.data.capacity} status=${detail.data.status}`)
}

// ③ TEACHER：时段占用（明天下午，时间入参带 Z）
const timeOptions = { ...constants.time }
const range = resolveRelativeRange({ datePhrase: '明天', segmentName: '下午' }, new Date(), timeOptions)
const occupied = await gateway.call('edu.classroom.reservedSeats', {
  classroomId: 5,
  start: range.start,
  end: range.end,
})
console.log(`\n③ edu.classroom.reservedSeats（TEACHER，${describeRange(range.start, range.end, timeOptions)}）`)
console.log(`   verdict=${occupied.verdict} rule=${occupied.ruleRow} elapsed=${occupied.elapsedMs}ms`)
if (occupied.verdict === 'SUCCESS') {
  console.log(`   被占座位数=${occupied.data.occupiedSeatCount}（>0 即整间不可用；全量=歧义信号须交叉判定）`)
}
