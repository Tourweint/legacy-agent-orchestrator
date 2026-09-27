// 时间口径模块 —— 第 13 章阶段 0 交付物 1
//
// 规格：第 06 章 §6.3（五条）+ 第 08 章 §7.2（五条纪律，K2 拍板值）。
// 这是全系统唯一允许解析时间字符串的地方（第 13 章 阶段 0 禁止项 ②）。
//
// 为什么这个模块必须单独存在：存量系统出参是"无时区标记但真实语义是 UTC"的字符串
// （第 06 章 §6.1 实测链路）。若按本地时区解析，错误不报错、只会算错——时段重叠判定
// 失效 → 查证查不到 → 判"未生效" → 重复提交。这是本项目最隐蔽的错误源。
//
// 对上层的契约（第 13 章 阶段 0）：只暴露语义化操作，不暴露时区概念；
// "部署地时区"这一个概念只存在于本模块入口，由 constants.yaml 注入。

const MINUTE_MS = 60_000

const WEEKDAY_ZH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 } // 1=周一 … 7=周日

// 时段词别名 → 三段区间的常量键。既用于"整串就是时段词"（"下午"），
// 也用于精确钟点的前缀消歧（"下午两点"里的"下午"）。
const SEGMENT_KEY_ALIASES = {
  morning: 'morning',
  上午: 'morning',
  早上: 'morning',
  早晨: 'morning',
  清晨: 'morning',
  afternoon: 'afternoon',
  下午: 'afternoon',
  午后: 'afternoon',
  evening: 'evening',
  晚上: 'evening',
  傍晚: 'evening',
  夜里: 'evening',
  夜晚: 'evening',
}

export class TimeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TimeError'
  }
}

function assertOptions(options) {
  const tz = options?.deployTimeZone
  if (!tz || typeof tz.offsetMinutes !== 'number') {
    throw new TimeError('缺少部署地时区配置（constants.yaml 的 time.deployTimeZone）')
  }
  return tz.offsetMinutes * MINUTE_MS
}

// 绝对时刻 → 该时区墙钟分解（内部用 UTC getter 读加偏移后的值，避免任何平台本地时区参与运算）
function wallParts(date, offsetMs) {
  const shifted = new Date(date.getTime() + offsetMs)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    isoWeekday: (shifted.getUTCDay() + 6) % 7, // 周一=0 … 周日=6
  }
}

// 墙钟分解 → 绝对时刻（唯一一处把"部署地墙钟"换算成绝对时刻的地方）
function wallToInstant({ year, month, day, hour = 0, minute = 0, second = 0 }, offsetMs) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// ---- 语义化操作 ----

/**
 * 把存量系统的出参时间字符串变成绝对时刻。
 * 无时区标记的字符串一律按 UTC 解释（第 06 章 §6.3 规格 1）——
 * 已带 Z/偏移的按其自身偏移；数字按 epoch 毫秒。
 */
export function interpretLegacyTimestamp(value) {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value !== 'string') throw new TimeError(`无法解释的时间值: ${String(value)}`)
  const s = value.trim()
  const hasOffset = /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)
  const bare = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?$/
  let candidate = s
  if (!hasOffset) {
    if (!bare.test(s)) throw new TimeError(`无法解释的时间字符串: ${s}`)
    // 关键一行：无标记 → 补 Z。按本地解释是本项目明令禁止的错误源（第 06 章 §6.2）
    candidate = s.replace(' ', 'T') + (s.length === 10 ? 'T00:00:00' : '') + 'Z'
  }
  const date = new Date(candidate)
  if (Number.isNaN(date.getTime())) throw new TimeError(`时间字符串不是合法时刻: ${s}`)
  return date
}

/**
 * 把绝对时刻构造成存量系统入参要求的带 Z 时刻字符串（第 06 章 §6.3 规格 2）。
 */
export function formatLegacyTimestamp(instant) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TimeError('formatLegacyTimestamp 需要一个绝对时刻（Date）')
  }
  const p = wallParts(instant, 0) // 偏移 0 = 直接读 UTC 分量
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}Z`
  )
}

/**
 * 时段重叠判定（第 06 章 §6.4，C8 实测定论）：
 * 严格不等号——已有.start < 申请.end AND 已有.end > 申请.start，边界相等不算重叠。
 * 紧邻预约（上一场 14:00 结束、下一场 14:00 开始）是允许的，不得加等号。
 */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  for (const d of [aStart, aEnd, bStart, bEnd]) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      throw new TimeError('rangesOverlap 的四个参数都必须是绝对时刻（Date）')
    }
  }
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

/**
 * 把模糊日期表达（原话片段，理解层原样存槽位、不做换算）解析成日期。
 * 解释锚点 = 部署地时区墙钟（K2）；"当前时刻"必须显式传入（纪律 2，可复现可回归）。
 * 推算成功也返回 needsConfirm: true（§7.3"请确认"——让推断错误可被发现）。
 */
export function resolveDatePhrase(phrase, now, options) {
  const offset = assertOptions(options)
  if (typeof phrase !== 'string' || !phrase.trim()) throw new TimeError('日期表达为空')
  const text = phrase.trim()
  const today = wallParts(now, offset)

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    // 显式日期：无推断，无需确认
    return { dateYmd: text, needsConfirm: false, explanations: [`显式日期 ${text}`] }
  }

  const todayYmd = `${today.year}-${pad(today.month)}-${pad(today.day)}`

  // 显式中文日期："10月1日""9月30号""10月1"——年份没说就是推断，故 needsConfirm（§7.3）
  const monthDay = /^(\d{1,2})月(\d{1,2})[日号]?$/.exec(text)
  if (monthDay) {
    const month = Number(monthDay[1])
    const day = Number(monthDay[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new TimeError(`不是合法的日期: ${text}`)
    }
    const thisYear = `${today.year}-${pad(month)}-${pad(day)}`
    const nextYear = `${today.year + 1}-${pad(month)}-${pad(day)}`
    // 规则：没说年份 → 取最近的一个将来（今年的该日期已过则取明年）
    const dateYmd = thisYear < todayYmd ? nextYear : thisYear
    return {
      dateYmd,
      needsConfirm: true,
      explanations: [
        thisYear < todayYmd
          ? `「${text}」没说是哪一年；今年的 ${month} 月 ${day} 日已过 → 取明年的 ${dateYmd}`
          : `「${text}」没说是哪一年 → 取今年的 ${dateYmd}`,
      ],
    }
  }

  let deltaDays = null
  let rule = null

  if (text === '今天') {
    deltaDays = 0
    rule = '「今天」以部署地零点为界'
  } else if (text === '明天') {
    deltaDays = 1
    rule = '「明天」= 今天 + 1 天'
  } else if (text === '后天') {
    deltaDays = 2
    rule = '「后天」= 今天 + 2 天'
  } else if (text === '大后天') {
    deltaDays = 3
    rule = '「大后天」= 今天 + 3 天'
  } else {
      const weekMatch = /^(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])$/.exec(text)
      if (weekMatch) {
        const targetIso = WEEKDAY_ZH[weekMatch[2]] - 1 // 周一=0 … 周日=6
        const prefix = weekMatch[1] || ''
        if (prefix === '下' || prefix === '下下') {
          // 下周X：先推到下一个周一，再加目标日偏移（K2：当天即周X时取下一个周X）
          const weekShift = prefix === '下下' ? 1 : 0
          const daysToNextMonday = ((7 - today.isoWeekday) % 7) || 7
          deltaDays = daysToNextMonday + 7 * weekShift + targetIso
          rule = `「${prefix}周${weekMatch[2]}」= 下一个${prefix === '下下' ? '下下周' : '下周'}的周${weekMatch[2]}`
        } else {
          // 周X / 本周X / 这周X：最近的一个（含今天）
          deltaDays = (targetIso - today.isoWeekday + 7) % 7
          rule = `「${text}」= 最近的一个周${weekMatch[2]}`
        }
      }
  }

  if (deltaDays === null) {
    throw new TimeError(`无法解释的日期表达: ${text}（规则集外的表达只能追问，不得猜测）`)
  }

  const target = wallToInstant(
    { year: today.year, month: today.month, day: today.day + deltaDays },
    offset,
  )
  const tp = wallParts(target, offset)
  const dateYmd = `${tp.year}-${pad(tp.month)}-${pad(tp.day)}`
  return {
    dateYmd,
    needsConfirm: true,
    explanations: [
      `今天是周${'一二三四五六日'[today.isoWeekday]}（${today.year}-${pad(today.month)}-${pad(today.day)}），${rule} → ${dateYmd}`,
    ],
  }
}

/**
 * 把三段时段表达（上午/下午/晚上）解析成该日期上的绝对时刻区间。
 * 三段区间来自常量集合（K2 拍板值），不在代码里硬编码。
 */
export function resolveTimeSegment(segmentName, dateYmd, options) {
  const offset = assertOptions(options)
  const segments = options?.segments
  if (!segments) throw new TimeError('缺少三段区间常量（constants.yaml 的 time.segments）')
  const key = SEGMENT_KEY_ALIASES[segmentName]
  if (!key) throw new TimeError(`无法解释的时段表达: ${segmentName}`)
  const seg = segments[key]
  if (!seg?.start || !seg?.end) throw new TimeError(`时段常量不完整: ${key}`)

  const [year, month, day] = dateYmd.split('-').map(Number)
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const dayStart = wallToInstant({ year, month, day }, offset)
  const start = new Date(dayStart.getTime() + toMinutes(seg.start) * MINUTE_MS)
  const end = new Date(dayStart.getTime() + toMinutes(seg.end) * MINUTE_MS)
  // K2："晚上"不跨零点——三段常量本身都在自然日内，这里防御性再确认一次
  if (end.getTime() <= start.getTime()) {
    throw new TimeError(`时段常量跨零点（禁止）: ${key} ${seg.start}–${seg.end}`)
  }
  return {
    start,
    end,
    needsConfirm: true,
    // 文案是要给用户看的（"请确认"注记）：不写内部决策编号（零术语纪律）
    explanations: [`「${segmentName}」= ${seg.start}–${seg.end}（按部署地时间）`],
  }
}

// ---- 精确钟点表达（"一点到三点" / "14:00-16:00"）—— 第 08 章 §7.1 第二类 ----
//
// 为什么必须有这一段：意图计划的槽位提示与第 08 章 §7.1 表格**都已向用户承诺**
// "上午八点到十点"这类精确说法，而此前只实现了三段（上午/下午/晚上）——用户说精确区间
// 会被判"规则外"而追问，等于系统说得出、却听不懂。这里把承诺补齐。
//
// 纪律不变（第 08 章 §7.2）：纯函数、不查网络；规则外表达抛错追问，绝不猜；
// 推算成功一律 needsConfirm（§7.3）。全程只有一条"推断"，且它本身是一条可写下来的规则：
// 没说上午还是下午时（"两点到四点"），取唯一落在存量系统可预约窗口内的那个解释。

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 带 kind 的时间错误：调用方据 kind 分派追问话术（unparsed / range-incomplete）。 */
function timeError(message, kind = 'unparsed') {
  const err = new TimeError(message)
  err.kind = kind
  return err
}

/** 中文/阿拉伯小数字（"两""十""十五""二十三"/"8"）→ 数字；超范围返回 null。 */
function parseSmallNumber(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  if (/^\d{1,2}$/.test(s)) return Number(s)
  if (/^十[一二三四五六七八九]?$/.test(s)) return 10 + (s === '十' ? 0 : CN_DIGIT[s[1]])
  if (/^[一二两三四五六七八九]十[一二三四五六七八九]?$/.test(s)) {
    const tens = CN_DIGIT[s[0]] * 10
    return s.length === 2 ? tens : tens + CN_DIGIT[s[2]]
  }
  if (s.length === 1 && s in CN_DIGIT) return CN_DIGIT[s]
  return null
}

// 钟点短语：[时段词] + 钟点 + 分隔符（点/时/:/：）+ 可选分钟（"半"或数字）
const CLOCK_PHRASE_RE =
  /^(上午|早上|早晨|清晨|下午|午后|晚上|傍晚|夜里|夜晚)?(\d{1,2}|[一二两三四五六七八九十]{1,3})[点时:：](\d{1,2}|[一二两三四五六七八九十]{1,3}|半)?分?$/

/**
 * 解析一个钟点短语 → { hour, minute, segmentWord }；不是钟点短语则返回 null。
 * 只做词法，不做 12/24 小时消歧——那需要窗口常量，在 clockToMinutes 里做。
 */
function parseClockPhrase(text) {
  const m = CLOCK_PHRASE_RE.exec(text)
  if (!m) return null
  if (m[3] === undefined && /[:：]/.test(m[0])) return null // "14:" 这类残句不接受
  const hour = parseSmallNumber(m[2])
  if (hour === null || hour > 23) return null
  const rawMinute = m[3]
  const minute = rawMinute === '半' ? 30 : rawMinute === undefined ? 0 : parseSmallNumber(rawMinute)
  if (minute === null || minute > 59) return null
  return { hour, minute, segmentWord: m[1] ?? null }
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

function minutesToHhmm(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** 可预约窗口（常量）→ 分钟数；缺常量时抛错——不猜窗口。 */
function bookableWindowMinutes(options) {
  const window = options?.legacyBookableWindow
  if (!window?.start || !window?.end) {
    throw timeError('缺少存量系统可预约窗口常量（constants.yaml 的 time.legacyBookableWindow）')
  }
  return { start: hhmmToMinutes(window.start), end: hhmmToMinutes(window.end) }
}

function inWindow(minutes, window) {
  return minutes >= window.start && minutes <= window.end
}

/** 钟点短语 → 该日零时起的分钟数（含 12/24 小时消歧）。 */
function clockToMinutes(clock, options) {
  const { hour, minute, segmentWord } = clock
  const key = segmentWord ? SEGMENT_KEY_ALIASES[segmentWord] : null
  if (segmentWord && !key) throw timeError(`无法解释的时段词: ${segmentWord}`)
  if (key === 'morning') {
    if (hour > 12) throw timeError(`「${segmentWord}${hour}点」不成立——上午不会有 ${hour} 点`)
    return hour * 60 + minute
  }
  if (key === 'afternoon') return (hour < 12 ? hour + 12 : hour) * 60 + minute
  if (key === 'evening') {
    if (hour === 12) throw timeError('「晚上十二点」会跨到第二天——本系统只办理当天内的时段')
    return (hour < 12 ? hour + 12 : hour) * 60 + minute
  }
  // 无时段词：唯一规则——原值不在窗口内而 +12 小时落在窗口内时，取 +12。
  // 例："两点" → 14:00（凌晨两点不在 07:00–22:30）；"八点" → 08:00（已在窗口内，不动）。
  const window = bookableWindowMinutes(options)
  const asIs = hour * 60 + minute
  if (inWindow(asIs, window)) return asIs
  const lifted = asIs + 12 * 60
  if (hour <= 11 && inWindow(lifted, window)) return lifted
  throw timeError(
    `「${hour}点」不在可预约时段 ${minutesToHhmm(window.start)}–${minutesToHhmm(window.end)} 内`,
  )
}

const RANGE_SEPARATOR_RE = /\s*(?:到|至|~|～|—|–|－|-)\s*/

function parseClockRange(text) {
  const parts = text.replace(/^从/, '').split(RANGE_SEPARATOR_RE)
  if (parts.length !== 2) return null
  const start = parseClockPhrase(parts[0])
  const end = parseClockPhrase(parts[1])
  if (!start || !end) return null
  return { start, end }
}

function buildClockRange(range, text, dateYmd, options) {
  let startMin = clockToMinutes(range.start, options)
  let endMin = clockToMinutes(range.end, options)
  if (endMin <= startMin) {
    // "六点到八点"：结束点没带时段词时可能被窗口消歧成偏小的值——整体后移半天再试一次
    const window = bookableWindowMinutes(options)
    const lifted = endMin + 12 * 60
    if (!range.end.segmentWord && lifted > startMin && inWindow(lifted, window)) endMin = lifted
    else throw timeError(`「${text}」的结束时间不晚于开始时间（本系统只办理当天内的时段）`)
  }
  const [year, month, day] = String(dateYmd).split('-').map(Number)
  const dayStart = wallToInstant({ year, month, day }, assertOptions(options))
  const explanations = [`「${text}」= ${minutesToHhmm(startMin)}–${minutesToHhmm(endMin)}（按部署地时间）`]
  if (!range.start.segmentWord && !range.end.segmentWord) {
    const window = bookableWindowMinutes(options)
    explanations.push(
      `没说上午/下午，按可预约时段 ${minutesToHhmm(window.start)}–${minutesToHhmm(window.end)} 判断为 ${minutesToHhmm(startMin)} 起`,
    )
  }
  return {
    start: new Date(dayStart.getTime() + startMin * MINUTE_MS),
    end: new Date(dayStart.getTime() + endMin * MINUTE_MS),
    needsConfirm: true,
    explanations,
  }
}

/**
 * 把时段原话解析成该日期上的绝对时刻区间（第 08 章 §7.1 第二类的完整实现）。
 * 三类说法：① 三段词"下午" ② 精确区间"14点到16点""下午两点到四点" ③ 单点"下午两点"。
 * ③ 只说开始不说结束 → 抛 kind='range-incomplete'，由调用方追问时长（不猜默认时长）；
 * 规则外表达 → 抛 kind='unparsed'，追问，不得猜测。
 */
export function resolveTimePhrase(phrase, dateYmd, options) {
  const text = String(phrase ?? '').replace(/\s+/g, '')
  if (!text) throw timeError('时段表达为空')
  if (SEGMENT_KEY_ALIASES[text]) return resolveTimeSegment(text, dateYmd, options)
  const range = parseClockRange(text)
  if (range) return buildClockRange(range, text, dateYmd, options)
  if (parseClockPhrase(text)) {
    throw timeError(`「${text}」只说了开始时间，没说到几点结束`, 'range-incomplete')
  }
  throw timeError(`无法解释的时间表达: ${text}（规则集外的表达只能追问，不得猜测）`)
}

/**
 * 语义化组合：模糊日期 + 时段 → 绝对时刻区间。
 * 输入的槽位必须是原话片段（理解层不做换算），换算全部在这里、可审计。
 */
export function resolveRelativeRange({ datePhrase, segmentName }, now, options) {
  const date = resolveDatePhrase(datePhrase, now, options)
  const segment = resolveTimePhrase(segmentName, date.dateYmd, options)
  return {
    start: segment.start,
    end: segment.end,
    dateYmd: date.dateYmd,
    needsConfirm: date.needsConfirm || segment.needsConfirm,
    explanations: [...date.explanations, ...segment.explanations],
  }
}

/**
 * 提交前的两条时间硬约束（J4/K2，第 08 章 §7.2 纪律 5）：
  * 预约不得跨北京自然日、开始时间必须在未来；另核可预约时段窗口（07:00–22:30）。
 * 返回 { ok, violations }，由调用方决定拦截方式——本模块不做业务决定。
 */
export function checkLegacyTimeConstraints({ start, end }, now, options) {
  const offset = assertOptions(options)
  const violations = []
  if (!isSameCalendarDay(start, end, options)) {
    violations.push('预约不得跨自然日（以部署地日期为准）')
  }
  if (!startsInFuture(start, now)) {
    violations.push('开始时间必须在未来')
  }
  const window = options?.legacyBookableWindow
  if (window?.start && window?.end) {
    const toMinutes = (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number)
      return h * 60 + m
    }
    const wall = (instant) => {
      const p = wallParts(instant, offset)
      return p.hour * 60 + p.minute
    }
    const wStart = toMinutes(window.start)
    const wEnd = toMinutes(window.end)
    if (wall(start) < wStart || wall(end) > wEnd) {
      violations.push(`时段超出存量系统可预约窗口 ${window.start}–${window.end}`)
    }
  }
  return { ok: violations.length === 0, violations }
}

/** 是否同一部署地自然日（J4：预约不得跨北京自然日）。 */
export function isSameCalendarDay(a, b, options) {
  const offset = assertOptions(options)
  const pa = wallParts(a, offset)
  const pb = wallParts(b, offset)
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day
}

/** 开始时刻是否在未来（严格大于；等于"现在"不算未来）。 */
export function startsInFuture(start, now) {
  return start.getTime() > now.getTime()
}

/**
 * 展示层的单向转换：绝对时刻 → 部署地墙钟文字（第 06 章 §6.3 规格 4/5）。
 * 这是唯一允许出现"本地时间"字样的出口，且只用于展示、永不回流参与判定。
 */
export function toDisplayText(instant, options) {
  const offset = assertOptions(options)
  const p = wallParts(instant, offset)
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

/** 区间的人可读文字（第 13 章 阶段 0 契约示例："把这个范围变成人可读的文字"）。 */
export function describeRange(start, end, options) {
  const offset = assertOptions(options)
  const ps = wallParts(start, offset)
  const pe = wallParts(end, offset)
  const sameDay =
    ps.year === pe.year && ps.month === pe.month && ps.day === pe.day
  const day = `${ps.year}-${pad(ps.month)}-${pad(ps.day)}`
  const from = `${pad(ps.hour)}:${pad(ps.minute)}`
  const to = `${pad(pe.hour)}:${pad(pe.minute)}`
  const toDay = sameDay ? '' : `（至 ${pe.year}-${pad(pe.month)}-${pad(pe.day)}）`
  return `${day} ${from}–${to}${toDay}`
}
