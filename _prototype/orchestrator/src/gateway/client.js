/**
 * 防腐网关 —— 统一出口。
 *
 * 设计依据：docs/基线文档/智能体设计.md 命题 P3
 *   「这次调用应该以什么身份、什么形态发出？」
 *
 * 职责（**只做这四件，不做业务判断**）：
 *   1. 按接口注册表选身份（最小身份原则）
 *   2. 把编排层的标准参数 → 存量系统的实际形态（路径、query、body 命名）
 *   3. 发起调用并交给 adapters 做三值判定
 *   4. 401 时刷新身份重试一次
 *
 * 明确不做：业务判断、重试策略决策、补偿决策 —— 这些属于状态机。
 * 网关是"哑管道 + 一个聪明的判定器"，它不知道自己在办的是一件什么事。
 */

import config from '../common/config.js';
import { judgeVerdict, isAmbiguous } from './adapters.js';
import { acquire, refresh } from './identity.js';
import { getInterface } from '../registry/interfaces.js';
import { Verdict } from '../common/tristate.js';

/**
 * 填充路径占位符：/classrooms/{classroomId} + {classroomId:4} → /classrooms/4
 */
function fillPath(tpl, pathParams = {}) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (pathParams[k] === undefined) {
      throw new Error(`路径参数缺失：${k}（模板 ${tpl}）`);
    }
    return encodeURIComponent(pathParams[k]);
  });
}

function buildQuery(query = {}) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/**
 * 调用一个已登记的接口。
 *
 * @param {string} interfaceId 注册表 ID
 * @param {object} opts
 * @param {object} [opts.pathParams] 路径参数
 * @param {object} [opts.query]      query 参数
 * @param {object} [opts.body]       JSON body
 * @returns {Promise<import('../common/tristate.js').Outcome>}
 */
export async function call(interfaceId, { pathParams = {}, query = {}, body = null } = {}) {
  const spec = getInterface(interfaceId);
  const url = `${config.legacy.baseUrl}${fillPath(spec.path, pathParams)}${buildQuery(query)}`;

  let attempt = 0;
  const maxAttempts = 2; // 仅用于"认证过期"这一种情形；业务层重试由状态机决定

  while (attempt < maxAttempts) {
    attempt += 1;
    const started = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    let identity = null;

    try {
      if (spec.requiredRole) {
        identity = await acquire(spec.requiredRole);
        headers['Authorization'] = `Bearer ${identity.token}`;
        headers['X-Device-Id'] = identity.deviceId;
      }

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), config.legacy.timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          method: spec.method,
          headers,
          body: body == null ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const rawText = await res.text();
      let parsed = null;
      try { parsed = rawText ? JSON.parse(rawText) : null; } catch { parsed = rawText; }

      const verdict = judgeVerdict({
        interfaceId,
        adapter: spec.adapter,
        httpStatus: res.status,
        body: parsed,
        elapsedMs: Date.now() - started,
      });

      // 认证过期：刷新身份后重试一次（这是网关唯一的重试，且不涉及业务语义）
      if (res.status === 401 && spec.requiredRole && attempt < maxAttempts) {
        await refresh(spec.requiredRole);
        continue;
      }

      return verdict;
    } catch (e) {
      // 网络层异常（超时、连接重置）→ UNKNOWN，交由上层查证
      const isAbort = e?.name === 'AbortError';
      return judgeVerdict({
        interfaceId,
        adapter: spec.adapter,
        httpStatus: null,
        body: null,
        networkError: isAbort ? Object.assign(new Error(`请求超时（>${config.legacy.timeoutMs}ms）`), { name: 'TimeoutError' }) : e,
        elapsedMs: Date.now() - started,
      });
    }
  }

  // 理论不可达；保留兜底以显式表达"未收敛"
  return judgeVerdict({
    interfaceId, adapter: spec.adapter, httpStatus: null, body: null,
    networkError: new Error('认证刷新后仍未获得有效响应'), elapsedMs: 0,
  });
}

/** 便捷：只调用一次并返回 outcome（语义同上，供测试与探针使用） */
export const invoke = call;

export { isAmbiguous, Verdict };
