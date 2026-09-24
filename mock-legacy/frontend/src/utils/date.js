function pad(number) {
  return String(number).padStart(2, '0')
}

function parseUtcDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value !== 'string') return new Date(value)
  const normalized = value.includes('Z') || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`
  return new Date(normalized)
}

function formatInBeijing(date) {
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${values.year}年${Number(values.month)}月${Number(values.day)}日 ${values.hour}:${values.minute}:${values.second}`
}

export function formatDateTimeText(value) {
  const date = parseUtcDate(value)
  return date ? (formatInBeijing(date) || String(value)) : ''
}

export function formatLocalDateTimeText(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function parseUtcTime(value) {
  const date = parseUtcDate(value)
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
}

export function formatBeijingDate(value = new Date()) {
  const date = parseUtcDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function formatBeijingClock(value) {
  const date = parseUtcDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${values.hour}:${values.minute}`
}

export function toUtcIsoString(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
