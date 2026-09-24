# 编排层（orchestrator）

> 面向**无权修改的存量校园系统**的自然语言任务编排层。
> 不改存量系统一行代码，让它长出自然语言接口。

零第三方依赖 —— 不需要 `npm install`，`node` 直接跑。

---

## 一、它解决什么问题

用户说一句「帮我借周三下午数智楼222」，系统要完成：

1. 把口语解析成结构化意图与槽位（**还缺什么就追问**）
2. 跨 ≥3 个接口、跨 ≥2 个权限域**聚合事实**，判定"这间教室这个时段能不能借"
3. 以**正确的身份**调用接口，**正确的形态**传参
4. 调用之后判定结果 —— 特别是**结果不确定时（超时 / 冲突）不猜，去查证**
5. 出事了能**把系统恢复到可解释的状态**

这五件事里，第 2、4 条是"包一层接口"解决不了的，也是本项目的设计重点。

## 二、模块与命题的对应关系

模块**不是按技术选的**，是从核心命题推出来的（见 `../docs/基线文档/智能体设计.md` §七）。

| 命题 | 模块 | 目录 |
| --- | --- | --- |
| P1 用户要办什么？还缺什么？ | LLM 意图解析 | `src/llm/` |
| P2 现在能不能办？依据什么事实？ | 命题校验 + 事实聚合 | `src/validator/`、`src/state-machine/collectors.js` |
| P3 该以什么身份、什么形态发出？ | 接口注册表 + 防腐网关 | `src/registry/`、`src/gateway/` |
| P4 结果到底是什么？ | 状态机 + 三值判定 + 查证 | `src/state-machine/` |
| P5 出事怎么恢复？ | 补偿（编排式 Saga） | `src/state-machine/compensate.js` |
| P6 凭什么说做对了？ | 执行轨迹（证据链） | `src/common/trace.js` |
| （验证）异常下还成立吗？ | 混沌模块 + 故障代理 | `src/chaos/` |

## 三、目录

```
orchestrator/
├── src/
│   ├── common/          基础设施：三值语义 / 错误 / 轨迹 / 配置 / 时间适配
│   │   ├── tristate.js      ★ 三值语义（SUCCESS / FAILURE / UNKNOWN）—— 全系统的支点
│   │   ├── trace.js         执行轨迹（可解释性的载体）
│   │   ├── errors.js        统一错误类型
│   │   ├── config.js        配置（环境变量优先）
│   │   └── time.js          时间格式适配（存量系统入参带 Z、出参无时区）
│   ├── registry/        接口注册表 —— 边界的可执行载体
│   │   ├── interfaces.js    ★ 每个接口的身份 / 前置命题 / 查证 / 补偿声明
│   │   ├── plans.js         意图 → 任务链模板（LLM 无权决定调哪个接口）
│   │   └── index.js         门面 + 启动自检
│   ├── gateway/         防腐网关
│   │   ├── adapters.js      ★ 三值判定（把存量系统的响应语义归一）
│   │   ├── identity.js      多身份凭证池（ADMIN / TEACHER / STUDENT）
│   │   └── client.js        统一出口（唯一允许 fetch 存量系统的地方）
│   ├── llm/             意图解析（唯一的非确定性来源，必须被隔离）
│   │   ├── prompt.js        提示词从注册表生成，不给 LLM 任何接口信息
│   │   ├── schema.js        输出契约 + 零依赖校验器
│   │   └── parser.js        调用 + Schema 校验 + 重试
│   ├── validator/       命题校验层
│   │   ├── propositions.js  ★ 业务规则 → 可校验命题（P-CLASSROOM-EXISTS 等）
│   │   └── index.js         校验执行器
│   ├── state-machine/   状态机（核心自研）
│   │   ├── states.js        ★ 状态定义 + 转移表（表驱动）
│   │   ├── machine.js       主编排器（P1→P5）
│   │   ├── collectors.js    事实收集（清单由命题 requires 自动推导）
│   │   ├── resolve.js       教室名 → 系统标识
│   │   ├── normalize.js     槽位归一化（"周三"→具体日期）
│   │   ├── verify.js        ★ 业务键查证（把"不确定"收敛为"确定"）
│   │   └── compensate.js    补偿执行
│   ├── chaos/           混沌模块（控制面；执行面在故障代理）
│   └── api/server.js    HTTP 入口
├── config/default.json  配置（密钥只走环境变量）
├── test/selftest.js     离线自检（不依赖存量系统与大模型）
└── scripts/             运维脚本
```

## 四、快速开始

```bash
# 0. 前置：Redis + 存量系统在运行（见 ../deploy/scripts/）

# 1. 离线自检（不需要任何外部依赖）
node test/selftest.js

# 2. 启动编排层（需要 DASHSCOPE_API_KEY）
node src/api/server.js
# → http://localhost:8090

# 3. 一句话办事
curl -X POST http://localhost:8090/api/chat \
  -H "Content-Type: application/json" \
  -d '{"utterance":"帮我借周三下午数智楼222"}'
```

## 五、环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LEGACY_BASE_URL` | `http://localhost:8080` | 存量系统地址（**注意真实路径无 `/api` 前缀**） |
| `LEGACY_TIMEOUT_MS` | `8000` | 单次调用超时 |
| `LEGACY_ADMIN_USER/PASS` | `admin/admin` | 后勤域身份 |
| `LEGACY_TEACHER_USER/PASS` | `233/233` | 教务域写操作身份 |
| `LEGACY_STUDENT_USER/PASS` | `abc/abc` | 座位预约身份 |
| `DASHSCOPE_API_KEY` | — | 大模型 Key（仅用于意图解析） |
| `DASHSCOPE_MODEL` | `qwen-plus` | 模型名 |
| `ORCHES_PORT` | `8090` | 编排层监听端口 |

## 六、对外接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/chat` | 一句话办事（主入口），返回结果 + 执行轨迹 |
| GET | `/api/health` | 存量系统连通性 + 三个身份可用性 |
| GET | `/api/registry` | 接口注册表 / 意图 / 命题（前端展示"边界"用） |
| GET | `/api/machine` | 状态定义与转移表（前端展示状态机用） |
| POST | `/api/reset` | 清空身份缓存 |

## 七、读代码的顺序（给评审/答辩用）

1. `src/common/tristate.js` —— 先理解"为什么必须有三值"，后面全部建立在此之上
2. `src/gateway/adapters.js` —— 三值判定的实现，含那张"HTTP 200 陷阱表"
3. `src/registry/interfaces.js` —— 边界如何被固化成可执行元信息
4. `src/state-machine/states.js` —— 状态与转移，副作用出口的唯一性
5. `src/state-machine/verify.js` —— 最有答辩价值的一段：不确定如何收敛
6. `src/llm/index.js` —— LLM 的能力被限制在哪，以及为什么

## 八、设计纪律（改动代码前必读）

1. **副作用只能从 `SUBMITTING` 状态发出**（`states.js: canWrite`）
2. **LLM 不决定调哪个接口**，只产出意图与槽位；映射由注册表完成
3. **新建写接口必须同时声明 `verifyBy` 与 `compensate`**，否则启动自检报错
4. **不得把 `UNKNOWN` 当成 `FAILURE`**，必须走查证
5. **不得为省事复用高权限身份**，按接口规定的最小身份取用
6. **不得绕过网关直接调存量系统**，否则三值判定与身份选择会被绕过

详见 `../docs/基线文档/智能体设计.md` §七、§八。
