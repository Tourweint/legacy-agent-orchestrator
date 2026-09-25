// 教室名归一化 —— 第 08 章 §7.1 第三类（"数智楼222" → 楼栋 + 房间号）的纯函数落地。
// 归一化不在理解层（第 03 章 §四关键决定）：本模块只依赖输入字符串，可单测、可审计。
//
// 输入是槽位里的原话片段（如 "数智楼222"、"数智楼 123 和 222"）；
// 输出是资源列表（解析失败的片段不混入结果——调用方以数量判断是否可继续）。

const SEPARATORS = /\s*(?:和|跟|还有|、|，|,|以及|和另外)\s*/g

export function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 解析一段教室名原话为资源列表。
 * @returns {Array<{building: string, roomNumber: string, raw: string}>}
 *   片段解析不出房间号（无数字）时不产出条目——调用方据此追问。
 */
export function parseClassroomName(text) {
  const raw = normalizeSpace(text)
  if (!raw) return []
  const out = []
  let lastBuilding = null
  for (const part of raw.split(SEPARATORS).map(normalizeSpace).filter(Boolean)) {
    const match = /^(\D*?)(\d+)\s*(?:教室|房间|室)?$/.exec(part)
    if (!match) {
      lastBuilding = normalizeSpace(part) // "数智楼 123" 式的楼栋前导词：供后续裸房间号继承
      continue
    }
    const building = normalizeSpace(match[1]) || lastBuilding
    if (!building) continue
    lastBuilding = building
    out.push({ building, roomNumber: match[2], raw: part })
  }
  return out
}
