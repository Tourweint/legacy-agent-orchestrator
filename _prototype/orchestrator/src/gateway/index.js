/**
 * 防腐网关门面。
 *
 * 对外只有两个入口：
 *   call(interfaceId, opts)  —— 发起一次调用，返回三值结果
 *   health()                 —— 探测存量系统连通性与身份可用性
 *
 * 上层（状态机）**不得**绕过本门面直接 fetch 存量系统 ——
 * 否则三值判定、身份选择、协议适配会被绕过，边界失效。
 */

import { call, invoke } from './client.js';
import { acquire, clear as clearIdentities, status as identityStatus } from './identity.js';
import { judgeVerdict, isAmbiguous, ADAPTERS } from './adapters.js';
import config from '../common/config.js';

export { call, invoke, judgeVerdict, isAmbiguous, ADAPTERS };

/**
 * 健康检查：确认存量系统可达、三个身份可用。
 * 演示前的第一件事；也是"边界实现"的现场证据。
 */
export async function health() {
  const report = { baseUrl: config.legacy.baseUrl, reachable: false, identities: {}, problems: [] };

  // 1. 连通性（用登录接口探活，因为它不需要身份）
  try {
    const loginProbe = await fetch(`${config.legacy.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'orches-health' },
      body: JSON.stringify({ username: '__health__', password: '__health__' }),
      signal: AbortSignal.timeout(5000),
    });
    // 401/400 也说明服务是活的（能响应就说明可达）
    report.reachable = loginProbe.status > 0;
  } catch (e) {
    report.problems.push(`存量系统不可达：${e.message}`);
    return report;
  }

  // 2. 三个身份是否都能登录
  for (const role of Object.keys(config.identities)) {
    try {
      await acquire(role);
      report.identities[role] = 'ok';
    } catch (e) {
      report.identities[role] = 'failed';
      report.problems.push(`身份 ${role} 不可用：${e.message}`);
    }
  }

  return report;
}

/** 复位（演示前清空 token 缓存） */
export function reset() {
  clearIdentities();
}

export { identityStatus };
