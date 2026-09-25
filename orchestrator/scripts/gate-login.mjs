// 开工小 Gate 实测：登录与会话（G-登录）——第 13 章拓展方案三审 §八。
//
// 为什么有这个脚本：三审定下"先实测、后实现，不实测不许写该能力"。登录是所有写能力
// 的公共前置，且录制时最容易翻车的一条是"同一账号最多 3 个设备会话"。本脚本把"登录
// 契约与设备会话行为"一次问清，结论回填 registry legacyNotes 与能力清单 §六。
//
// 前置：
//   1. 存量系统在线（地址来自 constants.yaml 的 contact 节，不在代码里写地址字面量）
//   2. 凭证优先取环境变量；未设时回落到 start-all.bat 的演示账号默认值
//      （见 scripts/legacy-credentials.mjs 的说明——口令不在本文件里落值）
// 用法：
//   node scripts/gate-login.mjs
//
// 本脚本只做登录/登出/查会话，不改任何业务数据；结束时撤销自己创建的设备会话。
//
// ⚠️ 两条防呆纪律（2026-09-26 补，踩过坑）：
//   ① **全局看门狗**：默认 90 秒硬超时，到点打印"卡在哪一步"并以非零码退出——
//      绝不允许一个脚本无声无息地滚上几十分钟（曾因"边遍历边 push"死循环滚了 40 分钟）
//   ② **每步打印**：任何一步开始前先打印 [step]，这样"卡住"与"在干活"一眼可分

import { ConfigStore } from '../src/config/config-store.js'
import { HttpTransport } from '../src/contact/http-transport.js'
import { loadLegacyCredentials } from './legacy-credentials.mjs'

const store = new ConfigStore()
const constants = store.getConstants()
const baseEnv = constants.contact.legacyBaseUrlEnv
const baseUrl = process.env[baseEnv] || constants.contact.legacyBaseUrlDefault
const timeoutMs = 8000

// ── 看门狗：到点必停 ─────────────────────────────────────────────────────────
const DEADLINE_MS = Number(process.env.ORCH_GATE_DEADLINE_MS ?? 90_000)
let currentStep = '启动'
const watchdog = setTimeout(() => {
  console.error(`\n[watchdog] 超过 ${DEADLINE_MS}ms 未结束，强制退出。卡在：${currentStep}`)
  console.error('[watchdog] 若确有需要更长的时间，用 ORCH_GATE_DEADLINE_MS 调大——但先确认不是在死循环。')
  process.exit(2)
}, DEADLINE_MS)
watchdog.unref?.()

function step(text) {
  currentStep = text
  console.log(`\n[step] ${text}`)
}

const accounts = (() => {
  try {
    return loadLegacyCredentials()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
})()

const transport = new HttpTransport({ baseUrl })
/** 本次自己创建的设备会话：{account, deviceId, accessToken}——token 在登录时留存，清理时不再重登 */
const createdSessions = []

function req(args) {
  return transport.request({ ...args, timeoutMs })
}

function brief(res) {
  if (res.kind !== 'response') return `kind=${res.kind}`
  const j = res.json ?? {}
  const dataKeys = j.data && typeof j.data === 'object' ? Object.keys(j.data).join(',') : String(j.data)
  return `HTTP ${res.httpStatus} code=${j.code} msg=${j.message ?? ''} data{${dataKeys}}`
}

async function login(account, deviceId, { withDeviceHeader = true } = {}) {
  const headers = withDeviceHeader ? { 'X-Device-Id': deviceId, 'X-Device-Name': deviceId } : {}
  const res = await req({
    method: 'POST',
    path: '/auth/login',
    headers,
    body: { username: account.username, password: account.password },
  })
  if (withDeviceHeader && res.kind === 'response' && res.json?.data?.accessToken) {
    createdSessions.push({ account, deviceId, accessToken: res.json.data.accessToken })
  }
  return res
}

async function me(token, deviceId = 'gate-login-probe') {
  return req({
    method: 'GET',
    path: '/auth/me',
    headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId },
  })
}

async function devices(token) {
  return req({ method: 'GET', path: '/auth/devices', headers: { Authorization: `Bearer ${token}` } })
}

console.log(`存量系统：${baseUrl}`)
console.log(`看门狗：${DEADLINE_MS}ms（ORCH_GATE_DEADLINE_MS 可调）`)
console.log('='.repeat(72))

// ── ① 三账号登录：响应结构与字段 ─────────────────────────────────────────────
step('① 三账号登录响应结构')
const sessions = {}
for (const account of accounts) {
  const deviceId = `gate-login-${account.role.toLowerCase()}`
  const res = await login(account, deviceId)
  sessions[account.role] = { deviceId, res }
  console.log(`   ${account.role.padEnd(7)} ${brief(res)}（口令来源：${account.from}）`)
  if (res.kind === 'response' && res.json?.data) {
    const d = res.json.data
    console.log(`           字段：${Object.keys(d).join(', ')}`)
    console.log(`           accessToken=${typeof d.accessToken === 'string' ? `有(${d.accessToken.length}字符)` : d.accessToken}`
      + `  refreshToken=${typeof d.refreshToken === 'string' ? `有(${d.refreshToken.length}字符)` : d.refreshToken}`)
    const ui = d.userInfo ?? {}
    console.log(`           userInfo: role=${ui.role} creditLevel=${ui.creditLevel}`
      + ` maxSingle=${ui.maxSingleReservationMinutes} daily=${ui.dailyReservationLimitMinutes}`
      + ` seatAdvanceH=${ui.seatReservationAdvanceHours}`)
  }
}

// ── ② /auth/me ──────────────────────────────────────────────────────────────
step('② /auth/me（教师令牌）')
const teacher = sessions.TEACHER.res
const teacherToken = teacher.json?.data?.accessToken
if (teacherToken) {
  const res = await me(teacherToken)
  console.log(`   ${brief(res)}`)
  const ui = res.json?.data ?? {}
  console.log(`   role=${ui.role} nickname=${ui.nickname} creditLevel=${ui.creditLevel} maxSingle=${ui.maxSingleReservationMinutes}`)
}

// ── ③ /auth/refresh（关键：此前文档结论是"存量系统没有刷新令牌接口"）─────────
step('③ /auth/refresh（接口是否真实存在、是否轮换、新令牌是否可用）')
const refreshToken = teacher.json?.data?.refreshToken
if (!refreshToken) {
  console.log('   登录响应里没有 refreshToken → 刷新链路不成立（与一/二审结论一致）')
} else {
  const res = await req({
    method: 'POST',
    path: '/auth/refresh',
    headers: { 'X-Device-Id': sessions.TEACHER.deviceId, 'X-Device-Name': sessions.TEACHER.deviceId },
    body: { refreshToken },
  })
  console.log(`   ${brief(res)}`)
  const newToken = res.json?.data?.accessToken
  const newRefresh = res.json?.data?.refreshToken
  console.log(`   新 accessToken=${newToken ? '有' : '无'}；refreshToken 轮换=${newRefresh && newRefresh !== refreshToken ? '是' : '否/无'}`)
  if (newToken) {
    console.log(`   新 accessToken 调 /auth/me → ${brief(await me(newToken))}`)
  }
  const replay = await req({
    method: 'POST',
    path: '/auth/refresh',
    headers: { 'X-Device-Id': sessions.TEACHER.deviceId, 'X-Device-Name': sessions.TEACHER.deviceId },
    body: { refreshToken },
  })
  console.log(`   旧 refreshToken 再用一次 → ${brief(replay)}（判断是否一次性）`)
}

// ── ④ 设备会话上限与"被踢"表现 ──────────────────────────────────────────────
step('④ 设备会话：同 deviceId 重登 / 多 deviceId 挤占 / 被踢后的响应码')
const sameDeviceAgain = await login(accounts[1], sessions.TEACHER.deviceId)
console.log(`   同一 deviceId 再登录一次 → ${brief(sameDeviceAgain)}`)
console.log(`   首次登录的旧令牌此时还能用吗 → ${brief(await me(teacherToken))}`)

const deviceTokens = []
for (let i = 1; i <= 4; i += 1) {
  const deviceId = `gate-login-multi-${i}`
  const res = await login(accounts[1], deviceId)
  deviceTokens.push({ deviceId, token: res.json?.data?.accessToken })
  console.log(`   ${deviceId} → ${brief(res)}`)
}
// 用**最新**的会话查列表（最早的已被淘汰，用它查只会拿到 401——那本身也是"被踢"的证据）
const liveToken = deviceTokens[deviceTokens.length - 1].token
const deviceList = await devices(liveToken ?? teacherToken)
console.log(`   /auth/devices → ${brief(deviceList)}`
  + `${Array.isArray(deviceList.json?.data) ? `（${deviceList.json.data.length} 条：${deviceList.json.data.map((d) => d.deviceId).join(', ')}）` : ''}`)
for (const item of deviceTokens) {
  console.log(`   ${item.deviceId} 的令牌调 /auth/me → ${brief(await me(item.token))}`)
}

// ── ⑤ 缺设备头 ──────────────────────────────────────────────────────────────
step('⑤ 缺 X-Device-Id 登录（实现：deviceId 回落为 unknown-device）')
console.log(`   ${brief(await login(accounts[2], null, { withDeviceHeader: false }))}`)

// ── ⑥ 错误密码 ──────────────────────────────────────────────────────────────
step('⑥ 错误密码')
const badRes = await req({
  method: 'POST',
  path: '/auth/login',
  headers: { 'X-Device-Id': 'gate-login-bad', 'X-Device-Name': 'gate-login-bad' },
  body: { username: accounts[1].username, password: 'definitely-not-the-password' },
})
console.log(`   ${brief(badRes)}`)

// ── ⑦ 登出（用 refreshToken）后，access token 是否立即失效 ───────────────────
step('⑦ /auth/logout 后 access token 的表现')
const refreshToLogout = sameDeviceAgain.json?.data?.refreshToken
if (refreshToLogout) {
  console.log(`   登出 → ${brief(await req({ method: 'POST', path: '/auth/logout', body: { refreshToken: refreshToLogout } }))}`)
  console.log(`   登出后原 access token 调 /auth/me → ${brief(await me(sameDeviceAgain.json?.data?.accessToken))}`)
} else {
  console.log('   登录响应无 refreshToken，无法调用登出')
}

// ── 清理：撤销本次创建的所有设备会话 ────────────────────────────────────────
// ⚠️ 遍历的是**快照**，且用登录时留存的 token 撤销（不再重登）——2026-09-26 死循环的根因就是
// "在 for...of 遍历的同一数组里 push"，边遍历边追加会让循环永不结束。
step(`清理：撤销本次创建的 ${createdSessions.length} 个设备会话`)
const snapshot = [...createdSessions]
const seen = new Set()
for (const { account, deviceId, accessToken } of snapshot) {
  if (seen.has(deviceId)) continue
  seen.add(deviceId)
  const res = await req({
    method: 'DELETE',
    path: `/auth/devices/${encodeURIComponent(deviceId)}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  console.log(`   ${account.role}/${deviceId} → ${brief(res)}`)
}

clearTimeout(watchdog)
console.log(`\n完成（设备会话 ${seen.size} 个已撤销）。`)
