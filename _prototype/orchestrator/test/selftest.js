/**
 * 骨架自检 —— 不依赖存量系统、不依赖大模型，纯离线验证。
 *
 * 验证四件事（都是"设计是否成立"的前提，不是业务逻辑）：
 *   1. 注册表自检：写接口必须声明 verifyBy / compensate
 *   2. 转移表自检：终态无出边、非终态无死状态、写操作只能从 SUBMITTING 发出
 *   3. 事实闭环：命题 requires 的每个事实都必须有收集方案
 *   4. 三值判定的契约：对存量系统的各类响应，判定结果必须正确
 *      —— 尤其「HTTP 200 + code 403」必须被判为失败而非成功
 *
 * 运行：node test/selftest.js
 */

import { selfCheck, INTERFACES, INTENTS, sideEffectSteps } from '../src/registry/index.js';
import { auditTransitions, canWrite, State, nextState, Event } from '../src/state-machine/states.js';
import { PROPOSITIONS } from '../src/validator/propositions.js';
import { COLLECTORS } from '../src/state-machine/collectors.js';
import { judgeVerdict, isAmbiguous } from '../src/gateway/adapters.js';
import { Verdict } from '../src/common/tristate.js';
import { normalizeSlots } from '../src/state-machine/normalize.js';
import { splitRoom } from '../src/state-machine/resolve.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ' —— ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}

console.log('\n=== 1. 注册表一致性 ===');
{
  const sc = selfCheck();
  check('注册表自检通过', sc.ok, sc.problems.join('；'));
  const writes = INTERFACES.filter((i) => i.sideEffect);
  check('每个写接口都声明了 verifyBy', writes.every((w) => !!w.verifyBy),
    writes.filter((w) => !w.verifyBy).map((w) => w.id).join(','));
  check('每个写接口都满足「可补偿 or 显式登记不可补偿」（不变量 I6）',
    writes.every((w) => !!w.compensate || w.uncompensable === true),
    writes.filter((w) => !w.compensate && w.uncompensable !== true).map((w) => w.id).join(','));
  const orchestratableWrites = writes.filter((w) => w.orchestrable !== false && w.compensate !== null);
  check('每个参与编排的写接口都声明了前置命题',
    orchestratableWrites.every((w) => w.preconditions.length > 0),
    orchestratableWrites.filter((w) => w.preconditions.length === 0).map((w) => w.id).join(','));
  check('只读意图不含写步骤',
    INTENTS.filter((i) => i.id.endsWith('.check')).every((i) => sideEffectSteps(i.id).length === 0));
}

console.log('\n=== 2. 状态机合法性 ===');
{
  const probs = auditTransitions();
  check('转移表自检通过（无死状态 / 终态无出边）', probs.length === 0, probs.join('；'));
  check('只有 SUBMITTING 允许写操作',
    Object.values(State).every((s) => canWrite(s) === (s === State.SUBMITTING)));
  check('SUBMITTING 在收到 UNKNOWN 时进入 VERIFYING（不得直接判失败）',
    nextState(State.SUBMITTING, Event.CALL_UNKNOWN) === State.VERIFYING);
  check('SUBMITTING 在收到 409 冲突时进入 VERIFYING（歧义信号须查证）',
    nextState(State.SUBMITTING, Event.CALL_CONFLICT) === State.VERIFYING);
  check('查证命中时直接进入 DONE（禁止重试）',
    nextState(State.VERIFYING, Event.VERIFY_FOUND) === State.DONE);
  check('补偿失败进入 UNRESOLVED（显式上报，不静默）',
    nextState(State.COMPENSATING, Event.COMPENSATION_FAILED) === State.UNRESOLVED);
}

console.log('\n=== 3. 事实闭环（命题 requires → 收集器） ===');
{
  const missing = [];
  for (const p of PROPOSITIONS) {
    for (const key of p.requires) {
      if (!COLLECTORS[key]) missing.push(`${p.id} 需要 ${key}，但没有收集方案`);
    }
  }
  check('所有命题依赖的事实都有收集方案', missing.length === 0, missing.join('；'));

  const autoKeys = [...new Set(PROPOSITIONS.flatMap((p) => p.requires))];
  const autoIfaces = [...new Set(autoKeys.map((k) => COLLECTORS[k].interfaceId))];
  const roles = [...new Set(autoIfaces.map((i) => INTERFACES.find((x) => x.id === i)?.requiredRole))];
  check('跨权限域聚合是"推出来的"而非硬编码（涉及 ≥2 个角色）', roles.length >= 2, roles.join(','));
}

console.log('\n=== 4. 三值判定契约（存量系统真实响应形态） ===');
{
  const cases = [
    { name: '正常成功 HTTP200+code200',        p: { httpStatus: 200, body: { code: 200, data: { id: 1 } } }, want: Verdict.SUCCESS },
    { name: '冲突 HTTP200+code409 → 失败(歧义)', p: { httpStatus: 200, body: { code: 409, message: '时段冲突' } }, want: Verdict.FAILURE },
    { name: '参数错 HTTP200+code400',           p: { httpStatus: 200, body: { code: 400, message: '参数错误' } }, want: Verdict.FAILURE },
    { name: '无权限 HTTP200+code403（方法层）', p: { httpStatus: 200, body: { code: 403, message: '无权限' } }, want: Verdict.FAILURE },
    { name: '无权限 HTTP403（过滤器层）',       p: { httpStatus: 403, body: { code: 403 } }, want: Verdict.FAILURE },
    { name: '未认证 HTTP401',                   p: { httpStatus: 401, body: { code: 401 } }, want: Verdict.FAILURE },
    { name: '超时（无响应）',                    p: { httpStatus: null, body: null, networkError: new Error('timeout') }, want: Verdict.UNKNOWN },
    { name: '服务端 5xx（可能已提交事务）',      p: { httpStatus: 500, body: { code: 500 } }, want: Verdict.UNKNOWN },
  ];

  for (const c of cases) {
    const o = judgeVerdict({ interfaceId: 'test', adapter: 'edu', elapsedMs: 1, ...c.p });
    check(c.name, o.verdict === c.want, `期望 ${c.want}，实际 ${o.verdict}`);
  }

  // 最容易出错的一条，单独强调
  const trap = judgeVerdict({ interfaceId: 'test', adapter: 'edu', httpStatus: 200, body: { code: 403 } });
  check('【关键】HTTP 200 + code 403 不得被判为成功（只看 HTTP 状态码会踩这个坑）',
    trap.verdict !== Verdict.SUCCESS, `实际 ${trap.verdict}`);

  // 歧义态识别
  check('409 被识别为歧义态',
    isAmbiguous(judgeVerdict({ interfaceId: 'test', adapter: 'edu', httpStatus: 200, body: { code: 409 } })));
  check('超时被识别为歧义态',
    isAmbiguous(judgeVerdict({ interfaceId: 'test', adapter: 'edu', httpStatus: null, networkError: new Error('x') })));
}

console.log('\n=== 5. 槽位归一化与教室名解析 ===');
{
  const now = new Date(2026, 8, 24); // 2026-09-24 是周四
  const r1 = normalizeSlots({ date: '周三', slotStart: 7, slotEnd: 8 }, now);
  check('「周三」解析为下一个周三（2026-09-30）', r1.ok && r1.date.getDate() === 30,
    r1.ok ? `实际 ${r1.date.toDateString()}` : r1.reason);
  check('节次 7~8 → 时段区间成立', r1.ok && r1.end > r1.start);

  const r2 = normalizeSlots({ date: '明天', slotStart: '第7节', slotEnd: '第8节' }, now);
  check('「明天」+「第7节」可解析', r2.ok && r2.date.getDate() === 25, r2.reason);

  const r3 = normalizeSlots({ date: '周四', slotStart: '下午', slotEnd: '下午' }, now);
  check('模糊时段「下午」按 7~8 节推断', r3.ok && r3.slotStart === 7 && r3.slotEnd === 8, r3.reason);

  const s1 = splitRoom('数智楼222');
  check('教室名拆分：数智楼222 → 楼栋+房间号',
    s1.building === '数智楼' && s1.roomNumber === '222', JSON.stringify(s1));
  const s2 = splitRoom('电信楼 111');
  check('带空格教室名可拆分', s2.building === '电信楼' && s2.roomNumber === '111', JSON.stringify(s2));
}

console.log('\n' + '='.repeat(56));
console.log(`自检结果：通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
} else {
  console.log('骨架自检全部通过 ✅');
}
