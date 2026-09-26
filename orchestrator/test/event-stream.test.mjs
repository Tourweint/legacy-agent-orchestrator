// 事件文案测试 —— 界面上看到的"人话"必须由**事件自带**，界面不各自去补。
//
// 为什么要它：删掉右侧轨迹面板后暴露过一个洞——`call` 事件原本只带 "ok"，
// 业务名是靠那个面板去查证据补上的；右栏一删，对话里的步骤就只剩 "ok"。
// 修法是把名字移回引擎、从接口注册表派生，这里把这条钉住。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapEntryToEvent,
  buildInterfaceNames,
  buildPropositionNames,
  shortPurpose,
} from '../src/access/event-stream.js'
import { ConfigStore } from '../src/config/config-store.js'

const store = new ConfigStore()
const interfaceNames = buildInterfaceNames(store.registry)

const callEntry = (over = {}) => ({
  seq: 7,
  taskId: 'T-1',
  phase: 'P3',
  action: 'contact:edu.reservation.classroom.create',
  conclusion: { outcome: 'SUCCESS', summary: 'ok' },
  ...over,
})

test('shortPurpose：取注册表 purpose 的首段（界面上不该念一整串说明）', () => {
  assert.equal(
    shortPurpose('教室详情——把人读名解析成系统 id（实体消解），并读取 status（F1）'),
    '教室详情',
  )
  assert.equal(shortPurpose('提交整间教室预约（主轴写入；唯一副作用出口的目的=正向写入）'), '提交整间教室预约')
  assert.equal(shortPurpose(''), '')
  assert.equal(shortPurpose(undefined), '')
})

test('buildInterfaceNames：从接口注册表派生（注册表是唯一真相源，不另维护映射）', () => {
  assert.equal(interfaceNames['edu.reservation.classroom.create'], '提交整间教室预约')
  assert.ok(Object.keys(interfaceNames).length >= 10, '纳管接口都该有语义名')
})

test('call 事件自带业务语义名；成功时不必把 "ok" 念出来', () => {
  const event = mapEntryToEvent(callEntry(), { interfaceNames })
  assert.equal(event.type, 'call')
  assert.equal(event.text, '提交整间教室预约')
  assert.ok(!event.text.includes('edu.'), '内部接口标识不得出现在展示文案里')
})

test('call 失败：返回内容接在语义名后面（"谁拒绝了这次提交"要看得见）', () => {
  const event = mapEntryToEvent(
    callEntry({ conclusion: { outcome: 'FAILURE', summary: '系统拒绝了这次提交' } }),
    { interfaceNames },
  )
  assert.equal(event.status, 'failed')
  assert.match(event.text, /^提交整间教室预约 · 系统拒绝了这次提交$/)
})

test('映射缺失时给中性说法，不塞接口 id（零术语纪律）', () => {
  const event = mapEntryToEvent(callEntry(), {})
  assert.equal(event.text, '与业务系统交互')
})

test('judge 事件：命题人话名 + 结论人话（枚举值不给用户看）', () => {
  const propositionNames = buildPropositionNames(store.getGlossary())
  const entry = {
    seq: 9,
    taskId: 'T-1',
    phase: 'P2',
    action: 'judge:P-SLOT-FREE',
    conclusion: { outcome: 'VIOLATED', summary: 'VIOLATED' },
  }
  const event = mapEntryToEvent(entry, { propositionNames })
  assert.equal(event.type, 'proposition-judged')
  assert.equal(event.status, 'failed')
  assert.equal(event.text, '这个时段是空的 · 不成立') // 名字来自术语对照表
  assert.ok(!event.text.includes('VIOLATED'))
  assert.ok(!event.text.includes('P-SLOT-FREE'))
})

test('术语对照表缺名字时给中性说法（不把内部编号漏出去）', () => {
  const entry = {
    seq: 9,
    taskId: 'T-1',
    phase: 'P2',
    action: 'judge:P-NOT-REGISTERED',
    conclusion: { outcome: 'SATISFIED' },
  }
  const event = mapEntryToEvent(entry, {})
  assert.equal(event.text, '这一项条件 · 成立')
})
