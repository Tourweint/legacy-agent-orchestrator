/**
 * 协议适配器 + 三值判定 —— 防腐网关的核心。
 *
 * 设计依据：docs/基线文档/智能体设计.md 命题 P4
 *   「调用之后，结果到底是什么？」
 *
 * 这是整个项目里最能说明"为什么需要防腐层"的一个文件。
 * 存量系统的判定依据全部实测得出，不是假设：
 *
 *   | 场景           | HTTP | body.code | 朴素判定的后果               | 正确判定 |
 *   |----------------|------|-----------|------------------------------|----------|
 *   | 正常成功       | 200  | 200       | 成功                         | SUCCESS  |
 *   | 时段冲突       | 200  | 409       | **误判为成功**（HTTP 是 200） | FAILURE（歧义，需查证） |
 *   | 参数非法       | 200  | 400       | 误判为成功                   | FAILURE  |
 *   | 无权限（方法层）| 200  | 403       | **误判为成功**               | FAILURE  |
 *   | 无权限（过滤器）| 403  | —         | 失败                         | FAILURE  |
 *   | 未认证         | 401  | —         | 失败                         | FAILURE  |
 *   | 超时/网络中断  | —    | —         | 误判为失败 → 重试 → **重复写** | UNKNOWN（先查证） |
 *
 * 「HTTP 200 + code=403」这一行是本项目最有价值的一处真实陷阱：
 * 只看 HTTP 状态码的实现，会把"越权被拒"当成"操作成功"。
 */

import { Verdict, outcome } from '../common/tristate.js';

/** 存量系统业务码 → 语义（实测归纳） */
const BIZ_CODE_MEANING = Object.freeze({
  200: 'OK',
  400: 'BAD_REQUEST',    // 参数非法 / 资源不存在，两种情形同码
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  409: 'CONFLICT',       // 时段冲突；⚠️ 歧义：不区分"你自己已成功"与"他人已占"
  500: 'SERVER_ERROR',
});

/**
 * 各域的适配器。
 * 当前 edu 与 logi 由**同一个存量系统**承载，响应包装相同；
 * 二者的真实差异在**权限域**（TEACHER vs ADMIN）与**事实域**（预约 vs 维修）。
 * 适配器分离的意义在于：将来接入真正异构的系统时，只需新增一个适配器，判定规则不变。
 */
export const ADAPTERS = Object.freeze({
  /** 教务域：{ code, message, data }，业务错误一律 HTTP 200 */
  edu: {
    domain: 'edu',
    decode(body) {
      if (!body || typeof body !== 'object') return { bizCode: null, message: '', data: null };
      return { bizCode: body.code ?? null, message: body.message ?? '', data: body.data ?? null };
    },
    /** 该域的断言：响应里除了业务码，还有哪些字段能作证据 */
    extractData(body) {
      const { data } = this.decode(body);
      return data;
    },
  },

  /** 后勤域：同一系统的 admin 接口族，权限域不同 */
  logi: {
    domain: 'logi',
    decode(body) {
      if (!body || typeof body !== 'object') return { bizCode: null, message: '', data: null };
      return { bizCode: body.code ?? null, message: body.message ?? '', data: body.data ?? null };
    },
    extractData(body) {
      const { data } = this.decode(body);
      return data;
    },
  },

  /** 原始域：不做包装解析，直接把响应体当数据（用于探测未知接口） */
  raw: {
    domain: 'raw',
    decode(body) {
      return { bizCode: null, message: '', data: body ?? null };
    },
    extractData(body) {
      return body ?? null;
    },
  },
});

/**
 * 三值判定 —— 所有调用的唯一裁决入口。
 *
 * @param {object} p
 * @param {string} interfaceId 接口 ID（用于取适配器与留痕）
 * @param {string} adapter     适配器名
 * @param {number|null} httpStatus HTTP 状态码（null 表示未拿到响应）
 * @param {object|null} body   响应体（null 表示未拿到响应）
 * @param {Error|null} networkError 网络层错误（超时、连接重置等）
 * @param {number} elapsedMs   耗时
 * @returns {import('../common/tristate.js').Outcome}
 */
export function judgeVerdict({ interfaceId, adapter = 'edu', httpStatus, body, networkError = null, elapsedMs = 0 }) {
  const a = ADAPTERS[adapter] ?? ADAPTERS.raw;

  // ---------- 情形一：没拿到任何响应 ----------
  // 关键判断：**不确定**，不是失败。
  // 因为存量系统可能已经写库，只是响应在途中丢失。
  if (networkError || httpStatus == null) {
    return outcome({
      verdict: Verdict.UNKNOWN,
      interfaceId,
      httpStatus: null,
      bizCode: null,
      data: null,
      reason: `未收到响应（${networkError?.name || 'unknown'}：${networkError?.message || '无响应'}）；`
        + '副作用可能已生效，必须走查证收敛',
      elapsedMs,
    });
  }

  const { bizCode, message, data } = a.decode(body);
  const meaning = bizCode == null ? 'NO_BIZ_CODE' : (BIZ_CODE_MEANING[bizCode] ?? `UNKNOWN_BIZ_CODE_${bizCode}`);

  // ---------- 情形二：HTTP 层明确失败 ----------
  if (httpStatus === 401) {
    return outcome({ verdict: Verdict.FAILURE, interfaceId, httpStatus, bizCode, data: null,
      reason: '认证失败（401）：身份不可用，非业务问题', elapsedMs });
  }
  if (httpStatus === 403) {
    return outcome({ verdict: Verdict.FAILURE, interfaceId, httpStatus, bizCode, data: null,
      reason: '权限不足（403，过滤器层拒绝）：该身份无权调用', elapsedMs });
  }
  if (httpStatus >= 500) {
    // 5xx 同样是不确定的：服务端可能已提交事务后才崩溃
    return outcome({ verdict: Verdict.UNKNOWN, interfaceId, httpStatus, bizCode, data: null,
      reason: `服务端错误（HTTP ${httpStatus}）：服务端可能已完成部分处理，需查证`, elapsedMs });
  }

  // ---------- 情形三：HTTP 200，真正的判定在 body 里 ----------
  if (httpStatus === 200) {
    // 3.1 无业务码：按原始响应处理
    if (bizCode == null) {
      return outcome({ verdict: Verdict.SUCCESS, interfaceId, httpStatus, bizCode: null, data,
        reason: 'HTTP 200 且无业务码包装，视为成功', elapsedMs });
    }

    // 3.2 业务成功
    if (bizCode === 200) {
      return outcome({ verdict: Verdict.SUCCESS, interfaceId, httpStatus, bizCode, data,
        reason: '业务码 200', elapsedMs });
    }

    // 3.3 冲突（409）—— 本项目最关键的歧义信号
    if (bizCode === 409) {
      return outcome({
        verdict: Verdict.FAILURE,
        interfaceId, httpStatus, bizCode, data: null,
        reason: '时段冲突（409）：⚠️ 歧义——可能是"本次调用其实已成功"，也可能是"他人已占用"；'
          + '不能据此断定失败，必须查证后再决定是否重试',
        elapsedMs,
      });
    }

    // 3.4 无权限（方法层）—— 最容易误判为成功的一类
    if (bizCode === 403) {
      return outcome({ verdict: Verdict.FAILURE, interfaceId, httpStatus, bizCode, data: null,
        reason: '权限不足（HTTP 200 + code 403，方法层拒绝）：⚠️ 只看 HTTP 状态码会误判为成功',
        elapsedMs });
    }

    // 3.5 参数非法 / 资源不存在
    if (bizCode === 400) {
      return outcome({ verdict: Verdict.FAILURE, interfaceId, httpStatus, bizCode, data: null,
        reason: `请求不合法（400）：${message || '参数错误或资源不存在'}`, elapsedMs });
    }

    // 3.6 其他非 200 业务码：保守处理为失败（不可重试，需人工确认）
    return outcome({ verdict: Verdict.FAILURE, interfaceId, httpStatus, bizCode, data: null,
      reason: `业务码 ${bizCode}（${meaning}）：${message || '未归类错误'}`, elapsedMs });
  }

  // ---------- 情形四：其他 4xx ----------
  return outcome({ verdict: Verdict.FAILURE, interfaceId, httpStatus, bizCode, data: null,
    reason: `HTTP ${httpStatus}：请求被拒绝`, elapsedMs });
}

/** 该结果是否属于"需要查证才能定论"的歧义态 */
export function isAmbiguous(o) {
  return o.verdict === Verdict.UNKNOWN || o.bizCode === 409;
}
