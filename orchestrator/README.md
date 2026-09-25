# orchestrator —— 编排引擎

**面向存量业务系统的 AI 任务编排平台**的自研核心。实现按
[`docs/设计方案/2026-09-24-系统设计方案/13-开发手册.md`](../docs/设计方案/2026-09-24-系统设计方案/13-开发手册.md)
的 **9 阶段（0–8）** 推进。

## 当前状态：阶段 0–8 全部完成（2026-09-25）

L1–L5 五层与混沌层均已落地，对外入口已开放（8090），并经混沌实验 D0–D6 验证（留档 `docs/实验/`）：

| 层 | 目录 | 阶段 | 职责 |
|---|---|---|---|
| 规范口径 | `src/canonical/` | 0 | 时间语义（全系统唯一解析点）、教室名归一化 |
| 证据层 | `src/evidence/` | 0 | 证据链 + 模型输出留档 + 凭证剔除 |
| 接触层 | `src/contact/` | 1 | 唯一 HTTP 出口、身份池、协议适配、三值判定 |
| 判定层 | `src/judgment/` | 2 | 事实收集（F1–F6）+ 命题判定（`propositions.yaml` 为数据） |
| 编排层 | `src/orchestration/` | 3 | 表驱动状态机、重试/降级/补偿决策、查证收敛 |
| 接入层 | `src/access/` | 4 | 对外 HTTP 入口与 SSE 事件流（与证据链同源） |
| 理解层 | `src/understanding/` | 5 | 自然语言 → 结构化意图（唯一非确定性入口） |
| 混沌 | `src/chaos/` | 6 | 出站管道命令式故障注入（**默认撤防**） |

对外接口与事件 schema 见 [`docs/基线文档/对外接口清单.md`](../docs/基线文档/对外接口清单.md)（Gate 3 登记件）。

## 目录

```text
orchestrator/
  config/                      配置数据（数据，不是逻辑——第 02 章 §八）
    constants.yaml             常量集合：三段区间/状态集/阈值/循环上限/超时
    interface-registry.yaml    接口注册表：12 接口 × 13 字段，含全部实测注意事项
    intent-plans.yaml          意图计划：意图闭集、槽位、步骤链、命题、降级
    identity-declarations.yaml 身份声明：身份 → 绑定账号 → 凭证环境变量名（不存值）
    propositions.yaml          命题声明：F1–F6 事实与 7 条命题的依赖关系
    state-machine.yaml         状态机转移表：第 04 章 §五 的数据落地（自检 1–7 的输入）
  src/
    canonical/                 时间口径与命名归一化
    config/config-store.js     配置访问入口：业务逻辑读配置的唯一途径（含完整性校验）
    evidence/                  证据层：证据链 + 模型输出留档 + 凭证剔除
    contact/                   接触层：http-transport（唯一 HTTP 出口）/ identity-pool / adapters / verdict-rules
    judgment/                  判定层：fact-collectors / predicates / judgment-engine
    orchestration/             编排层：state-machine / task-runner / run-engine / verifier / chat-bridge
    access/                    接入层：http-server / event-stream / task-store / main（npm start 入口）
    understanding/             理解层：llm-client / prompt（零接口信息）/ schema（三道闸门）
    chaos/                     混沌：chaos-controller（接口 + 第 N 次调用粒度）
  scripts/
    structure-check.mjs        结构自检入口：第 04 章 §十一 的 8 条
    constraint-check.mjs       三条结构性约束的 grep 式判否（约束 B 由结构自检承接）
    run-chaos-experiments.mjs  混沌实验 D0–D6（需存量系统在线；默认撤防，实验内布防）
    run-calibrations.mjs       参数标定执行器（B3/C16/E1/E6·D7/H3，需 DASHSCOPE_API_KEY）
    smoke-contact.mjs          对在线存量系统的真实只读冒烟
  test/                        node:test（内置 runner，零测试依赖）
```

## 运行

```bash
npm install       # 首次
npm test          # 全部测试（140 个）
npm run check     # 8 条结构自检 + 4 条约束检查（每次改动后必跑——不过不允许继续开发，决策 B6）
npm run experiment # 混沌实验 D0–D6（需存量系统在线）
npm start         # 启动引擎（8090；前置：存量系统 8080 与 Redis 就绪；凭证走环境变量）
#   ORCH_LEGACY_ADMIN_PASSWORD=admin ORCH_LEGACY_TEACHER_PASSWORD=233 npm start
```

测试需要 Node.js ≥ 20（`engines` 已约束）。`npm test` 自包含（不依赖数据库 / Redis / 存量系统）；`npm run experiment` 与 `smoke-contact.mjs` 需要存量系统在线，`run-calibrations.mjs` 另需 `DASHSCOPE_API_KEY`。

## 依赖登记（第 13 章 §5.1 "按需"档，逐个论证）

| 依赖 | 档 | 理由 |
|---|---|---|
| `yaml` | 按需 | 配置格式已决策为 YAML（A1：需注释承载每条接口的实测注意事项）；Node 无内置 YAML 解析；`yaml` 是单一职责解析库，不引入任何框架性约束。测试框架用内置 `node:test`（决策 I3），未引入测试依赖 |

**依赖数量与三条结构性约束无关**（第 02 章 §4.2）：约束约束的是位置，不是工具。

## 实现纪律（每个后来者必读）

1. **三条结构性约束**（第 02 章 §四）：唯一 HTTP 出口（只有接触层）、唯一副作用出口（只有编排层提交态）、唯一非确定性入口（只有理解层）。约束约束的是**位置**。
2. **禁止硬编码**：接口路径 / 字段名 / 身份名 / 状态值集合 / 循环上限 / 超时值——一律来自 `config/`，经 `config-store.js` 读取，不得自行解析 YAML。
3. **时间只许一处解析**：出参时间字符串的 UTC 解释、入参 Z 构造、三段区间换算全部在 `canonical/time.js`；业务代码里出现"本地时区"即为违规（第 06 章 §6.3 规格 5）。
4. **凭证不落痕**：密码只从环境变量取（名字登记在身份声明里）；证据链写入时自动剔除凭证字段并截断超长片段。
5. **六份配置** 改任何一处，都要同步 `docs/` 对应章节并走变更记录；自检不过不允许继续开发。
6. **混沌默认撤防**：演示路径不得开启；实验内布防，界面 ⚠ 徽章保证"看到的失败能归因"（第 09 章 §七）。
7. **不碰 `mock-legacy/`**（零侵入），不在代码 / 文档 / 提交中出现真实凭据。

## 与文档的映射

| 交付物 | 依据章节 |
|---|---|
| 时间口径模块 | 第 06 章 §6.3/§6.4（C8）、第 08 章 §7.2/§7.4/§7.5（K2/C19/J4） |
| 常量集合 | 第 13 章 §二 交付物 2；权威值见决策汇总（K1=60、K=5、ACTIVE 集、3s 等） |
| 接口注册表 | 第 01 章 §四（13 字段）/ §五（12 条）/ §七（M1–M8）、W13 分叉 |
| 意图计划 | 第 13 章 §4.2、第 03 章闸门一/三、第 08 章 §五/§八、D7 多资源 |
| 身份声明 | 第 13 章 §4.3、第 06 章 §2.2（业务身份绑定唯一账号） |
| 命题声明 | 第 08 章 §二/§三/§五（6 事实 / 7 命题、三态、排除法） |
| 状态机表 | 第 04 章 §五 全部转移表 + §5.6/§5.7/§5.8/§5.9 |
| 结构自检 | 第 04 章 §十一 与第 13 章 §三（三审对齐稿） |
| 证据层 | 第 13 章 阶段 0 证据层契约、第 05 章 §八、C16 |
| 接触层/判定层/编排层/接入层 | 第 05 章（W1–W13/R1–R10）、第 06 章、第 07 章、第 10 章 §6.3 |
| 理解层 | 第 03 章（三道闸门、零接口信息、ISO 时间契约拒绝） |
| 混沌 | 第 09 章（注入点、响应丢弃而非伪造、D0–D7） |
