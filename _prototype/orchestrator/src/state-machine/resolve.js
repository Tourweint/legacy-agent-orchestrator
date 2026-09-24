/**
 * 教室标识解析 —— 把"人说的话"翻译成"系统认识的标识"。
 *
 * 设计依据：docs/基线文档/智能体设计.md §2.1 U3
 *   「用户说'数智楼222'，这是人读得懂的名字；存量接口要的是 classroom_id = 4。」
 *
 * 为什么这段逻辑必须独立于 LLM：
 *   映射关系必须**唯一、确定、可复现**。让 LLM 猜 id 会引入不可解释的错误来源，
 *   且一旦猜错，后续所有判定都建立在错误事实上。这里用注册表 + 实际接口数据做确定性匹配。
 *
 * 实测数据（见 业务边界与责任域.md §四 演示数据口径）：
 *   系统内共 7 间教室：数智楼 111/123/222/233/431、电信楼 111/112
 *   **不存在"302 教室"** —— 演示脚本必须用真实存在的教室名。
 */

import { call } from '../gateway/client.js';

/** 已知楼栋名（用于把"数智楼222"拆成楼栋 + 房间号） */
const KNOWN_BUILDINGS = ['数智楼', '电信楼'];

/** 从任意响应形态中取出数组 */
function extractList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of ['list', 'records', 'rows', 'items', 'content', 'classrooms', 'classroomVOS']) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/** 拆分原始表述：'数智楼222' → { building:'数智楼', roomNumber:'222' } */
export function splitRoom(raw) {
  const s = String(raw ?? '').replace(/\s+/g, '');
  const m = s.match(/^(.+?)(\d+)$/);
  if (m) {
    const buildingRaw = m[1];
    const roomNumber = m[2];
    const building = KNOWN_BUILDINGS.find((b) => buildingRaw.includes(b)) ?? buildingRaw;
    return { building, roomNumber, explicitBuilding: !!buildingRaw };
  }
  return { building: null, roomNumber: s, explicitBuilding: false };
}

/**
 * 解析教室。
 * @param {string} raw 用户原话里的教室表述
 * @returns {Promise<{ok: boolean, classroomId: number|null, building: string|null, roomNumber: string|null, classroom: object|null, candidates: object[], reason: string, evidence: object}>}
 */
export async function resolveClassroom(raw) {
  const { building, roomNumber } = splitRoom(raw);

  // ⚠️ min_capacity 是**必填参数**：实测缺失时接口返回业务码 500「系统内部错误」而不是 400。
  //    传 0 表示不限制容量。
  const query = { min_capacity: 0 };
  if (building) query.building = building;

  const res = await call('edu.classroom.available', { query });

  if (res.verdict !== 'SUCCESS') {
    return {
      ok: false, classroomId: null, building, roomNumber, classroom: null, candidates: [],
      reason: `无法获取教室列表：${res.reason}`,
      evidence: { interfaceId: 'edu.classroom.available', verdict: res.verdict },
    };
  }

  const list = extractList(res.data);

  // 精确匹配房间号
  const matched = list.filter((c) => {
    const num = String(c.room_number ?? c.roomNumber ?? c.room ?? '').replace(/\D/g, '');
    return num === String(roomNumber);
  });

  if (matched.length === 1) {
    const c = matched[0];
    return {
      ok: true,
      classroomId: c.id,
      building: c.building ?? building,
      roomNumber: String(c.room_number ?? c.roomNumber ?? roomNumber),
      classroom: c,
      candidates: [],
      reason: `唯一匹配：${c.building ?? ''}${c.room_number ?? c.roomNumber ?? roomNumber}（id=${c.id}）`,
      evidence: { source: 'edu.classroom.available', matched: { id: c.id, room_number: c.room_number ?? c.roomNumber } },
    };
  }

  if (matched.length > 1) {
    return {
      ok: false, classroomId: null, building, roomNumber, classroom: null,
      candidates: matched.map((c) => ({ id: c.id, building: c.building, room_number: c.room_number ?? c.roomNumber })),
      reason: `「${raw}」匹配到 ${matched.length} 间教室，需要用户确认楼栋`,
      evidence: { source: 'edu.classroom.available', ambiguous: true },
    };
  }

  return {
    ok: false, classroomId: null, building, roomNumber, classroom: null, candidates: [],
    reason: `系统中没有找到房间号为 ${roomNumber} 的教室${building ? `（${building}）` : ''}`,
    evidence: { source: 'edu.classroom.available', availableCount: list.length,
      available: list.map((c) => `${c.building ?? ''}${c.room_number ?? c.roomNumber ?? ''}`).slice(0, 12) },
  };
}
