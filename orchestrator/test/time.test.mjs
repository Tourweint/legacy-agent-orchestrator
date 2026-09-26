// 时间口径模块测试 —— 覆盖第 13 章 §六 阶段 0 验收：
// "构造一个'只在两种时区解释下结论不同'的用例，验证结果正确（第 06 章 §6.2）"

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigStore } from '../src/config/config-store.js'
import {
  interpretLegacyTimestamp,
  formatLegacyTimestamp,
  rangesOverlap,
  resolveDatePhrase,
  resolveTimeSegment,
  resolveTimePhrase,
  resolveRelativeRange,
  checkLegacyTimeConstraints,
  toDisplayText,
  describeRange,
  TimeError,
} from '../src/canonical/time.js'

const store = new ConfigStore()
const timeOptions = { ...store.getConstants().time }

test('出参无时区字符串按 UTC 解释——两种解释结论不同的验收用例', () => {
  // 场景（第 06 章 §6.2）：存量记录 2026-09-30T04:30:00 ~ 06:00:00（无标记，真实语义 UTC，
  // 即北京 12:30–14:00）。用户申请"下午"（13:00–17:00）。
  const recordStart = interpretLegacyTimestamp('2026-09-30T04:30:00')
  const recordEnd = interpretLegacyTimestamp('2026-09-30T06:00:00')
  const range = resolveRelativeRange(
    { datePhrase: '2026-09-30', segmentName: '下午' },
    interpretLegacyTimestamp('2026-09-29T00:00:00Z'),
    timeOptions,
  )

  // 正确口径（UTC 解释）：12:30–14:00 与 13:00–17:00 重叠 → 查证应命中
  assert.equal(rangesOverlap(recordStart, recordEnd, range.start, range.end), true)

  // 对照：若错误地按东八区解释出参（04:30→北京 04:30），则与"下午"不重叠 →
  // 会误判"未生效"并重复提交。这正是本模块要消灭的静默错误。
  const naiveStart = new Date(recordStart.getTime() - 8 * 3_600_000)
  const naiveEnd = new Date(recordEnd.getTime() - 8 * 3_600_000)
  assert.equal(rangesOverlap(naiveStart, naiveEnd, range.start, range.end), false)
})

test('展示层单向转本地：UTC 出参在北京墙钟下显示 12:30', () => {
  const instant = interpretLegacyTimestamp('2026-09-30T04:30:00')
  assert.equal(toDisplayText(instant, timeOptions), '2026-09-30 12:30')
})

test('入参必须显式构造带 Z 的时刻', () => {
  const instant = new Date(Date.UTC(2026, 8, 30, 4, 30, 0))
  assert.equal(formatLegacyTimestamp(instant), '2026-09-30T04:30:00Z')
})

test('时段重叠不含边界（C8 实测：紧邻允许、交叉冲突）', () => {
  const t = (s) => interpretLegacyTimestamp(s)
  // 已有 13:00–14:00（北京）= 05:00Z–06:00Z
  const aStart = t('2026-09-30T05:00:00Z')
  const aEnd = t('2026-09-30T06:00:00Z')
  // 紧邻 14:00–15:00：边界相等不算重叠（存量系统实测接受紧邻预约 #116）
  assert.equal(rangesOverlap(aStart, aEnd, t('2026-09-30T06:00:00Z'), t('2026-09-30T07:00:00Z')), false)
  // 交叉 13:30–14:30：重叠（实测返回 409）
  assert.equal(rangesOverlap(aStart, aEnd, t('2026-09-30T05:30:00Z'), t('2026-09-30T06:30:00Z')), true)
})

test('三段区间为 K2 拍板常量（下午 = 13:00–17:00 部署地墙钟）', () => {
  const seg = resolveTimeSegment('下午', '2026-09-30', timeOptions)
  assert.equal(toDisplayText(seg.start, timeOptions), '2026-09-30 13:00')
  assert.equal(toDisplayText(seg.end, timeOptions), '2026-09-30 17:00')
  assert.equal(seg.needsConfirm, true) // §7.3：推算成功也要"请确认"
})

test('下周三：当天即周三时取下一个周三（K2 边界）', () => {
  // 2026-09-30 是周三：下周三 = 10-07
  const now = interpretLegacyTimestamp('2026-09-30T04:00:00Z')
  assert.equal(resolveDatePhrase('下周三', now, timeOptions).dateYmd, '2026-10-07')
  // 2026-09-25 是周五：下周三 = 下周一(09-28) + 2 = 09-30
  const friday = interpretLegacyTimestamp('2026-09-25T04:00:00Z')
  assert.equal(resolveDatePhrase('下周三', friday, timeOptions).dateYmd, '2026-09-30')
})

test('今天/明天按部署地零点为界；显式日期无需确认', () => {
  // 北京 2026-09-30 23:59（零点前一分钟）："今天" = 09-30
  const beforeMidnight = interpretLegacyTimestamp('2026-09-30T15:59:00Z')
  assert.equal(resolveDatePhrase('今天', beforeMidnight, timeOptions).dateYmd, '2026-09-30')
  // 北京 2026-10-01 00:00 整（零点边界）：以本地零点为界，"今天" 已翻到 10-01（K2 边界）
  const atMidnight = interpretLegacyTimestamp('2026-09-30T16:00:00Z')
  assert.equal(resolveDatePhrase('今天', atMidnight, timeOptions).dateYmd, '2026-10-01')
  const explicit = resolveDatePhrase('2026-10-14', beforeMidnight, timeOptions)
  assert.equal(explicit.dateYmd, '2026-10-14')
  assert.equal(explicit.needsConfirm, false)
})

test('规则集外的日期表达抛错（只能追问，不得猜测）', () => {
  assert.throws(() => resolveDatePhrase('大下下周', new Date(), timeOptions), TimeError)
})

test('提交前时间硬约束（J4：不跨自然日、开始在未来、落在可预约窗口）', () => {
  const now = interpretLegacyTimestamp('2026-09-29T00:00:00Z')
  const range = resolveRelativeRange(
    { datePhrase: '明天', segmentName: '下午' },
    now,
    timeOptions,
  )
  assert.deepEqual(checkLegacyTimeConstraints(range, now, timeOptions), { ok: true, violations: [] })

  // 跨自然日：北京 09-30 21:00 → 10-01 01:00
  const crossDay = {
    start: interpretLegacyTimestamp('2026-09-30T13:00:00Z'),
    end: interpretLegacyTimestamp('2026-09-30T17:00:00Z'),
  }
  const result = checkLegacyTimeConstraints(crossDay, now, timeOptions)
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.includes('跨自然日')))

  // 开始在过去
  const past = {
    start: interpretLegacyTimestamp('2026-09-25T05:00:00Z'),
    end: interpretLegacyTimestamp('2026-09-25T09:00:00Z'),
  }
  assert.equal(checkLegacyTimeConstraints(past, now, timeOptions).ok, false)
})

test('describeRange 输出人可读的部署地墙钟文字', () => {
  const text = describeRange(
    interpretLegacyTimestamp('2026-09-30T05:00:00Z'),
    interpretLegacyTimestamp('2026-09-30T06:00:00Z'),
    timeOptions,
  )
  assert.equal(text, '2026-09-30 13:00–14:00')
})

// ---- 精确钟点表达（第 08 章 §7.1 第二类："一点到三点" 此前被漏实现）----------------

const PH = '2026-09-30'
const span = (phrase) => {
  const r = resolveTimePhrase(phrase, PH, timeOptions)
  return `${describeRange(r.start, r.end, timeOptions)}`
}

test('精确区间：中文钟点、阿拉伯钟点、冒号钟点都能解析（第三条此前只会被追问）', () => {
  assert.equal(span('下午两点到四点'), '2026-09-30 14:00–16:00')
  assert.equal(span('上午八点到十点'), '2026-09-30 08:00–10:00')
  assert.equal(span('14点到16点'), '2026-09-30 14:00–16:00')
  assert.equal(span('14:00到16:00'), '2026-09-30 14:00–16:00')
  assert.equal(span('下午2点到4点半'), '2026-09-30 14:00–16:30')
  assert.equal(span('八点到十点'), '2026-09-30 08:00–10:00')
})

test('没说上午/下午时按可预约窗口消歧——这条推断写得出规则，故可测', () => {
  // 凌晨两点不在 07:00–22:30 内，而 14:00 在 → 取 14:00
  assert.equal(span('两点到四点'), '2026-09-30 14:00–16:00')
  // 八点已在窗口内 → 不动
  assert.equal(span('九点到十一点'), '2026-09-30 09:00–11:00')
  // "六点到八点"：开始点消歧成 18:00 后结束点跟着后移 → 18:00–20:00
  assert.equal(span('六点到八点'), '2026-09-30 18:00–20:00')
  // "一点到五点" 同理落在下午 → 13:00–17:00
  assert.equal(span('一点到五点'), '2026-09-30 13:00–17:00')
  // 规则外的时间段 → 不猜，抛错追问
  assert.throws(() => resolveTimePhrase('凌晨三点到五点', PH, timeOptions), TimeError)
})

test('只说开始没说结束 → 抛 range-incomplete，由调用方追问时长（不猜默认时长）', () => {
  assert.throws(
    () => resolveTimePhrase('下午两点', PH, timeOptions),
    (err) => err instanceof TimeError && err.kind === 'range-incomplete',
  )
  assert.throws(
    () => resolveTimePhrase('14:00', PH, timeOptions),
    (err) => err.kind === 'range-incomplete',
  )
})

test('时间规则外表达 → 抛 unparsed，不得猜测', () => {
  assert.throws(
    () => resolveTimePhrase('有空的时候', PH, timeOptions),
    (err) => err instanceof TimeError && err.kind === 'unparsed',
  )
  // 跨自然日（22:00 → 次日 02:00）：仍由硬约束拒绝，不在这里私自跨天
  assert.throws(() => resolveTimePhrase('22点到2点', PH, timeOptions), TimeError)
})

test('三段词的口语同义词（早上/傍晚）与既有三段同口径', () => {
  assert.equal(span('早上'), '2026-09-30 08:00–12:00')
  assert.equal(span('傍晚'), '2026-09-30 18:00–22:00')
})

test('显式中文日期："10月1日"这类提示词已承诺的说法不再落到追问', () => {
  const now = interpretLegacyTimestamp('2026-09-26T04:00:00Z') // 北京 09-26
  const pending = resolveDatePhrase('10月1日', now, timeOptions)
  assert.equal(pending.dateYmd, '2026-10-01')
  assert.equal(pending.needsConfirm, true) // 年份是推断 → 必须"请确认"
  // 今年的该日期已过 → 取明年（也是推断，同样要确认）
  assert.equal(resolveDatePhrase('9月1号', now, timeOptions).dateYmd, '2027-09-01')
  assert.equal(resolveDatePhrase('大后天', now, timeOptions).dateYmd, '2026-09-29')
  assert.equal(resolveDatePhrase('下星期天', now, timeOptions).dateYmd, '2026-10-04')
  assert.throws(() => resolveDatePhrase('13月1日', now, timeOptions), TimeError)
})
