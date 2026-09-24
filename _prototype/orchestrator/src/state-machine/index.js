/**
 * 状态机模块门面。
 *
 * 对外只有 run() 一个入口 —— 调用方（HTTP 层 / 测试 / 混沌脚本）都走它，
 * 保证"LLM 理解 → 事实聚合 → 命题校验 → 提交 → 判定 → 查证 → 补偿"这条链唯一。
 * 没有第二个入口，就没有旁路，边界的保证才有可能成立。
 */

import { run, rollbackCompleted } from './machine.js';

export { run, rollbackCompleted };
export { State, Event, TRANSITIONS, TERMINAL_STATES, nextState, canWrite, auditTransitions } from './states.js';
export { resolveClassroom, splitRoom } from './resolve.js';
export { verify, VERIFY_LIMITATIONS } from './verify.js';
export { compensate, COMPENSATION_MATRIX_NOTE } from './compensate.js';
export { normalizeSlots, parseDate, parseSlot } from './normalize.js';
export { COLLECTORS, collectFacts, factDomains } from './collectors.js';
