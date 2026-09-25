// 配置访问入口测试 —— 数据完整性（第 13 章 §四 纪律 2：缺必填字段 = 缺陷）与语义化查询

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore, ConfigError } from '../src/config/config-store.js'

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'config')

function makeTmpStore(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-config-'))
  cpSync(CONFIG_DIR, dir, { recursive: true })
  try {
    mutate(dir)
    return { store: new ConfigStore(dir), dir }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

test('装载全部配置：14 条接口、4 个意图、3 个身份、15 个状态', () => {
  const store = new ConfigStore(CONFIG_DIR)
  // 12 → 14：新增 auth.refresh / auth.logout（登录会话续期与登出，登录方案决定 6）
  assert.equal(store.allInterfaces.length, 14)
  // 2 → 4：C7 上线（查询我的预约 / 撤销我的预约）
  assert.equal(store.intentList.length, 4)
  assert.equal(store.identityList.length, 3)
  assert.equal(Object.keys(store.getStateMachine().states).length, 15)
})

test('注册表关键标志：自动编排三档（classroom.create 是 / seat.create 否 / maintenance.create 否）', () => {
  const store = new ConfigStore(CONFIG_DIR)
  assert.equal(store.getInterface('edu.reservation.classroom.create').autoOrchestration, true)
  assert.equal(store.getInterface('edu.reservation.cancel').autoOrchestration, true)
  assert.equal(store.getInterface('edu.reservation.seat.create').autoOrchestration, false)
  assert.equal(store.getInterface('logi.maintenance.create').autoOrchestration, false)
})

test('写接口的 N3/N4 声明齐全：有查证路径、有补偿动作或不可补偿登记', () => {
  const store = new ConfigStore(CONFIG_DIR)
  for (const it of store.allInterfaces.filter((i) => i.sideEffect)) {
    assert.ok(it.verification?.via, `${it.id} 缺查证路径（N3）`)
    const comp = it.compensation
    assert.ok(comp?.action || comp?.nonCompensable, `${it.id} 缺补偿声明（N4）`)
  }
  // 撤销接口自身登记为不可补偿（第 01 章 §6.4 ⑩）
  assert.equal(store.getInterface('edu.reservation.cancel').compensation.nonCompensable, true)
})

test('mine 接口身份为 initiator（发起时身份，一审更正口径）', () => {
  const store = new ConfigStore(CONFIG_DIR)
  assert.equal(store.getInterface('edu.reservation.mine').requiredIdentity, 'initiator')
})

test('意图计划：借教室命题顺序先查本人后查占用；查询意图只读', () => {
  const store = new ConfigStore(CONFIG_DIR)
  const borrow = store.getIntent('borrow-classroom')
  assert.equal(borrow.readOnly, false)
  assert.equal(borrow.multiResource, true) // D7：一次借两间
  const mineIdx = borrow.propositions.indexOf('P-NOT-ALREADY-MINE')
  const slotIdx = borrow.propositions.indexOf('P-SLOT-FREE')
  assert.ok(mineIdx !== -1 && slotIdx !== -1 && mineIdx < slotIdx, 'P-NOT-ALREADY-MINE 必须在 P-SLOT-FREE 之前')

  const query = store.getIntent('query-classroom-availability')
  assert.equal(query.readOnly, true)
  assert.equal(query.compensation, null)
  assert.ok(!query.propositions.includes('P-NOT-ALREADY-MINE'))
})

test('常量集合：K1 步数 60、K=5、阈值 500、写超时 3s、三段区间', () => {
  const constants = new ConfigStore(CONFIG_DIR).getConstants()
  assert.equal(constants.limits.taskTotalSteps, 60)
  assert.equal(constants.degrade.candidateLimit, 5)
  assert.equal(constants.verification.listSafetyThreshold, 500)
  assert.equal(constants.timeoutsMs.write, 3000)
  assert.equal(constants.slotOverlap.strictInequality, true)
  assert.deepEqual(constants.reservationStates.active, ['ACTIVE'])
  assert.deepEqual(constants.time.segments.afternoon, { start: '13:00', end: '17:00' })
})

test('配置文件缺失时报错并指出路径', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-empty-'))
  try {
    assert.throws(() => new ConfigStore(dir), (err) => {
      assert.ok(err instanceof ConfigError)
      assert.match(err.message, /配置文件缺失/)
      return true
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('接口缺必填字段 = 缺陷（13 字段纪律）', () => {
  assert.throws(
    () =>
      makeTmpStore((dir) => {
        const path = join(dir, 'interface-registry.yaml')
        const broken = readFileSync(path, 'utf8').replace('    purpose: 登录换取', '    purposeX: 登录换取')
        writeFileSync(path, broken)
      }),
    (err) => err instanceof ConfigError && /缺字段/.test(err.message),
  )
})

test('写接口缺查证路径 → N3 硬门槛报错', () => {
  assert.throws(
    () =>
      makeTmpStore((dir) => {
        const path = join(dir, 'interface-registry.yaml')
        const broken = readFileSync(path, 'utf8')
          .replace('      via: edu.reservation.mine\n      note: 座位预约查证用发起时身份（STUDENT）', '      via: null')
        writeFileSync(path, broken)
      }),
    (err) => err instanceof ConfigError && /N3/.test(err.message),
  )
})

test('意图引用未纳管接口 → 报错', () => {
  assert.throws(
    () =>
      makeTmpStore((dir) => {
        const path = join(dir, 'intent-plans.yaml')
        const broken = readFileSync(path, 'utf8').replace(
          'interface: edu.classroom.detail',
          'interface: edu.classroom.not_registered',
        )
        writeFileSync(path, broken)
      }),
    (err) => err instanceof ConfigError && /未纳管/.test(err.message),
  )
})
