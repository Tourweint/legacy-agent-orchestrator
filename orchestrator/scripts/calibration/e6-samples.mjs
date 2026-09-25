// E6/D7 对照实验样本集（F3 定案：最低样本数 = 30 条）。
// 每条样本：{ text, category, expect }；
//   category: borrow | query | incomplete | flexible | ood
//   expect.intent: 确定样本给出闭集意图；flexible 类不评分意图（只验"不崩溃且不误判超域"）
//   expect.ood: 是否应判超域
// 标签依据：第 03 章 §二（能做的事/不能做的事）+ §八（不纳管清单）。

export const SAMPLES = [
  // —— 借教室（意图明确，8 条）——
  { text: '帮我借下周三下午数智楼222', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '订一下明天上午的123教室', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '我要预约本周五晚上的数智楼111', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '帮忙订后天下午数智楼233', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '下周一上午给我约一间数智楼222', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '借数智楼222，这周五晚上', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '帮我订下周四上午的数智楼222', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '这周六下午借一下数智楼233', category: 'borrow', expect: { intent: 'borrow-classroom', ood: false } },

  // —— 查询可用性（意图明确，6 条）——
  { text: '查一下明天上午数智楼123有没有空', category: 'query', expect: { intent: 'query-classroom-availability', ood: false } },
  { text: '数智楼222下周三下午空不空', category: 'query', expect: { intent: 'query-classroom-availability', ood: false } },
  { text: '帮我看看本周五晚上数智楼111能不能用', category: 'query', expect: { intent: 'query-classroom-availability', ood: false } },
  { text: '明天数智楼233被订了吗', category: 'query', expect: { intent: 'query-classroom-availability', ood: false } },
  { text: '下周一上午222教室还有安排吗', category: 'query', expect: { intent: 'query-classroom-availability', ood: false } },
  { text: '帮我确认一下后天下午数智楼123的占用情况', category: 'query', expect: { intent: 'query-classroom-availability', ood: false } },

  // —— 槽位不全（意图可判、必有缺口，6 条；不评分具体槽位）——
  { text: '帮我借一间教室', category: 'incomplete', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '借数智楼222', category: 'incomplete', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '帮我预约数智楼111', category: 'incomplete', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '明天上午借教室', category: 'incomplete', expect: { intent: 'borrow-classroom', ood: false } },
  { text: '查一下数智楼222', category: 'incomplete', expect: { intent: 'query-classroom-availability', ood: false } },
  { text: '下周一下午的教室还有吗', category: 'incomplete', expect: { intent: 'query-classroom-availability', ood: false } },

  // —— 意图多义（flexible：只验不崩溃、不误判超域；不评分意图，4 条）——
  { text: '数智楼222', category: 'flexible', expect: { intent: null, ood: false } },
  { text: '我想用一下明天的教室', category: 'flexible', expect: { intent: null, ood: false } },
  { text: '周三下午数智楼222怎么样', category: 'flexible', expect: { intent: null, ood: false } },
  { text: '我要一间教室', category: 'flexible', expect: { intent: null, ood: false } },

  // —— 超域（6 条；第 03 章 §八 不纳管清单）——
  { text: '帮我的饭卡充两百块钱', category: 'ood', expect: { intent: null, ood: true } },
  { text: '我忘记密码了怎么办', category: 'ood', expect: { intent: null, ood: true } },
  { text: '帮我做一下今天的签到', category: 'ood', expect: { intent: null, ood: true } },
  { text: '办公室的投影仪坏了，报修一下', category: 'ood', expect: { intent: null, ood: true } },
  { text: '帮我请三天假', category: 'ood', expect: { intent: null, ood: true } },
  { text: '图书馆的书怎么借', category: 'ood', expect: { intent: null, ood: true } },
]
