/**
 * 时间格式适配。
 *
 * 依据实测（智能体设计.md §2.2 S8）：
 *   存量系统**入参**用 OffsetDateTime（带 Z，如 2026-09-25T02:00:00Z），
 *   **出参**用 LocalDateTime（无时区，如 2026-09-25 10:00:00）。
 *   入参出参格式不一致，且出参丢失时区信息 —— 这是一处真实的协议异构。
 *
 * 处理口径（**已实测校正**）：
 *   - 出参的"无时区时间"实际是 **UTC 时刻**：源码在写入前做过 本地→UTC 转换，
 *     读取时直接把数据库里的 UTC 值原样返回（如 "2026-09-30T04:30:00" 对应北京时间 12:30）。
 *     ⚠️ 若按本地时区解释它，会与提交时使用的时间相差一个时区偏移，
 *     导致"时段是否重叠"的判定全部失效 —— 这是本项目踩过的一个真实坑。
 *   - 入参一律转成带 Z 的 ISO 串（存量系统按 UTC 解释）。
 *
 *   注意区分：**解析**按 UTC（还原真实时刻），**展示**按 config.timezone（用户看得懂）。
 */

import config from './config.js';

/** Date → 存量系统入参格式（带 Z，秒级） */
export function toOffsetDateTime(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error(`非法时间：${t}`);
  // 去掉毫秒，保留 Z 后缀，与存量系统入参形态一致
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 存量系统出参 → Date（按 **UTC** 解释无时区字符串，见文件头说明） */
export function fromLocalDateTime(s) {
  if (s == null) return null;
  if (s instanceof Date) return s;
  const str = String(s).trim();
  // 已带时区则直接解析
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str);
  // 无时区（"2026-09-30 04:30:00" / "2026-09-30T04:30:00"）→ 按 UTC 解释
  return new Date(`${str.replace(' ', 'T')}Z`);
}

/**
 * 把"某天 + 第 N 节"这类人类表达换算成具体时段。
 * 此为**槽位补全**的辅助工具，具体调度周次口径由 validator 依业务规则决定。
 * @param {Date} day            所在日
 * @param {number} slotStart    起始节次（1 起）
 * @param {number} slotEnd      结束节次（含）
 * @param {number} slotMinutes  每节时长（默认 45）
 * @param {number} dayStartHour 第 1 节开始的小时（默认 8）
 */
export function slotsToRange(day, slotStart, slotEnd, slotMinutes = 45, dayStartHour = 8) {
  const base = new Date(day);
  base.setHours(dayStartHour, 0, 0, 0);
  const start = new Date(base.getTime() + (slotStart - 1) * slotMinutes * 60_000);
  const end = new Date(base.getTime() + slotEnd * slotMinutes * 60_000);
  return { start, end };
}

/** 判断两个时段是否重叠（半开区间 [start, end)） */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

/**
 * 人类可读的时段描述，用于结果呈现与证据链。
 * 接受 Date 或存量系统的原始时间字符串 —— 字符串会被按 UTC 解析（见 fromLocalDateTime），
 * 再按 config.timezone 展示。**解析与展示必须分开**，否则会显示出错误的时刻。
 */
export function describeRange(start, end) {
  const toDate = (d) => (d instanceof Date ? d : fromLocalDateTime(d));
  const f = (d) => {
    const dt = toDate(d);
    if (!dt || Number.isNaN(dt.getTime())) return String(d ?? '');
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: config.timezone, month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(dt);
  };
  return `${f(start)} ~ ${f(end)}`;
}
