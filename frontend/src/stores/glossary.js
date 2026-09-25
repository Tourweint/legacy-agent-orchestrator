// 术语对照表状态（Pinia）—— 零术语纪律的前端落点。
//
// 纪律（三审 P1-3 / 界面方案 M1/N6）：
//   · 界面上不出现 P-XXX / R1 / F4 这类内部编号，一律显示人话名
//   · 人话名的**唯一来源是引擎配置**（下发自 GET /api/meta/glossary）——界面不写死第二份，
//     否则规则表/命题清单一改，界面就开始说谎
//   · 对照表拿不到时**原样显示编号并留痕**：诚实但不好看，好过编一个人话名骗自己

import { defineStore } from 'pinia'
import { apiGlossary } from '../api/client.js'

export const useGlossaryStore = defineStore('glossary', {
  state: () => ({
    facts: {},
    propositions: {},
    rules: {},
    loaded: false,
    failed: false,
  }),

  getters: {
    /** 查不到就原样返回编号（不隐藏、不编造） */
    factName: (s) => (id) => s.facts[id] ?? id,
    propositionName: (s) => (id) => s.propositions[id] ?? id,
    ruleName: (s) => (id) => s.rules[id] ?? id,
  },

  actions: {
    async load() {
      const res = await apiGlossary()
      if (res.code !== 0 || !res.data) {
        this.failed = true
        console.error('[glossary] 术语对照表加载失败，界面将显示内部编号', res.message)
        return
      }
      this.facts = res.data.facts ?? {}
      this.propositions = res.data.propositions ?? {}
      this.rules = res.data.rules ?? {}
      this.loaded = true
      this.failed = false
    },

    reset() {
      this.facts = {}
      this.propositions = {}
      this.rules = {}
      this.loaded = false
      this.failed = false
    },
  },
})
