// LLM 客户端 —— 约束 C（唯一非确定性入口）：全仓库只允许本文件发起大模型请求
// （scripts/constraint-check.mjs 的 LLM 白名单随阶段 5 加入 src/understanding/）。
//
// 选型（根 README）：阿里云百炼 DashScope，qwen-plus，OpenAI 兼容模式，原生 fetch 调用
// ——不引入 SDK（依赖登记：按需档已论证，OpenAI 兼容协议用内置 fetch 即可）。
// 参数（决策 E4 倾向）：temperature = 0——理解输出要尽量可复现。
// 密钥只从环境变量取（DASHSCOPE_API_KEY），不出现在任何文件/日志/错误消息中。

import { UnderstandingError } from './understanding-error.js'

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const DEFAULT_MODEL = 'qwen-plus'
const DEFAULT_TIMEOUT_MS = 30_000

export class LlmClient {
  constructor({ fetchImpl = globalThis.fetch, config } = {}) {
    this.fetchImpl = fetchImpl
    this.model = config?.model ?? process.env.ORCH_LLM_MODEL ?? DEFAULT_MODEL
    this.baseUrl = (config?.baseUrl ?? process.env.ORCH_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.apiKey = process.env.DASHSCOPE_API_KEY
  }

  get configured() {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0
  }

  /**
   * 发起一次补全。
   * @param {{system: string, messages: Array<{role: string, content: string}>}} p
   *        messages 为完整对话（少样本前缀 + 历史 + 本轮用户输入），由调用方组装
   * @returns {Promise<{text: string, model: string, elapsedMs: number}>}
   */
  async complete({ system, messages }) {
    if (!this.configured) {
      throw new UnderstandingError('环境变量 DASHSCOPE_API_KEY 未设置——理解层不可用（可走结构化任务入口）')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const startedAt = Date.now()
    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) {
        throw new UnderstandingError('理解层请求超时')
      }
      throw new UnderstandingError(`理解层网络失败：${err?.cause?.code || err?.message || 'unknown'}`)
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 429) {
      // 限流/配额：不重试，交由编排层降级为"按钮式选择"（决策 E7）
      const err = new UnderstandingError('理解层限流或配额不足')
      err.kind = 'rate-limited'
      throw err
    }
    if (!response.ok) {
      throw new UnderstandingError(`理解层 HTTP ${response.status}`)
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new UnderstandingError('理解层响应不是合法 JSON')
    }
    const text = payload?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text) {
      throw new UnderstandingError('理解层响应缺少 choices[0].message.content')
    }
    return { text, model: this.model, elapsedMs: Date.now() - startedAt }
  }
}
