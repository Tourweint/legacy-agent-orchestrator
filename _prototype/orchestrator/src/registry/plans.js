/**
 * 意图 → 任务链模板（确定性映射）。
 *
 * 设计依据：docs/基线文档/智能体设计.md §7.3 决策 2
 *   「LLM 无权决定调用哪个接口。它只能产出"意图 + 槽位"，
 *     由接口注册表根据意图确定性地映射到接口序列。」
 *
 * 这是把 LLM 挡在副作用之外的关键闸门：
 *   LLM 的自由度止于"选出 intent 名字"，
 *   一旦 intent 确定，后面调哪些接口、什么顺序、什么身份，全部由本文件确定。
 *   → 可复现、可测试、可解释。
 */

/** 槽位定义：required 为 true 且缺失时，必须向用户追问（命题 P1） */
const SLOTS = Object.freeze({
  classroom: { key: 'classroom', label: '教室', required: true, hint: '例如「数智楼222」' },
  date: { key: 'date', label: '日期', required: true, hint: '例如「周三」「2026-09-30」' },
  slotStart: { key: 'slotStart', label: '开始节次', required: true, hint: '例如第 7 节' },
  slotEnd: { key: 'slotEnd', label: '结束节次', required: true, hint: '例如第 8 节' },
  purpose: { key: 'purpose', label: '用途', required: false, hint: '例如「班会」' },
});

/**
 * 任务链步骤类型：
 *   gather   —— 收集事实（只读调用）
 *   validate —— 校验前置命题（不产生调用）
 *   invoke   —— 发起写操作
 *   judge    —— 判定结果（含不确定态收敛）
 *   recover  —— 补偿
 */
export const StepKind = Object.freeze({
  GATHER: 'gather',
  VALIDATE: 'validate',
  INVOKE: 'invoke',
  JUDGE: 'judge',
  RECOVER: 'recover',
});

/** @typedef {object} IntentSpec */
export const INTENTS = Object.freeze([
  {
    id: 'classroom.borrow',
    label: '教室借用',
    description: '在指定日期时段借用一间教室',
    slots: [SLOTS.classroom, SLOTS.date, SLOTS.slotStart, SLOTS.slotEnd, SLOTS.purpose],
    /** 主链：事实 → 校验 → 写入 → 判定 */
    steps: [
      { id: 'resolve-classroom', kind: StepKind.GATHER, interfaceId: 'edu.classroom.detail',
        note: '把人类可读的教室名解析成真实 id，并读取 status（可用性来源三之一）' },
      { id: 'check-occupied', kind: StepKind.GATHER, interfaceId: 'edu.classroom.reservedSeats',
        note: '读该时段占用座位 → 推导教室是否被占（口径在 validator 内统一）' },
      { id: 'check-maintenance', kind: StepKind.GATHER, interfaceId: 'logi.maintenance.list',
        note: '读维修窗口（需 ADMIN 身份）—— 教务域看不到这个事实，必须跨域聚合' },
      { id: 'validate-preconditions', kind: StepKind.VALIDATE,
        note: '校验 P-CLASSROOM-EXISTS / ENABLED / SLOT-FREE / NOT-UNDER-MAINTENANCE' },
      { id: 'submit', kind: StepKind.INVOKE, interfaceId: 'edu.reservation.classroom.create',
        note: '以 TEACHER 身份提交；若返回 UNKNOWN 或 409，进入判定与查证' },
      { id: 'judge-outcome', kind: StepKind.JUDGE, interfaceId: 'logi.reservation.list',
        note: '以 ADMIN 身份跨身份查证；把"不确定"收敛为确定' },
      { id: 'compensate-if-needed', kind: StepKind.RECOVER, interfaceId: 'edu.reservation.cancel',
        note: '仅在"已写入但后续步骤失败"时执行；补偿失败须显式登记' },
    ],
    /** 降级策略：目标教室不可用时，是否允许自动换教室（对应混沌演示 D3） */
    degrade: {
      enabled: true,
      maxRounds: 3,
      strategy: 'same-building-capacity-ok',
      note: '同楼栋、容量达标、时段空闲的教室；最多尝试 3 轮，超出则转人工确认',
    },
  },
  {
    id: 'classroom.availability.check',
    label: '教室可用性查询',
    description: '仅查询某教室某时段是否可借，不产生任何写入',
    slots: [SLOTS.classroom, SLOTS.date, SLOTS.slotStart, SLOTS.slotEnd],
    steps: [
      { id: 'resolve-classroom', kind: StepKind.GATHER, interfaceId: 'edu.classroom.detail',
        note: '解析教室名 → id，读 status' },
      { id: 'check-occupied', kind: StepKind.GATHER, interfaceId: 'edu.classroom.reservedSeats',
        note: '读时段占用' },
      { id: 'check-maintenance', kind: StepKind.GATHER, interfaceId: 'logi.maintenance.list',
        note: '读维修窗口' },
      { id: 'validate-preconditions', kind: StepKind.VALIDATE, note: '给出可借/不可借及依据' },
    ],
    degrade: { enabled: false, maxRounds: 0, strategy: null, note: '只读意图，不降级' },
  },
]);

const BY_ID = new Map(INTENTS.map((i) => [i.id, i]));

export function getIntent(id) {
  const it = BY_ID.get(id);
  if (!it) throw new Error(`未登记的意图：${id}`);
  return it;
}

export function hasIntent(id) {
  return BY_ID.has(id);
}

/**
 * 仅返回有副作用的步骤 —— 用于"零写入"自检：
 * 一个只读意图的任务链，其 invoke 步骤数必须为 0。
 */
export function sideEffectSteps(intentId) {
  return getIntent(intentId).steps.filter((s) => s.kind === StepKind.INVOKE || s.kind === StepKind.RECOVER);
}

/** 全部意图的槽位并集，供 LLM 提示词与 Schema 生成使用 */
export function allSlotKeys() {
  return [...new Set(INTENTS.flatMap((i) => i.slots.map((s) => s.key)))];
}
