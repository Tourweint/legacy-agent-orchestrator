/**
 * 配置加载 —— 零依赖（不引入 dotenv）。
 *
 * 配置来源优先级：进程环境变量 > orchestrator/config/default.json > 内置默认值。
 * 存量系统的连接参数沿用其 docker-compose 的变量名，保持口径一致。
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config', 'default.json');

function loadFileConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`配置文件解析失败 ${CONFIG_PATH}: ${e.message}`);
  }
}

const fileCfg = loadFileConfig();
const pick = (envKey, filePath, fallback) => {
  if (process.env[envKey] !== undefined && process.env[envKey] !== '') return process.env[envKey];
  const v = filePath.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), fileCfg);
  return v === undefined ? fallback : v;
};

export const config = Object.freeze({
  /** 存量系统基地址。注意：真实路径**没有** /api 前缀（那是前端 vite 代理 rewrite 掉的） */
  legacy: Object.freeze({
    baseUrl: pick('LEGACY_BASE_URL', 'legacy.baseUrl', 'http://localhost:8080'),
    /** 单次调用超时（ms）。刻意设得比存量系统响应慢的场景更短，以便制造"响应丢失" */
    timeoutMs: Number(pick('LEGACY_TIMEOUT_MS', 'legacy.timeoutMs', 8000)),
    /** 重试策略：仅对"确定失败且可重试"的情形生效；UNKNOWN 一律先查证再决定 */
    maxAttempts: Number(pick('LEGACY_MAX_ATTEMPTS', 'legacy.maxAttempts', 2)),
  }),

  /**
   * 多身份凭证池。
   * 依据 业务边界与责任域.md §三 P3：权限分裂是真实约束，必须按接口取用最小身份。
   * 这里只存"登录所必需的信息"，token 由 gateway/identity.js 在运行时换取并缓存。
   */
  identities: Object.freeze({
    ADMIN: Object.freeze({
      username: pick('LEGACY_ADMIN_USER', 'identities.ADMIN.username', 'admin'),
      password: pick('LEGACY_ADMIN_PASS', 'identities.ADMIN.password', 'admin'),
    }),
    TEACHER: Object.freeze({
      username: pick('LEGACY_TEACHER_USER', 'identities.TEACHER.username', '233'),
      password: pick('LEGACY_TEACHER_PASS', 'identities.TEACHER.password', '233'),
    }),
    STUDENT: Object.freeze({
      username: pick('LEGACY_STUDENT_USER', 'identities.STUDENT.username', 'abc'),
      password: pick('LEGACY_STUDENT_PASS', 'identities.STUDENT.password', 'abc'),
    }),
  }),

  /** 大模型（仅用于 P1 意图解析；不参与任何执行决策） */
  llm: Object.freeze({
    apiKey: pick('DASHSCOPE_API_KEY', 'llm.apiKey', ''),
    baseUrl: pick('DASHSCOPE_BASE_URL', 'llm.baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    model: pick('DASHSCOPE_MODEL', 'llm.model', 'qwen-plus'),
    timeoutMs: Number(pick('LLM_TIMEOUT_MS', 'llm.timeoutMs', 30000)),
    /** 解析失败时的重试次数（Schema 校验不过即重试） */
    maxParseAttempts: Number(pick('LLM_PARSE_ATTEMPTS', 'llm.maxParseAttempts', 2)),
  }),

  /** 编排层自身 HTTP 服务 */
  server: Object.freeze({
    port: Number(pick('ORCHES_PORT', 'server.port', 8090)),
  }),

  /** 混沌模块（控制面）。执行面在故障代理层，见 src/chaos/ */
  chaos: Object.freeze({
    enabled: pick('CHAOS_ENABLED', 'chaos.enabled', 'true') === 'true',
  }),

  /** 时区：存量系统出参为 LocalDateTime（无时区），需按本校所在时区解释 */
  timezone: pick('ORCHES_TZ', 'timezone', 'Asia/Shanghai'),
});

export default config;
