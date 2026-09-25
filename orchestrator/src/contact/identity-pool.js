// 身份池 —— 第 01 章 M6：凭证由网关统一持有与刷新，只在接触层内部流转；
// 不进入编排逻辑、不进入日志、不进入证据链、不进入前端。
//
// 规格：
//   · 登录走同一个 HttpTransport（约束 A：连登录也不开第二个出口）
//   · token 按身份缓存；有效期实测 30 分钟（基线 §五），按提前量主动刷新，
//     避免拿注定过期的 token 去撞 401
//   · 读接口 401 → 调用方（contact-gateway）按 R6/J5 走"透明重登后重试"，重登从这里触发
//   · 写接口 401 → 绝不自动重登重试（W7：请求可能已被处理，须先查证）
//   · 一个业务身份绑定一个具体账号（一审澄清）；密码只从环境变量取，任何地方不落值

import { ContactError } from './contact-error.js'

const LOGIN_INTERFACE_ID = 'auth.login'

export class IdentityPool {
  /**
   * @param {object} options
   * @param {import('../config/config-store.js').ConfigStore} options.configStore
   * @param {import('./http-transport.js').HttpTransport} options.transport
   * @param {object} options.adapters    协议适配器（登录请求的构造与 envelope 提取）
   * @param {object} options.constants   常量集合（contact 节）
   * @param {() => Date} [options.now]
   */
  constructor({ configStore, transport, adapters, constants, now = () => new Date() }) {
    this.store = configStore
    this.transport = transport
    this.adapters = adapters
    this.constants = constants?.contact ?? {}
    this.now = now
    // token 缓存：身份 → { token, acquiredAt }；只存在于本池内存，任务结束随进程生命周期
    this.#cache = new Map()
  }

  #cache

  /**
   * 取该身份的 Authorization 头值。只在接触层内部使用——返回值不得出本模块。
   * @param {string} identityId  业务身份（ADMIN/TEACHER/STUDENT）
   * @param {{forceRefresh?: boolean}} [options] 读 401 后透明重登时置 true
   */
  async getAuthorization(identityId, { forceRefresh = false } = {}) {
    const cached = this.#cache.get(identityId)
    if (!forceRefresh && cached && this.#isFresh(cached)) {
      return `Bearer ${cached.token}`
    }
    const { token, userInfo } = await this.#login(identityId)
    this.#cache.set(identityId, { token, userInfo, acquiredAt: this.now().getTime() })
    return `Bearer ${token}`
  }

  /**
   * 登录用户信息（含数字 id 与角色）。数字 id 用于幂等查证的 Q1 写入者匹配
   * （第 06 章 §三：记录里的写入者 == 本次发起的身份——用 token 背后的用户 id 比对，
   * token 会过期刷新而身份不会）。
   */
  async getUserInfo(identityId) {
    const cached = this.#cache.get(identityId)
    if (cached?.userInfo) return cached.userInfo
    await this.getAuthorization(identityId)
    return this.#cache.get(identityId)?.userInfo ?? null
  }

  /** 读接口 401 后由 contact-gateway 调用：丢弃当前 token，下次取用重新登录。 */
  invalidate(identityId) {
    this.#cache.delete(identityId)
  }

  #isFresh(cached) {
    const ttl = this.constants.accessTokenTtlMs ?? 1_800_000
    const margin = this.constants.tokenRefreshMarginMs ?? 300_000
    return this.now().getTime() - cached.acquiredAt < ttl - margin
  }

  async #login(identityId) {
    const identity = this.store.getIdentity(identityId)
    const envName = identity.credentials?.passwordEnv
    const password = envName ? process.env[envName] : undefined
    if (!password) {
      // 为什么不提供默认密码：AGENTS.md 红线——真实凭据不得出现在代码/文档/提交中；
      // 演示环境按根 README 的说明以环境变量注入
      throw new ContactError(`环境变量 ${envName || '(未声明)'} 未设置——身份 ${identityId} 无法登录（密码不从文件读取）`)
    }

    const loginIface = this.store.getInterface(LOGIN_INTERFACE_ID)
    const device = this.constants.device ?? {}
    const deviceId = (device.idEnv && process.env[device.idEnv]) || device.idDefault || 'orchestrator-engine'
    const request = this.adapters.buildRequest(loginIface, {
      username: identity.account,
      password,
    })

    const transportResult = await this.transport.request({
      ...request,
      headers: {
        ...request.headers,
        'X-Device-Id': deviceId,
        'X-Device-Name': device.nameDefault || 'orchestrator',
      },
      timeoutMs: this.#timeoutFor(loginIface),
    })

    // 登录失败不再重试：同一份错误口令重试没有意义；凭证明细不进错误消息
    if (transportResult.kind !== 'response') {
      const detail = transportResult.errorMessage ? `（${transportResult.errorMessage}）` : ''
      throw new ContactError(`登录（${identityId}）传输失败：${transportResult.kind}${detail}`)
    }
    const signals = this.adapters.extractSignals(transportResult)
    if (signals.httpStatus === 401 || signals.businessCode !== 200) {
      throw new ContactError(`登录（${identityId}）被拒：HTTP ${signals.httpStatus} / 业务码 ${signals.businessCode ?? '缺失'}`)
    }
    // 实测字段是 accessToken（openapi LoginVO 写的 "token" 与实现不符——上游文档不一致 D7，
    // 见基线文档 §九）；兼容文档形状只作防御，不作为依据
    const token = signals.data?.accessToken ?? signals.data?.token
    if (typeof token !== 'string' || !token) {
      // 登录成功响应里没有 token——响应形状与预期不符，宁可失败也不拿着空凭证往下走
      throw new ContactError(`登录（${identityId}）响应缺少 accessToken 字段`)
    }
    return { token, userInfo: signals.data?.userInfo ?? null }
  }

  #timeoutFor(iface) {
    const timeouts = this.store.getConstants().timeoutsMs
    return timeouts[iface.timeoutClass ?? 'read'] ?? timeouts.read
  }
}
