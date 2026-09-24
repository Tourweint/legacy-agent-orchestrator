/**
 * 槽位归一化 —— 把用户口语转成系统可计算的值。
 *
 * 设计依据：docs/基线文档/智能体设计.md §2.1 U1/U2
 *   「用户说'周三'，但没说是哪一周」「用户说'下午'，但没说是几点到几点」
 *
 * 口径说明（**必须显式登记，不能含糊**）：
 *   - 「周三」按**下一个**周三解释（含今天；若今天就是周三则取今天）；
 *   - 「下午」若不具体，按 7~8 节（默认第 8 节开始上课，45 分钟/节）；
 *   - 归一化结果会回显给用户确认（见 machine 的 DONE 输出），
 *     因为这类推断**必须让用户可见可纠正**，不可静默替用户决定。
 */

import { slotsToRange } from '../common/time.js';

const WEEKDAY_MAP = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

/** 解析日期表述 → Date（当天 00:00，本地时区语义） */
export function parseDate(raw, now = new Date()) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // 1) 绝对日期：2026-09-30 / 2026/9/30 / 9月30日
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (m) return new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));

  // 2) 相对日期：今天 / 明天 / 后天
  if (s === '今天' || s === '今日') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (s === '明天' || s === '明日') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (s === '后天') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  // 3) 周几：周三 / 星期三 / 下周三 / 这周三
  m = s.match(/^(下|这|本)?(?:周|星期|礼拜)([一二三四五六日天])$/);
  if (m) {
    const target = WEEKDAY_MAP[m[2]];
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let delta = (target - base.getDay() + 7) % 7;   // 本周内最近的该星期几（含今天）
    if (m[1] === '下') delta += 7;
    base.setDate(base.getDate() + delta);
    return base;
  }

  // 4) 兜底：交给 Date 解析
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 解析节次表述 → 整数 */
export function parseSlot(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : Math.round(raw);
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 「下午」等模糊时段 → [起始节, 结束节] */
export function parseVagueSpan(raw) {
  const s = String(raw ?? '');
  if (/下午/.test(s)) return [7, 8];
  if (/上午/.test(s)) return [1, 2];
  if (/晚上/.test(s)) return [11, 12];
  return null;
}

/**
 * 归一化全部槽位。
 * @returns {{ok: boolean, date: Date|null, slotStart: number|null, slotEnd: number|null, start: Date|null, end: Date|null, notes: string[], reason: string}}
 */
export function normalizeSlots(slots, now = new Date()) {
  const notes = [];
  const date = parseDate(slots.date, now);
  if (!date) return { ok: false, date: null, slotStart: null, slotEnd: null, start: null, end: null, notes, reason: `无法理解日期「${slots.date}」` };

  let slotStart = parseSlot(slots.slotStart);
  let slotEnd = parseSlot(slots.slotEnd);

  // 用户只说了"下午"这类模糊表述
  if (slotStart == null || slotEnd == null) {
    const span = parseVagueSpan(slots.slotStart ?? slots.slotEnd ?? '');
    if (span) {
      [slotStart, slotEnd] = span;
      notes.push(`按「下午」推断为第 ${span[0]}~${span[1]} 节（请确认）`);
    }
  }

  if (slotStart == null || slotEnd == null) {
    return { ok: false, date, slotStart, slotEnd, start: null, end: null, notes, reason: '无法确定具体时段（节次）' };
  }
  if (slotEnd < slotStart) [slotStart, slotEnd] = [slotEnd, slotStart];

  const { start, end } = slotsToRange(date, slotStart, slotEnd);
  return { ok: true, date, slotStart, slotEnd, start, end, notes, reason: 'OK' };
}
