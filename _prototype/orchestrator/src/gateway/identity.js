/**
 * 多身份凭证池 —— 命题 P3 的落地。
 *
 * 设计依据：docs/基线文档/业务边界与责任域.md §三 P3
 *   「权限是分裂的：查维修要 ADMIN，建整间预约要 TEACHER。
 *     编排层必须维护多身份凭证池，由接口注册表声明所需身份，网关按需取用。」
 *
 * 两条纪律：
 *   1. **最小身份**：每次调用只使用该接口所需的最小角色（不变量 I5）。
 *      不得因为"ADMIN 权限大"就用它调所有接口 —— 而且技术上也不成立
 *      （实测 ADMIN 调教室预约接口返回 HTTP 200 + code 403）。
 *   2. **查证须同源**：用某身份写入后查证时，若走"我的预约"类接口必须用**同一身份**；
 *      若走管理端接口（跨身份可见）则用 ADMIN —— 后者正是幂等机制的支点。
 */

import config from '../common/config.js';
import { IdentityError } from '../common/errors.js';

/** role → { token, expiresAt, deviceId } */
const pool = new Map();

/** 每个角色一个稳定的设备标识，避免判为异常登录 */
function deviceIdOf(role) {
  return `orches-${role.toLowerCase()}-01`;
}

/**
 * 登录换取 token（不经过 client，避免循环依赖）。
 * @param {string} role ADMIN | TEACHER | STUDENT
 * @returns {Promise<string>} AccessToken
 */
async function login(role) {
  const cred = config.identities[role];
  if (!cred) throw new IdentityError(`未配置身份：${role}`);

  const url = `${config.legacy.baseUrl}/auth/login`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.legacy.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': deviceIdOf(role),
        'X-Device-Name': 'orchestrator',
      },
      body: JSON.stringify({ username: cred.username, password: cred.password }),
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => null);
    const token = body?.data?.accessToken;
    if (!token) {
      throw new IdentityError(`身份 ${role} 登录失败（HTTP ${res.status}）：${body?.message || '未返回 accessToken'}`,
        { role, httpStatus: res.status });
    }
    // 有效期保守取 25 分钟（存量系统 token 有效期按小时计，避免边界过期）
    pool.set(role, { token, expiresAt: Date.now() + 25 * 60_000, deviceId: deviceIdOf(role) });
    return token;
  } catch (e) {
    if (e instanceof IdentityError) throw e;
    throw new IdentityError(`身份 ${role} 登录异常：${e.message}`, { role });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取某角色的凭证，必要时登录。
 * @param {string} role
 * @returns {Promise<{token: string, deviceId: string}>}
 */
export async function acquire(role) {
  if (!role) throw new IdentityError('该调用未声明所需身份（注册表配置缺失）');
  const cached = pool.get(role);
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, deviceId: cached.deviceId };
  }
  const token = await login(role);
  return { token, deviceId: deviceIdOf(role) };
}

/** 凭证失效时强制刷新（网关在收到 401 后调用一次） */
export async function refresh(role) {
  pool.delete(role);
  return acquire(role);
}

/** 清空（复位/演示前使用） */
export function clear() {
  pool.clear();
}

/** 供健康检查与演示展示：当前已缓存哪些身份（不暴露 token 明文） */
export function status() {
  return [...pool.entries()].map(([role, v]) => ({
    role,
    cached: true,
    expiresInMs: Math.max(0, v.expiresAt - Date.now()),
  }));
}
