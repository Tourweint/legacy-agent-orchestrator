// 术语对照表测试 —— 零术语纪律的机械保证。
//
// 为什么要有它：界面上不许出现 `P-SLOT-FREE`、`R1`、`F4` 这类内部编号（三审 P1-3 /
// 界面方案 M1/N6）。"不许出现"不能靠自觉，得靠机械保证——这里的做法是**反向覆盖**：
// 编号集合从**代码**里取（规则表、事实采集器、命题清单），凡是没有在
// config/glossary.yaml 里起人话名的编号，测试立刻失败。
// 于是"新增一条规则/事实/命题但忘了起名字"这件事不可能溜过去。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from '../src/config/config-store.js'
import { VERDICT_RULES, READ_RETRY_EXHAUSTED } from '../src/contact/verdict-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const store = new ConfigStore()
const glossary = store.getGlossary()

test('规则编号全覆盖：W1–W13 / R1–R10 都有人话名，且名字里不再出现编号', () => {
  const ids = new Set([
    ...VERDICT_RULES.map((r) => r.id),
    READ_RETRY_EXHAUSTED.id,
  ])
  for (let w = 1; w <= 13; w += 1) ids.add(`W${w}`)
  for (let r = 1; r <= 10; r += 1) ids.add(`R${r}`)
  for (const id of ids) {
    const title = glossary.rules[id]
    assert.ok(title, `术语对照表缺规则 ${id} 的人话名`)
    assert.ok(!title.includes(id), `规则 ${id} 的"人话名"里又出现了编号`)
    assert.ok(title.length >= 4, `规则 ${id} 的名字太短，观众看不懂`)
  }
})

test('事实编号全覆盖：事实采集器里出现的每个 F* 都有名字（新增事实必须同步起名）', () => {
  const src = readFileSync(join(ROOT, 'src/judgment/fact-collectors.js'), 'utf8')
  const ids = [...new Set([...src.matchAll(/case '(F\d+)'/g)].map((m) => m[1]))]
  assert.ok(ids.length >= 6, '没扫到事实编号——fact-collectors 的写法变了，本测试的正则要跟着更新')
  for (const id of ids) {
    assert.ok(glossary.facts[id], `术语对照表缺事实 ${id} 的人话名`)
    assert.ok(!glossary.facts[id].includes(id), `事实 ${id} 的"人话名"里又出现了编号`)
  }
})

test('命题全覆盖：名字必须是解释而不是编号复述', () => {
  for (const prop of store.propositions.propositions) {
    const title = glossary.propositions[prop.id]
    assert.ok(title, `缺命题 ${prop.id} 的人话名`)
    assert.ok(!title.includes(prop.id), `命题 ${prop.id} 的"人话名"里又出现了编号`)
  }
})

test('对照表可下发：结构固定为 facts/propositions/rules/slots/intents（界面按此消费）', () => {
  assert.deepEqual(Object.keys(glossary).sort(), ['facts', 'intents', 'propositions', 'rules', 'slots'])
  assert.ok(Object.keys(glossary.facts).length >= 6)
  assert.ok(Object.keys(glossary.propositions).length >= 9)
  assert.ok(Object.keys(glossary.rules).length >= 23)
  // 意图的人话名来自意图计划：每个意图都必须有名字（界面显示"识别为「借教室」"而不是 intentId）
  for (const intent of store.intentList) {
    assert.ok(glossary.intents[intent.id], `意图 ${intent.id} 没有人话名`)
    assert.ok(intent.name, `意图 ${intent.id} 的计划里缺 name`)
  }
})

test('槽位短名全覆盖：意图计划里出现的每个槽位键都有人话短名（界面不显示英文键名）', () => {
  for (const intent of store.intentList) {
    const keys = [
      ...(intent.slots?.required ?? []),
      ...(intent.slots?.optional ?? []),
      ...Object.keys(intent.slots?.slotHints ?? {}),
    ]
    for (const key of keys) {
      assert.ok(glossary.slots[key], `意图 ${intent.id} 的槽位 ${key} 没有短名`)
      assert.ok(!glossary.slots[key].includes(key), `槽位 ${key} 的短名里又出现了英文键名`)
    }
  }
})
