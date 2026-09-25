// 判定引擎 —— 第 13 章阶段 2 的对外入口（P2：给我一个结构化意图，我还你事实集 + 命题判定
// 结论 + 依据引用；我不发任何写请求）。
//
// 输入输出契约（第 13 章 阶段 2）：
//   输入   { intentId, target: {classroom, slot, seatId?}, identity: {id, userId?}, precollectedFacts? }
//   输出   命题判定结果集合（每条含结论、依据、可降级性）+ 事实快照（J6 轮内共用）
//
// 三条写死口径（第 13 章阶段 2）在算子与收集器中落地：
//   1. 占用座位数 > 0 → 整间不可用；全量座位 → 歧义标记（fact-collectors F3）
//   2. 维修窗口失效集合用排除法（predicates maintenance-overlaps）
//   3. 时段比较用重叠而非相等、按 UTC 解释（canonical/time.js）
//
// 禁止项的落实：本层不发 HTTP（只读统一经接触层，A3）；"事实不可得"收敛为 UNCONFIRMABLE
// 而非"不成立"（第 08 章 §三）；谓词求值出错同样收敛为 UNCONFIRMABLE——宁可无法确认，不可猜。

import { JudgmentError } from './judgment-error.js'
import { FactCollector } from './fact-collectors.js'
import { evaluatePredicate, renderTemplate, matchedSlotText } from './predicates.js'

export class JudgmentEngine {
  constructor({ configStore, gateway, evidenceChain = null, now = () => new Date() }) {
    this.store = configStore
    this.gateway = gateway
    this.evidenceChain = evidenceChain
    this.now = now
    this.collector = new FactCollector({ configStore, gateway, evidenceChain })
  }

  async evaluateIntent({ intentId, target, identity, precollectedFacts } = {}) {
    const { facts, identity: resolvedIdentity } = await this.collectFacts({ intentId, target, identity, precollectedFacts })
    return this.judge({ intentId, target, identity: resolvedIdentity, facts })
  }

  /**
   * 只收集事实（阶段 3：编排层 GATHERING 态调用）。
   * 返回事实快照——J6 轮内快照 / C10 不缓存由编排层控制复用。
   */
  async collectFacts({ intentId, target, identity, precollectedFacts = {} } = {}) {
    const intent = this.store.getIntent(intentId)
    const propDefs = (intent.propositions ?? []).map((id) => this.store.getProposition(id))
    if (!target?.slot?.start || !target?.slot?.end) {
      throw new JudgmentError('缺少申请时段（target.slot.start/end，绝对时刻）')
    }

    // 命题依赖 ⊆ 意图声明的事实——计划配置错误在这里早暴露（不静默收集计划外事实）
    const needed = new Set()
    for (const prop of propDefs) {
      for (const fact of [...prop.dependsOn, ...(prop.degraded?.facts ?? [])]) {
        if (!intent.facts.includes(fact)) {
          throw new JudgmentError(`命题 ${prop.id} 依赖的 ${fact} 未在意图 ${intentId} 的事实清单中`)
        }
        needed.add(fact)
      }
    }

    // Q1 写入者匹配需要发起身份的数字 id（token 背后的 userId）；拿不到时
    // writer:self 的命题会走"无法确认"处置（见 overlap-exists 算子）
    let userId = identity?.userId ?? null
    if (userId == null && needed.has('F4')) {
      // 登录后发起人 = 登录者本人：其数字 id 通常已由接入层随会话传入；
      // 缺失时从接触层的用户令牌注册表补（服务身份池是兜底，保持旧路径可用）
      userId = this.gateway.userTokenStore?.peekUserInfo?.(identity?.id)?.id ?? null
      if (userId == null) {
        try {
          userId = (await this.gateway.pool.getUserInfo(identity.id))?.id ?? null
        } catch {
          userId = null
        }
      }
    }

    const resolvedIdentity = { ...identity, userId }
    const { facts } = await this.collector.collect({
      factIds: [...needed],
      target,
      identity: resolvedIdentity,
      precollected: precollectedFacts ?? {},
    })
    return { facts, identity: resolvedIdentity }
  }

  /**
   * 只做命题判定（阶段 3：编排层 VALIDATING 态调用）——对给定事实快照判定，不再收集。
   */
  judge({ intentId, target, identity, facts }) {
    const intent = this.store.getIntent(intentId)
    const propDefs = (intent.propositions ?? []).map((id) => this.store.getProposition(id))
    const evalCtx = this.#buildContext({ facts, target, identity })
    const results = propDefs.map((propDef) => this.#judge(propDef, evalCtx))
    const summary = this.#summarize(results)
    this.#recordEvidence(results)
    return {
      intentId,
      evaluatedAt: this.now().toISOString(),
      identity,
      facts,
      results,
      summary,
    }
  }

  #buildContext({ facts, target, identity }) {
    const f1 = facts.F1
    // 目标教室三元组以 F1 的解析结果为准（人读名 → 系统标识），输入值兜底供话术引用
    const classroom = {
      classroomId: f1?.value?.classroomId ?? target.classroom?.classroomId ?? null,
      building: f1?.value?.building ?? target.classroom?.building ?? null,
      roomNumber: f1?.value?.roomNumber ?? target.classroom?.roomNumber ?? null,
    }
    return {
      facts,
      constants: this.store.getConstants(),
      identity,
      target: { classroom, slot: target.slot, seatId: target.seatId },
    }
  }

  #judge(propDef, ctx) {
    // 1) skipWhen：前提不成立时整条不适用（如教室未解析 → 启用/占用/维修命题无意义）
    if (propDef.skipWhen && this.#safeEval(propDef.skipWhen, ctx).satisfied) {
      return this.#entry(propDef, { conclusion: 'NOT_APPLICABLE' })
    }

    // 2) 依赖事实的可得性路由（第 08 章 §三：不可得 ≠ 不成立）
    const missing = propDef.dependsOn.filter((f) => ctx.facts[f]?.state !== 'obtained')
    if (missing.length === 0) {
      return this.#judgePrimary(propDef, ctx)
    }
    if (propDef.degraded) {
      return this.#judgeDegraded(propDef, ctx)
    }
    return this.#judgeUnconfirmable(propDef, ctx, { missing })
  }

  #judgePrimary(propDef, ctx) {
    const evalResult = this.#safeEval(propDef.when, ctx)
    if (evalResult.error) {
      return this.#judgeUnconfirmable(propDef, ctx, { note: evalResult.error })
    }
    if (evalResult.satisfied) {
      // 安全阈值（C5/§五.4）：超阈时"未命中"不得当作"空闲"——降级为无法确认
      if (propDef.satisfiedDowngradeWhen && this.#safeEval(propDef.satisfiedDowngradeWhen, ctx).satisfied) {
        const message = renderTemplate(propDef.satisfiedDowngradeMessage, this.#vars(ctx, evalResult))
        return this.#entry(propDef, { conclusion: 'UNCONFIRMABLE', message, mode: 'primary', downgraded: true })
      }
      return this.#entry(propDef, { conclusion: 'SATISFIED', mode: 'primary' })
    }
    return this.#violated(propDef, ctx, evalResult, 'primary')
  }

  // 降级交叉印证（§2.1 / §三）：用可得事实能给出的最强判断——
  // violatedWhen 成立 → 不成立；否则按 satisfiedBecomes（satisfied=可确证成立 / unconfirmable=保守）
  #judgeDegraded(propDef, ctx) {
    const evalResult = this.#safeEval(propDef.degraded.violatedWhen, ctx)
    if (evalResult.error) {
      return this.#judgeUnconfirmable(propDef, ctx, { note: evalResult.error })
    }
    if (evalResult.satisfied) {
      return this.#violated(propDef, ctx, evalResult, 'degraded')
    }
    if ((propDef.degraded.satisfiedBecomes ?? 'unconfirmable') === 'satisfied') {
      return this.#entry(propDef, { conclusion: 'SATISFIED', mode: 'degraded' })
    }
    const message = renderTemplate(propDef.degraded.unconfirmableMessage, this.#vars(ctx, evalResult))
    return this.#entry(propDef, { conclusion: 'UNCONFIRMABLE', message, mode: 'degraded' })
  }

  // 无降级声明且事实不可得 → 按命题声明的处置：保守拒绝（默认）或豁免继续（仅 C17）
  #judgeUnconfirmable(propDef, ctx, { missing = [], note } = {}) {
    const disposition = propDef.disposition?.unconfirmable ?? 'conservative-reject'
    const template =
      disposition === 'exempt-continue'
        ? propDef.disposition?.unconfirmableMessage
        : propDef.disposition?.unconfirmableMessage ??
          `无法确认「${propDef.semantics}」（依赖事实不可得${missing.length ? `：${missing.join('/')}` : ''}）`
    const message = renderTemplate(template ?? note ?? '', this.#vars(ctx))
    return this.#entry(propDef, {
      conclusion: 'UNCONFIRMABLE',
      message,
      mode: 'primary',
      disposition,
      ...(disposition === 'exempt-continue' ? { exemption: 'C17：I1 显式豁免——未能确认，继续提交' } : {}),
    })
  }

  #violated(propDef, ctx, evalResult, mode) {
    const label = evalResult.label
    const ambiguous = label === 'seats' && ctx.facts.F3?.meta?.ambiguous === true
    let message = ambiguous
      ? propDef.violatedMessageWhenAmbiguous
      : (label && propDef.violatedMessages?.[label]) || propDef.violatedMessage
    message = renderTemplate(message, this.#vars(ctx, evalResult))

    // J2：幂等命中话术必须完整给出已有时段；申请超出已有时段时追加提示
    let appendixApplied = false
    if (propDef.violatedAppendix) {
      const appendixCtx = { ...ctx, matched: evalResult.matched }
      if (this.#safeEval(propDef.violatedAppendix.when, appendixCtx).satisfied) {
        message = `${message} ${propDef.violatedAppendix.message}`
        appendixApplied = true
      }
    }

    const violatedEvent = propDef.violatedEvent ?? 'PROPOSITIONS_FAILED'
    return this.#entry(propDef, {
      conclusion: 'VIOLATED',
      message,
      mode,
      violatedEvent,
      ambiguity: ambiguous || undefined,
      alreadyDone: violatedEvent === 'ALREADY_DONE' || undefined,
      matched: evalResult.matched,
      appendixApplied: appendixApplied || undefined,
    })
  }

  #entry(propDef, partial) {
    const entry = {
      id: propDef.id,
      conclusion: partial.conclusion,
      degradable: propDef.degradable,
      mode: partial.mode,
      message: partial.message,
      basis: [{ proposition: propDef.id }, ...propDef.dependsOn.map((fact) => ({ fact }))],
      ...(partial.violatedEvent ? { violatedEvent: partial.violatedEvent } : {}),
      ...(partial.ambiguity ? { ambiguity: true } : {}),
      ...(partial.alreadyDone ? { alreadyDone: true } : {}),
      ...(partial.exemption ? { exemption: partial.exemption } : {}),
      ...(partial.disposition ? { disposition: partial.disposition } : {}),
      ...(partial.downgraded ? { downgraded: true } : {}),
      ...(partial.appendixApplied ? { appendixApplied: true } : {}),
    }
    return entry
  }

  #safeEval(expr, ctx) {
    try {
      return { ...evaluatePredicate(expr, ctx) }
    } catch (err) {
      // 谓词求值失败（缺上下文/算子误用）→ 无法确认，绝不猜
      return { error: err instanceof JudgmentError ? err.message : `谓词求值失败: ${err.message}` }
    }
  }

  #vars(ctx, evalResult = {}) {
    const f1 = ctx.facts.F1
    const matched = evalResult.matched
    const candidates = (f1?.meta?.candidates ?? [])
      .map((c) => `${c.building} ${c.roomNumber}（${c.capacity ?? '?'} 座）`)
      .join('、')
    return {
      target: ctx.target.classroom,
      matched: matched
        ? { ...matched, slotText: matchedSlotText(matched, this.store.getConstants().time) }
        : undefined,
      matchedValue: evalResult.value,
      candidates,
      threshold: ctx.facts.F4?.meta?.threshold,
    }
  }

  #summarize(results) {
    const violated = results.filter((r) => r.conclusion === 'VIOLATED')
    const unconfirmable = results.filter((r) => r.conclusion === 'UNCONFIRMABLE')
    return {
      satisfied: results.filter((r) => r.conclusion === 'SATISFIED').map((r) => r.id),
      violated: violated.map((r) => ({
        id: r.id,
        degradable: r.degradable,
        event: r.violatedEvent ?? 'PROPOSITIONS_FAILED',
        alreadyDone: r.alreadyDone === true,
      })),
      unconfirmable: unconfirmable.map((r) => ({ id: r.id, disposition: r.disposition ?? 'conservative-reject' })),
      notApplicable: results.filter((r) => r.conclusion === 'NOT_APPLICABLE').map((r) => r.id),
      allSatisfied: violated.length === 0 && unconfirmable.length === 0,
      alreadyDone: violated.some((v) => v.alreadyDone),
      exemptContinue: unconfirmable
        .filter((u) => u.disposition === 'exempt-continue')
        .map((u) => u.id),
      hasDegradableConflict: violated.some((v) => v.degradable),
    }
  }

  #recordEvidence(results) {
    if (!this.evidenceChain) return
    for (const r of results) {
      if (r.conclusion === 'NOT_APPLICABLE') continue
      this.evidenceChain.record({
        phase: 'P2',
        action: `judge:${r.id}`,
        input: { mode: r.mode },
        basis: r.basis,
        conclusion: { outcome: r.conclusion, summary: r.message ?? r.conclusion },
        metadata: { degradable: r.degradable, ambiguity: r.ambiguity === true },
      })
    }
  }
}
