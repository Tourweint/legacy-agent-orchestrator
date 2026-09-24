/**
 * 编排层 HTTP 入口 —— 零依赖（node:http）。
 *
 * 设计依据：docs/基线文档/智能体设计.md §7.2
 *   前端只能通过本服务与编排层交互；本服务对前端暴露的**不是**存量系统的接口，
 *   而是"一次自然语言办事"的结果 + 执行轨迹。这是"代理"而非"网关"的体现。
 *
 * 路由：
 *   POST /api/chat       一句话办事（主入口）
 *   GET  /api/health     存量系统连通性与身份可用性
 *   GET  /api/registry   接口注册表（前端用于展示"边界"）
 *   GET  /api/machine    状态定义与转移表（前端用于展示状态机）
 *   POST /api/reset      清空身份缓存（演示前复位）
 */

import { createServer } from 'node:http';
import config from '../common/config.js';
import { run, State, TRANSITIONS, TERMINAL_STATES } from '../state-machine/index.js';
import { INTERFACES, INTENTS, selfCheck } from '../registry/index.js';
import { health, reset } from '../gateway/index.js';
import { PROPOSITIONS } from '../validator/propositions.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, JSON_HEADERS);
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { __parseError: raw }; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    // ---- 主入口：一句话办事 ----
    if (req.method === 'POST' && path === '/api/chat') {
      const body = await readBody(req);
      if (body.__parseError !== undefined) {
        return send(res, 400, { ok: false, message: '请求体不是合法 JSON' });
      }
      const { utterance, history = {} } = body;
      if (!utterance || typeof utterance !== 'string') {
        return send(res, 400, { ok: false, message: '缺少 utterance 字段' });
      }
      const result = await run({ utterance, history });
      return send(res, 200, {
        ok: result.ok,
        state: result.state,
        verdict: result.verdict,
        message: result.message,
        data: result.data,
        trace: result.trace,
      });
    }

    // ---- 健康检查 ----
    if (req.method === 'GET' && path === '/api/health') {
      const h = await health();
      return send(res, 200, h);
    }

    // ---- 注册表（前端展示"边界"） ----
    if (req.method === 'GET' && path === '/api/registry') {
      return send(res, 200, {
        interfaces: INTERFACES.map((i) => ({
          id: i.id, domain: i.domain, method: i.method, path: i.path, summary: i.summary,
          requiredRole: i.requiredRole, sideEffect: i.sideEffect,
          verifyBy: i.verifyBy, compensate: i.compensate, preconditions: i.preconditions,
          notes: i.notes,
        })),
        intents: INTENTS,
        propositions: PROPOSITIONS.map((p) => ({ id: p.id, label: p.label, domain: p.domain, requires: p.requires })),
        selfCheck: selfCheck(),
      });
    }

    // ---- 状态机（前端展示状态图） ----
    if (req.method === 'GET' && path === '/api/machine') {
      return send(res, 200, {
        states: Object.values(State),
        terminal: [...TERMINAL_STATES],
        transitions: TRANSITIONS,
      });
    }

    // ---- 复位 ----
    if (req.method === 'POST' && path === '/api/reset') {
      reset();
      return send(res, 200, { ok: true, message: '身份缓存已清空' });
    }

    return send(res, 404, { ok: false, message: `未定义的路由：${req.method} ${path}` });
  } catch (e) {
    // 未预期异常：明确返回，不吞掉（便于发现设计缺口）
    return send(res, 500, {
      ok: false,
      message: `编排层内部错误：${e.message}`,
      errorType: e.name,
      code: e.code ?? null,
    });
  }
});

server.listen(config.server.port, () => {
  const sc = selfCheck();
  console.log(`[编排层] 已启动：http://localhost:${config.server.port}`);
  console.log(`[编排层] 存量系统：${config.legacy.baseUrl}`);
  console.log(`[编排层] 注册表自检：${sc.ok ? '通过' : `${sc.problems.length} 项问题`}`);
  if (!sc.ok) sc.problems.forEach((p) => console.log(`           - ${p}`));
  console.log(`[编排层] 大模型：${config.llm.model}（Key ${config.llm.apiKey ? '已配置' : '未配置'}）`);
});
