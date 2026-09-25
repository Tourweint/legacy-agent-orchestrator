// 用户令牌注册表 —— 登录方案的接触层落点（决定 1/2/3/6；影响面 #11）。
//
// 它回答一个问题：**"以某个登录用户的身份去调存量系统"时，用哪个 Authorization？**
//
// 与 identity-pool.js 的分工（决定 3：读事实可借服务只读身份，写操作只认本人）：
//   · identity-pool  持有**服务身份**（ADMIN 等）——只用于只读事实收集
//   · 本模块         持有**登录用户本人**的令牌——写操作与"我的记录"类查询必须走它
//
// 纪律：
//   · 令牌与刷新令牌只存在于本模块内存，绝不出模块、不进证据链、不进日志、不进前端
//   · **不在内存里保存用户密码**（与三审拍板的差异及理由见 docs/变更记录 登录实现记录）：
//     三审拍板"会话内存存密码"的唯一理由是"存量系统无刷新令牌接口"——源码核验（AuthController
//     L137-147 + TokenServiceImpl.rotateRefreshToken）证明该接口**存在且会轮换**，因此改用
//     刷新令牌续期；拿不到刷新令牌时才如实要求用户重新登录（决定 8 的既定话术）
//   · 刷新令牌是一次性的：每次续期都替换，旧的一律作废（存量系统实测行为）
//   · 登录/刷新/登出**不进证据链**（沿用既有口径：登录动作不在链上，见 contact-gateway 测试）

import { ContactError } from './contact-error.js'

const LOGIN_INTERFACE_ID = 'auth.login'
const REFRESH_INTERFACE_ID = 'auth.refresh'
const LOGOUT_INTERFACE_ID = 'auth.logout'

/** 会话已失效（令牌续期失败）——接入层据此返回 4011 并要求重新登录，不得降级猜测。 */
export class SessionExpiredError extends ContactError {
  constructor(message) {
    super(message)
    this.name = 'SessionExpiredError'
    this.code = 'SESSION_EXPIRED'
  }
}

export class UserTokenStore {
  /**
   * @param {object} options
   * @param {import('../config/config-store.js').ConfigStore} options.configStore
   * @param {object} options.transport   HttpTransport（约束 A：登录也不开第二个出口）
   * @param {object} options.adapters    ProtocolAdapters
   * @param {object} options.constants   常量集合
   * @param {() => Date} [options.now]
   */
  constructor({ configStore, transport, adapters, constants, now = () => new Date() }) {
    this.store = configStore
    this.transport = transport
    this.adapters = adapters
    this.constants = constants?.contact ?? {}
    this.now = now
    this.#byUser = new Map()
    this.#inflight = new Map()
  }

  #byUser
  #inflight

  /**
   * 用存量系统账号登录（决定 2：用户身份＝存量系统账号，不建第二套用户体系）。
   * 每次调用都会真的去存量系统认证——**不复用缓存跳过密码校验**（否则错密码也能借到已有会话）。
   * @returns {Promise<{userInfo: object}>}
   */
  async login({ username, password }) {
    if (!username || !password) throw new ContactError('登录需要用户名与密码')
    const result = await this.#callLegacy(LOGIN_INTERFACE_ID, { username, password })
    const accessToken = result.data?.accessToken
    const refreshToken = result.data?.refreshToken
    const userInfo = result.data?.userInfo ?? null
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new ContactError('登录响应缺少 accessToken 字段（响应形状与预期不符）')
    }
    this.#byUser.set(username, {
      accessToken,
      refreshToken: typeof refreshToken === 'string' && refreshToken ? refreshToken : null,
      userInfo,
      acquiredAt: this.now().getTime(),
    })
    return { userInfo }
  }

  /** 是否持有该账号的令牌（不暴露令牌本身）。 */
  has(username) {
    return this.#byUser.has(username)
  }

  /**
   * 接管一份**已经取得**的令牌（不经过登录接口）。
   * 用途：测试夹具装配（不必为每个用例真登录一次）；以及将来"从外部会话存储恢复会话"的场景。
   * 它不绕过任何认证——HTTP 登录端点仍然每次都真的去存量系统认证，这里只是接收既得凭证。
   */
  adopt({ username, accessToken, refreshToken = null, userInfo = null }) {
    if (!username || !accessToken) throw new ContactError('adopt 需要 username 与 accessToken')
    this.#byUser.set(username, {
      accessToken,
      refreshToken,
      userInfo,
      acquiredAt: this.now().getTime(),
    })
  }

  /** 登录用户资料（含 role 与个人上限字段）；没有则 null——不触发任何调用。 */
  peekUserInfo(username) {
    return this.#byUser.get(username)?.userInfo ?? null
  }

  /**
   * 取该用户的 Authorization 头值。只在接触层内部使用——返回值不得出本模块。
   * @param {string} username
   * @param {{forceRefresh?: boolean}} [options] 读接口 401 后置 true：先续期再重试，不重新登录
   */
  async getAuthorization(username, { forceRefresh = false } = {}) {
    const entry = this.#byUser.get(username)
    if (!entry) {
      throw new SessionExpiredError(`用户 ${username} 未持有有效登录会话，请重新登录`)
    }
    if (forceRefresh || !this.#isFresh(entry)) {
      await this.#renew(username)
    }
    return `Bearer ${this.#byUser.get(username).accessToken}`
  }

  /** 读接口 401 后由网关调用：丢弃当前令牌，下次取用时按刷新路径续期。 */
  invalidate(username) {
    const entry = this.#byUser.get(username)
    if (entry) entry.acquiredAt = 0 // 标记为不新鲜：下一次取用先续期
  }

  /**
   * 登出：撤销存量系统侧的该设备会话，并清空本地令牌。
   * 登出失败**不影响**本地清理（本地会话必须能结束），但如实回报结果。
   */
  async logout(username) {
    const entry = this.#byUser.get(username)
    if (!entry) return { revoked: false, note: '无本地会话' }
    let revoked = false
    if (entry.refreshToken) {
      try {
        await this.#callLegacy(LOGOUT_INTERFACE_ID, { refreshToken: entry.refreshToken })
        revoked = true
      } catch {
        revoked = false // 存量侧可能已过期/被踢——本地仍必须失效，如实回报
      }
    }
    this.#byUser.delete(username)
    return { revoked, note: revoked ? '已在存量系统撤销该设备会话' : '本地会话已失效（存量侧无需或无法撤销）' }
  }

  // ---- 内部 ----

  #isFresh(entry) {
    const ttl = this.constants.accessTokenTtlMs ?? 1_800_000
    const margin = this.constants.tokenRefreshMarginMs ?? 300_000
    return this.now().getTime() - entry.acquiredAt < ttl - margin
  }

  /** 续期：刷新令牌是一次性的，成功后整体替换；失败一律落"会话已失效"。同一账号并发只发一次。 */
  #renew(username) {
    const running = this.#inflight.get(username)
    if (running) return running
    const task = (async () => {
      const entry = this.#byUser.get(username)
      if (!entry?.refreshToken) {
        throw new SessionExpiredError(`用户 ${username} 的登录会话无法续期（无刷新令牌），请重新登录`)
      }
      let result
      try {
        result = await this.#callLegacy(REFRESH_INTERFACE_ID, { refreshToken: entry.refreshToken })
      } catch (err) {
        // 刷新失败 = 会话真的没了（过期/被踢/被登出）——如实上报，不猜、不重试、不降级
        throw new SessionExpiredError(`用户 ${username} 的登录已失效，请重新登录（${err.message}）`)
      }
      const accessToken = result.data?.accessToken
      if (typeof accessToken !== 'string' || !accessToken) {
        throw new SessionExpiredError(`用户 ${username} 的登录续期响应缺少 accessToken，请重新登录`)
      }
      const refreshToken = result.data?.refreshToken
      this.#byUser.set(username, {
        accessToken,
        refreshToken: typeof refreshToken === 'string' && refreshToken ? refreshToken : entry.refreshToken,
        userInfo: result.data?.userInfo ?? entry.userInfo,
        acquiredAt: this.now().getTime(),
      })
    })().finally(() => this.#inflight.delete(username))
    this.#inflight.set(username, task)
    return task
  }

  /** 调一个"凭证类"接口：走同一传输层与适配器，但结果不进证据链（登录/刷新/登出不在链上）。 */
  async #callLegacy(interfaceId, params) {
    const iface = this.store.getInterface(interfaceId)
    const wire = this.adapters.buildRequest(iface, params)
    const device = this.constants.device ?? {}
    const deviceId = (device.idEnv && process.env[device.idEnv]) || device.idDefault || 'orchestrator-engine'
    const timeouts = this.store.getConstants().timeoutsMs
    const result = await this.transport.request({
      ...wire,
      headers: {
        ...wire.headers,
        'X-Device-Id': deviceId,
        'X-Device-Name': device.nameDefault || 'orchestrator-engine',
      },
      timeoutMs: timeouts[iface.timeoutClass ?? 'read'] ?? timeouts.read,
    })
    if (result.kind !== 'response') {
      const detail = result.errorMessage ? `（${result.errorMessage}）` : ''
      throw new ContactError(`凭证操作 ${interfaceId} 传输失败：${result.kind}${detail}`)
    }
    const signals = this.adapters.extractSignals(result)
    if (signals.httpStatus === 401 || signals.businessCode !== 200) {
      // 不把用户口令或令牌写进错误消息
      throw new ContactError(`凭证操作 ${interfaceId} 被拒：HTTP ${signals.httpStatus} / 业务码 ${signals.businessCode ?? '缺失'}`)
    }
    return signals
  }
}
