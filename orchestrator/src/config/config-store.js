// 配置访问入口 —— 第 02 章 §八（二审澄清）：编排层等业务逻辑必须经本入口读取配置数据，
// 不得自行读文件再解析。收益：数据完整性可被自检、换格式只改一处。
// 校验范围是"结构完整性"（缺文件/缺字段/悬空引用）；设计不变量（8 条自检）由 scripts/structure-check.mjs 负责。

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'

const DEFAULT_CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config')

const REQUIRED_INTERFACE_FIELDS = [
  'id', 'domain', 'method', 'path', 'purpose', 'requiredIdentity', 'sideEffect',
  'autoOrchestration', 'idempotentBusinessKey', 'verification', 'compensation',
  'preconditions', 'adapter', 'legacyNotes',
]

const VALID_DOMAINS = ['auth', 'edu', 'logi']
const SPECIAL_IDENTITIES = ['none', 'initiator'] // initiator = 发起写入时的业务身份（注册表口径，一审更正）
const VALID_TIMEOUT_CLASSES = ['write', 'read', 'readHeavyList']
const VALID_ROLES = ['ADMIN', 'TEACHER', 'STUDENT'] // 意图的 requiredRole 取值（登录方案决定 4）

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

function readYamlFile(dir, name) {
  const path = join(dir, name)
  if (!existsSync(path)) {
    throw new ConfigError(`配置文件缺失: ${path}`)
  }
  try {
    return parseYaml(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new ConfigError(`配置文件解析失败: ${path} —— ${err.message}`)
  }
}

export class ConfigStore {
  constructor(dir = process.env.ORCH_CONFIG_DIR || DEFAULT_CONFIG_DIR) {
    this.constants = readYamlFile(dir, 'constants.yaml')
    this.registry = readYamlFile(dir, 'interface-registry.yaml')
    this.plans = readYamlFile(dir, 'intent-plans.yaml')
    this.identities = readYamlFile(dir, 'identity-declarations.yaml')
    this.stateMachine = readYamlFile(dir, 'state-machine.yaml')
    this.propositions = readYamlFile(dir, 'propositions.yaml')
    this.glossary = readYamlFile(dir, 'glossary.yaml')
    this.#validate()
  }

  /**
   * 术语对照表（零术语纪律的单一数据源）：内部编号 → 人话名。
   * 界面拿它把 `P-SLOT-FREE`/`R1`/`F4` 这类编号渲染成"这个时段是空的"这类人话；
   * 查不到的编号由调用方原样显示（不隐藏、不编造），并由 glossary 覆盖测试保证不会有漏网。
   */
  getGlossary() {
    return {
      facts: { ...(this.glossary?.facts ?? {}) },
      propositions: { ...(this.glossary?.propositions ?? {}) },
      rules: { ...(this.glossary?.rules ?? {}) },
      slots: { ...(this.glossary?.slots ?? {}) },
      // 意图的人话名来自意图计划本身（唯一真相源已是配置，不在这里重抄一份）
      intents: Object.fromEntries(this.intentList.map((it) => [it.id, it.name])),
    }
  }

  // ---- 语义化查询 ----

  getInterface(id) {
    const found = this.interfaces.find((it) => it.id === id)
    if (!found) throw new ConfigError(`接口未纳管: ${id}`)
    return found
  }

  get allInterfaces() {
    return this.interfaces
  }

  getIntent(id) {
    const found = this.intentList.find((it) => it.id === id)
    if (!found) throw new ConfigError(`意图未登记: ${id}`)
    return found
  }

  getProposition(id) {
    const found = this.propositionList.find((it) => it.id === id)
    if (!found) throw new ConfigError(`命题未登记: ${id}`)
    return found
  }

  get allPropositions() {
    return this.propositionList
  }

  get intentList() {
    return this.plans.intents
  }

  getConstants() {
    return this.constants
  }

  getStateMachine() {
    return this.stateMachine
  }

  getIdentity(id) {
    const found = this.identityList.find((it) => it.id === id)
    if (!found) throw new ConfigError(`身份未声明: ${id}`)
    return found
  }

  get identityList() {
    return this.identities.identities
  }

  // 意图计划被允许引用的接口集合（自动编排白名单）
  listAutoOrchestrationAllowed() {
    return this.interfaces.filter((it) => it.autoOrchestration === true).map((it) => it.id)
  }

  // ---- 结构完整性校验（缺必填字段 = 缺陷，第 13 章 §四 纪律 2）----

  #validate() {
    this.#validateRegistry()
    this.#validatePlans()
    this.#validateIdentities()
    this.#validateStateMachine()
    this.#validatePropositions()
    this.#validateGlossary()
  }

  /**
   * 术语对照表校验：命题名字必须与命题清单一一对应（缺一个就拒绝启动）。
   * 理由：界面上出现 `P-XXX` 这种编号、或出现一个名字对应不到的编号，都是"把内部实现
   * 甩给用户看"——这类问题在演示现场才发现就晚了，所以在启动时挡住。
   * （事实与规则的编号定义在代码里——fact-collectors.js 与 verdict-rules.js——
   * 由 test/glossary.test.mjs 反向覆盖校验：凡代码里出现的编号都必须有名字。）
   */
  #validateGlossary() {
    const g = this.glossary
    if (!g || typeof g !== 'object') throw new ConfigError('术语对照表为空')
    const titles = g.propositions ?? {}
    const ids = new Set(this.propositions.propositions.map((p) => p.id))
    for (const id of ids) {
      if (!titles[id]) throw new ConfigError(`术语对照表缺少命题 ${id} 的人话名（零术语纪律）`)
    }
    for (const key of Object.keys(titles)) {
      if (!ids.has(key)) throw new ConfigError(`术语对照表里的命题 ${key} 未在命题清单中登记`)
    }
    for (const [id, title] of Object.entries(g.rules ?? {})) {
      if (!/^[WR]\d+$/.test(id)) throw new ConfigError(`术语对照表的规则编号非法: ${id}`)
      if (!title || typeof title !== 'string') throw new ConfigError(`术语对照表的规则 ${id} 没有名字`)
    }
    for (const [id, title] of Object.entries(g.facts ?? {})) {
      if (!/^F\d+$/.test(id)) throw new ConfigError(`术语对照表的事实编号非法: ${id}`)
      if (!title || typeof title !== 'string') throw new ConfigError(`术语对照表的事实 ${id} 没有名字`)
    }
    // 槽位短名：意图计划里用到的每个槽位键都要有人话短名——否则"理解结果"里会冒出 classroomName
    const slotLabels = g.slots ?? {}
    for (const intent of this.intentList) {
      const keys = new Set([
        ...(intent.slots?.required ?? []),
        ...(intent.slots?.optional ?? []),
        ...Object.keys(intent.slots?.slotHints ?? {}),
      ])
      for (const key of keys) {
        if (!slotLabels[key]) {
          throw new ConfigError(`术语对照表缺少槽位 ${key} 的短名（意图 ${intent.id} 用到它）`)
        }
      }
    }
  }

  #validateRegistry() {
    const list = this.registry.interfaces
    if (!Array.isArray(list) || list.length === 0) {
      throw new ConfigError('接口注册表为空')
    }
    const seen = new Set()
    for (const it of list) {
      const missing = REQUIRED_INTERFACE_FIELDS.filter((f) => !(f in it))
      if (missing.length > 0) {
        throw new ConfigError(`接口 ${it.id || '(无 id)'} 缺字段: ${missing.join(', ')}`)
      }
      if (seen.has(it.id)) throw new ConfigError(`接口标识重复: ${it.id}`)
      seen.add(it.id)
      if (!VALID_DOMAINS.includes(it.domain)) {
        throw new ConfigError(`接口 ${it.id} 域非法: ${it.domain}`)
      }
      if (typeof it.sideEffect !== 'boolean' || typeof it.autoOrchestration !== 'boolean') {
        throw new ConfigError(`接口 ${it.id} 的 sideEffect/autoOrchestration 必须是布尔值`)
      }
      if (it.timeoutClass !== undefined && !VALID_TIMEOUT_CLASSES.includes(it.timeoutClass)) {
        throw new ConfigError(`接口 ${it.id} 的 timeoutClass 非法: ${it.timeoutClass}`)
      }
      if (it.sideEffect) {
        // N3 硬门槛：有副作用必须可查证
        if (!it.verification || !it.verification.via) {
          throw new ConfigError(`接口 ${it.id} 有副作用但无查证路径（N3 硬门槛）`)
        }
        // N4 硬门槛：有副作用必须可补偿或显式登记为不可补偿
        const comp = it.compensation
        const declared = comp && (comp.action || comp.nonCompensable === true)
        if (!declared) {
          throw new ConfigError(`接口 ${it.id} 有副作用但既无补偿动作也未登记不可补偿（N4 硬门槛）`)
        }
        // 幂等业务键：补偿动作可豁免（businessKeyExempt）
        if (!it.businessKeyExempt && !it.idempotentBusinessKey) {
          throw new ConfigError(`接口 ${it.id} 有副作用但缺幂等业务键（补偿动作可豁免）`)
        }
      }
      if (!Array.isArray(it.legacyNotes) || it.legacyNotes.length === 0) {
        throw new ConfigError(`接口 ${it.id} 缺实测注意事项——它们是文档的一部分，禁止为空`)
      }
    }
    this.interfaces = list
  }

  #validatePlans() {
    const intents = this.plans.intents
    if (!Array.isArray(intents) || intents.length === 0) {
      throw new ConfigError('意图计划为空')
    }
    const ids = new Set()
    for (const intent of intents) {
      for (const f of ['id', 'name', 'readOnly', 'slots', 'propositions', 'steps']) {
        if (!(f in intent)) throw new ConfigError(`意图 ${intent.id || '(无 id)'} 缺字段: ${f}`)
      }
      if (ids.has(intent.id)) throw new ConfigError(`意图标识重复: ${intent.id}`)
      ids.add(intent.id)
      // 角色要求（登录方案决定 4）：声明了就必须是合法角色——权限是配置数据，不散落在代码里
      if (intent.requiredRole !== undefined && !VALID_ROLES.includes(intent.requiredRole)) {
        throw new ConfigError(`意图 ${intent.id} 的 requiredRole 非法: ${intent.requiredRole}`)
      }
      for (const role of intent.allowedRoles ?? []) {
        if (!VALID_ROLES.includes(role)) {
          throw new ConfigError(`意图 ${intent.id} 的 allowedRoles 含非法角色: ${role}`)
        }
      }
      if (intent.steps.some((s) => !s.interface)) {
        throw new ConfigError(`意图 ${intent.id} 存在未声明接口的步骤`)
      }
    }
    // 引用完整性：步骤/查证/补偿引用的接口必须已纳管（自检项 8 依赖此处干净的引用面）
    for (const intent of intents) {
      const refs = [
        ...intent.steps.map((s) => s.interface),
        ...(intent.verification
          ? [intent.verification.primary?.interface, intent.verification.fallback?.interface]
          : []),
        intent.compensation?.action,
      ].filter(Boolean)
      for (const ref of refs) {
        if (!this.interfaces.some((it) => it.id === ref)) {
          throw new ConfigError(`意图 ${intent.id} 引用了未纳管接口: ${ref}`)
        }
      }
    }
  }

  #validateIdentities() {
    const list = this.identityList
    const ids = new Set(list.map((it) => it.id))
    for (const identity of list) {
      if (!identity.account) throw new ConfigError(`身份 ${identity.id} 缺绑定账号`)
      if (!identity.credentials?.passwordEnv) {
        throw new ConfigError(`身份 ${identity.id} 缺凭证环境变量名（只写变量名，不写值）`)
      }
    }
    for (const it of this.interfaces) {
      const required = it.requiredIdentity
      if (SPECIAL_IDENTITIES.includes(required)) continue
      if (!ids.has(required)) {
        throw new ConfigError(`接口 ${it.id} 所需身份未声明: ${required}`)
      }
    }
  }

  #validateStateMachine() {
    const sm = this.stateMachine
    const stateIds = new Set(Object.keys(sm.states || {}))
    if (!stateIds.has(sm.initial)) {
      throw new ConfigError(`状态机初始态未定义: ${sm.initial}`)
    }
    const events = new Set(sm.events || [])
    for (const edge of sm.edges || []) {
      if (!stateIds.has(edge.from)) throw new ConfigError(`转移表边的 from 未定义: ${edge.from}`)
      if (!events.has(edge.event)) throw new ConfigError(`转移表边的事件未登记: ${edge.event}`)
      if (edge.ignore) {
        // 忽略型无边（第 04 章 §5.6/§5.9）：设计上不生效的事件，状态不变、仅审计留痕——
        // 它没有也不应该有目标状态
        if (edge.to) {
          throw new ConfigError(`忽略型无边不应有目标状态: ${edge.from} --${edge.event}--> ${edge.to}`)
        }
        continue
      }
      if (!stateIds.has(edge.to)) {
        throw new ConfigError(`转移表边的 to 未定义: ${edge.from} --${edge.event}--> ${edge.to}`)
      }
      if (edge.purpose && !(sm.purposes || []).includes(edge.purpose)) {
        throw new ConfigError(`转移表边的 purpose 非法: ${edge.purpose}`)
      }
    }
  }

  #validatePropositions() {
    const list = this.propositions.propositions
    if (!Array.isArray(list) || list.length === 0) {
      throw new ConfigError('命题清单为空')
    }
    const knownFacts = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6'])
    const seen = new Set()
    for (const prop of list) {
      for (const f of ['id', 'semantics', 'dependsOn', 'when']) {
        if (!(f in prop)) throw new ConfigError(`命题 ${prop.id || '(无 id)'} 缺字段: ${f}`)
      }
      if (seen.has(prop.id)) throw new ConfigError(`命题标识重复: ${prop.id}`)
      seen.add(prop.id)
      for (const fact of prop.dependsOn) {
        if (!knownFacts.has(fact)) throw new ConfigError(`命题 ${prop.id} 依赖未知事实: ${fact}`)
      }
      if (!(typeof prop.degradable === 'boolean')) {
        throw new ConfigError(`命题 ${prop.id} 缺 degradable（可降级性，第 08 章 §四）`)
      }
      const degradedFacts = prop.degraded?.facts ?? []
      for (const fact of degradedFacts) {
        if (!knownFacts.has(fact)) throw new ConfigError(`命题 ${prop.id} 降级事实未知: ${fact}`)
      }
    }
    // 意图计划引用的命题必须已登记（引用完整性）+ 命题依赖 ⊆ 意图事实清单（计划可执行性）
    for (const intent of this.intentList) {
      for (const propId of intent.propositions ?? []) {
        const prop = list.find((p) => p.id === propId)
        if (!prop) {
          throw new ConfigError(`意图 ${intent.id} 引用了未登记命题: ${propId}`)
        }
        for (const fact of [...prop.dependsOn, ...(prop.degraded?.facts ?? [])]) {
          if (!(intent.facts ?? []).includes(fact)) {
            throw new ConfigError(`意图 ${intent.id} 的事实清单缺少 ${fact}（命题 ${propId} 依赖它）`)
          }
        }
      }
    }
    this.propositionList = list
  }
}
