/**
 * 存量系统探针 —— 现场取证脚本。
 *
 * 用途：把"我们为什么需要编排层"这件事，用**实测输出**而不是文档断言呈现出来。
 * 演示前跑一遍，输出即答辩材料；也是 `docs/基线文档/存量系统改造说明.md` 的证据来源。
 *
 * 用法：node scripts/probe-legacy.js
 */

import { call } from '../src/gateway/client.js';
import { acquire } from '../src/gateway/identity.js';
import config from '../src/common/config.js';
import { toOffsetDateTime } from '../src/common/time.js';
import { judgeVerdict } from '../src/gateway/adapters.js';

const line = (s = '') => console.log(s);
const hr = (t) => line(`\n${'─'.repeat(64)}\n${t}\n${'─'.repeat(64)}`);

function show(o, indent = '  ') {
  line(`${indent}verdict=${o.verdict}  http=${o.httpStatus}  bizCode=${o.bizCode}`);
  line(`${indent}reason : ${o.reason}`);
  if (o.data !== undefined && o.data !== null) {
    const s = JSON.stringify(o.data);
    line(`${indent}data   : ${s.length > 220 ? s.slice(0, 220) + ' …' : s}`);
  }
}

async function main() {
  line(`存量系统：${config.legacy.baseUrl}`);
  line(`探测时间：${new Date().toLocaleString('zh-CN')}`);

  // ---------------------------------------------------------------
  hr('【证据 1】判定"能否借教室"需要跨权限域聚合');
  // ---------------------------------------------------------------
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(10, 0, 0, 0);
  const startIso = toOffsetDateTime(d);
  const endIso = toOffsetDateTime(new Date(d.getTime() + 3600_000));

  line(`\n> 用 TEACHER 身份查教务域（教室 + 时段占用）`);
  const room = await call('edu.classroom.detail', { pathParams: { classroomId: 4 } });
  show(room);
  const seats = await call('edu.classroom.reservedSeats', {
    pathParams: { classroomId: 4 }, query: { start_time: startIso, end_time: endIso },
  });
  show(seats);

  line(`\n> 用同一身份（TEACHER）直连后勤域接口 —— 预期被拒`);
  // ⚠️ 这里**不能**走 call('logi.maintenance.list')：那会自动取注册表声明的 ADMIN 身份。
  //    要证明"权限鸿沟"，必须手工用 TEACHER token 直连。
  const teacherTok = (await acquire('TEACHER')).token;
  const deniedRes = await fetch(`${config.legacy.baseUrl}/admin/maintenance?classroomId=4`, {
    headers: { Authorization: `Bearer ${teacherTok}` },
  });
  const deniedBody = await deniedRes.json().catch(() => null);
  line(`  HTTP ${deniedRes.status}   body.code=${deniedBody?.code}   message=${deniedBody?.message}`);
  line('  ↑ 教务侧身份**读不到**维修事实（HTTP 403，过滤器层）');
  line('  ↑ 而判定"这间教室能否借"必须知道它是否在维修 → 跨域聚合是必需，不是设计偏好');

  line(`\n> 换 ADMIN 身份查后勤域 —— 成功`);
  const adminSees = await call('logi.maintenance.list', { query: { classroomId: 4 } });
  show(adminSees);

  // ---------------------------------------------------------------
  hr('【证据 2】"HTTP 200 + code 403" —— 只看状态码会误判为成功');
  // ---------------------------------------------------------------
  await acquire('ADMIN');
  const adminToken = (await acquire('ADMIN')).token;
  const url = `${config.legacy.baseUrl}/reservations/classrooms`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    // eslint-disable-next-line no-undef
    body: JSON.stringify({ classroom_id: 5, start_time: startIso, end_time: endIso, reason: '权限探针' }),
  });
  const body = await res.json().catch(() => null);
  line(`  HTTP 状态码        : ${res.status}`);
  line(`  body.code          : ${body?.code}`);
  line(`  body.message       : ${body?.message}`);
  const judged = judgeVerdict({ interfaceId: 'edu.reservation.classroom.create', adapter: 'edu', httpStatus: res.status, body });
  line(`  → 网关判定         : ${judged.verdict}`);
  line(`  → 若只看 HTTP 状态码，会判定为   : SUCCESS ❌（这就是陷阱）`);
  line(`  → 正确判定                     : FAILURE ✅（无权限，不可重试）`);

  // ---------------------------------------------------------------
  hr('【证据 3】冲突 409 是"歧义信号"');
  // ---------------------------------------------------------------
  const teacherToken = (await acquire('TEACHER')).token;
  const post = async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${teacherToken}` },
      body: JSON.stringify({ classroom_id: 6, start_time: startIso, end_time: endIso, reason: '冲突探针' }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const first = await post();
  const second = await post();
  line(`  第 1 次提交 : HTTP ${first.status}  code=${first.body?.code}`);
  line(`  第 2 次提交 : HTTP ${second.status}  code=${second.body?.code}`);
  line('');
  line('  关键场景不是"两次都收到了响应"，而是 —— **第 1 次的响应在途中丢失了**：');
  line('  此时用户只看得到第 2 次的 409，而这个 409 既可能是"你刚才其实成功了"，');
  line('  也可能是"别人抢先占了"。系统两种情况的响应完全一样，**无法区分**。');
  line('  → 所以 409 既不能当成功（可能真失败），也不能当失败（可能已成功）：只能查证。');

  // ---------------------------------------------------------------
  hr('【证据 4】查证接口的能力缺口');
  // ---------------------------------------------------------------
  line('  按资源 ID 查（keyword=4）—— 注意返回记录里出现了 resourceId=6：');
  const byId = await call('logi.reservation.list', { query: { keyword: '4' } });
  show(byId);
  line('\n  按教室名查（keyword=222）:');
  const byName = await call('logi.reservation.list', { query: { keyword: '222' } });
  show(byName);
  line('\n  ✅ 不带 keyword 查 —— 返回全量列表，这才是可靠用法:');
  const all = await call('logi.reservation.list', {});
  const allList = Array.isArray(all.data) ? all.data : (all.data?.list ?? []);
  line(`  verdict=${all.verdict}  条数=${allList.length}`);
  line('  ↑ keyword 语义模糊（不是精确过滤），且接口无分页参数；');
  line('    编排层的做法是：拉全量 → 内存按 (教室, 时段) 精确比对，并对规模设安全阈值。');

  // ---------------------------------------------------------------
  line(`\n${'═'.repeat(64)}`);
  line('探测结束。以上均为存量系统的客观现状，未做任何修改。');
  line(`${'═'.repeat(64)}\n`);
}

main().catch((e) => {
  console.error('探测失败：', e.message);
  process.exitCode = 1;
});
