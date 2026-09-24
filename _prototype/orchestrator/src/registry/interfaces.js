/**
 * 接口注册表 —— 边界的可执行载体。
 *
 * 设计依据：docs/基线文档/智能体设计.md 命题 P3
 *   「这次调用应该以什么身份、什么形态发出？」
 *
 * 为什么需要一张注册表，而不是把接口地址散在代码里：
 *   1. **身份**：每个接口需要的角色不同（实测分裂为 ADMIN / TEACHER / STUDENT），
 *      调用方不可自行决定用谁 —— 必须由注册表声明（不变量 I5）。
 *   2. **前置事实**：每个写接口依赖哪些事实，必须显式声明，
 *      否则"漏查维修窗口"这类缺陷会静默发生（不变量 I1）。
 *   3. **可查证性**：能否在超时后判定结果，取决于有没有查证路径。
 *      没有查证路径的接口**不得进入可编排清单**（智能体设计.md 判定原则 3）。
 *   4. **可补偿性**：写接口必须声明失败后如何撤销。
 *
 * 本文件的每一条 `notes` 都是实测结论，不是文档推断。
 * 修改本文件等同于修改系统边界，须同步 业务边界与责任域.md。
 */

/** 角色常量 */
export const Role = Object.freeze({ ADMIN: 'ADMIN', TEACHER: 'TEACHER', STUDENT: 'STUDENT' });

/**
 * @typedef {object} InterfaceSpec
 * @property {string}  id            唯一标识，形如 edu.classroom.detail
 * @property {string}  domain        edu（教务域）| logi（后勤域）
 * @property {string}  method        HTTP 方法
 * @property {string}  path          路径模板，{xxx} 为占位符（**真实路径无 /api 前缀**）
 * @property {string}  summary       一句话说明（人读）
 * @property {string}  requiredRole  调用所需最小身份
 * @property {boolean} sideEffect    是否产生副作用（写入）
 * @property {string|null} keyTemplate 幂等业务键模板，有副作用时必填
 * @property {string|null} verifyBy  查证接口 ID（结果不确定时用于收敛）
 * @property {string|null} compensate 补偿接口 ID（失败时用于撤销自身写入）
 * @property {string[]} preconditions 依赖的命题 ID（见 validator/propositions.js）
 * @property {string}  adapter       响应适配器：edu | logi | raw
 * @property {boolean} [uncompensable] true = 该接口的副作用**不可撤销**，此处显式登记。
 *   不变量 I6 的原文是"必须被补偿**或显式登记为不可补偿**"——本字段就是那个"显式登记"。
 * @property {boolean} [orchestrable]  false = 不参与自动编排（例如仅用于构造演示场景的工具接口）
 * @property {string[]} notes        实测注意事项
 */

/** @type {InterfaceSpec[]} */
export const INTERFACES = [
  // ---------------- 认证（非业务，供网关换取 token） ----------------
  {
    id: 'auth.login',
    domain: 'edu',
    method: 'POST',
    path: '/auth/login',
    summary: '登录换取 AccessToken',
    requiredRole: null, // 登录本身不需要身份
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'edu',
    notes: [
      '需要请求头 X-Device-Id（实测缺失会导致鉴权异常）',
      '可用账号：admin/admin（ADMIN）、233/233（TEACHER）、abc/abc（STUDENT）',
      '上游部署文档写的 student01/student01 是错的，实测 401',
    ],
  },

  // ---------------- 教务域：事实查询 ----------------
  {
    id: 'edu.classroom.detail',
    domain: 'edu',
    method: 'GET',
    path: '/classrooms/{classroomId}',
    summary: '查询教室详情（含容量、状态）',
    requiredRole: Role.TEACHER,
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'edu',
    notes: ['`status` 是教室可用性的第三个来源（前两个是预约占用与维修窗口）'],
  },
  {
    id: 'edu.classroom.available',
    domain: 'edu',
    method: 'GET',
    path: '/classrooms/available_list',
    summary: '按楼栋/容量筛选可用教室',
    requiredRole: Role.TEACHER,
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'edu',
    notes: [
      '⚠️ 参数只有 building / min_capacity，**没有时间字段** —— 答不了"这个时段是否可用"',
      '⚠️ **min_capacity 是必填参数**：实测缺失时返回业务码 500「系统内部错误」，而非 400 —— 参数校验失败被表达成了服务端错误',
      '本接口只能用于"按条件挑教室"，不能用于时段冲突判定',
    ],
  },
  {
    id: 'edu.classroom.seats',
    domain: 'edu',
    method: 'GET',
    path: '/classrooms/{classroomId}/seats',
    summary: '查询教室座位布局',
    requiredRole: Role.TEACHER,
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'edu',
    notes: ['返回 seatVOS 数组，元素含 id/seatNumber/status'],
  },
  {
    id: 'edu.classroom.reservedSeats',
    domain: 'edu',
    method: 'GET',
    path: '/classrooms/{classroomId}/reserved_seats',
    summary: '查询某时段已被占用的座位',
    requiredRole: Role.TEACHER,
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'edu',
    notes: [
      '⚠️ 返回的是**座位 ID 数组**，而写操作是整间教室粒度 —— 读写粒度不一致，需上层推导',
      '入参 start_time / end_time 为 OffsetDateTime（带 Z）',
      '判定口径：该时段占用座位数 > 0 → 视为整间教室不可用（口径由 validator 统一，勿在别处另行判断）',
    ],
  },

  // ---------------- 后勤域：事实查询 ----------------
  {
    id: 'logi.maintenance.list',
    domain: 'logi',
    method: 'GET',
    path: '/admin/maintenance',
    summary: '查询教室维修窗口',
    requiredRole: Role.ADMIN,
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'logi',
    notes: [
      '⚠️ 权限实测：仅 ADMIN 可访问；**TEACHER 与 STUDENT 均被拒**（HTTP 403，过滤器层）',
      '→ 这正是"跨权限域"的硬证据：教务侧身份**读不到**维修事实，判定"能否借"必须换身份',
      '种子数据里两条维护窗口均为 CANCELLED；"教室在检修"需现场用 ADMIN 接口创建',
      '判定口径：status 不在 CANCELLED 集合内、且时段与申请时段重叠 → 该教室不可用',
      '⚠️ 出参字段为 camelCase（resourceType/resourceId/startTime），与入参的 snake_case 不一致',
    ],
  },

  // ---------------- 教务域：写入 ----------------
  {
    id: 'edu.reservation.classroom.create',
    domain: 'edu',
    method: 'POST',
    path: '/reservations/classrooms',
    summary: '提交整间教室预约申请',
    requiredRole: Role.TEACHER,
    sideEffect: true,
    keyTemplate: '{classroomId}|{start}|{end}',
    verifyBy: 'logi.reservation.list',
    compensate: 'edu.reservation.cancel',
    preconditions: ['P-CLASSROOM-EXISTS', 'P-CLASSROOM-ENABLED', 'P-NOT-ALREADY-MINE', 'P-SLOT-FREE', 'P-NOT-UNDER-MAINTENANCE'],
    adapter: 'edu',
    notes: [
      '⚠️ 冲突时返回 HTTP 200 + body code=409 —— 只看 HTTP 状态码会误判为成功',
      '⚠️ 409 是**歧义信号**：无法区分"你自己刚才已成功"与"别人占了" → 必须查证',
      '⚠️ ADMIN 身份调用返回 HTTP 200 + code=403（方法层拒绝），与过滤器层的 HTTP 403 表达不一致',
      '入参 classroom_id / start_time / end_time / reason，为 snake_case',
      '实测无幂等键、无唯一约束；重复提交靠"查冲突"拦截，并发下仍可能双双通过 → 幂等由编排层负责',
    ],
  },
  {
    id: 'edu.reservation.seat.create',
    domain: 'edu',
    method: 'POST',
    path: '/reservations/seats',
    summary: '提交座位预约',
    requiredRole: Role.STUDENT,
    sideEffect: true,
    keyTemplate: '{seatId}|{start}|{end}',
    verifyBy: 'edu.reservation.mine',
    compensate: 'edu.reservation.cancel',
    preconditions: ['P-SEAT-EXISTS', 'P-SEAT-SLOT-FREE'],
    adapter: 'edu',
    notes: [
      '入参 seat_id（snake），与教室预约的 classroom_id 风格一致，但与 admin 系列接口的 camelCase 不一致',
      '本项目的编排主轴是教室级，本接口仅作为"粒度差异"的对照存在',
    ],
  },

  // ---------------- 教务域：查证与补偿 ----------------
  {
    id: 'edu.reservation.mine',
    domain: 'edu',
    method: 'GET',
    path: '/reservations',
    summary: '查询当前身份的预约列表',
    requiredRole: Role.TEACHER,
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'edu',
    notes: [
      '⚠️ 查证能力不足：返回当前身份的**全量**预约，需在内存中按 (教室, 时段) 比对',
      '由于身份决定可见范围，用它查证时必须使用**发起写入时的同一身份**',
    ],
  },
  {
    id: 'edu.reservation.cancel',
    domain: 'edu',
    method: 'DELETE',
    path: '/reservations/{reservationId}',
    summary: '撤销预约（补偿动作）',
    requiredRole: Role.TEACHER,
    sideEffect: true,
    keyTemplate: null, // 补偿动作自身不需要幂等键：重复撤销的影响是幂等的（记录已不存在）
    verifyBy: 'edu.reservation.mine',
    compensate: null,
    uncompensable: true, // 它本身就是补偿动作，没有"撤销补偿"这回事
    preconditions: [],
    adapter: 'edu',
    notes: [
      '⚠️ 补偿**不保证成功**：若记录已进入不可撤销状态，撤销会失败',
      '失败时必须显式登记为"不可补偿"，不得静默吞掉（不变量 I6）',
    ],
  },

  // ---------------- 后勤域：写证支点 ----------------
  {
    id: 'logi.reservation.list',
    domain: 'logi',
    method: 'GET',
    path: '/admin/reservations',
    summary: '管理端查询预约（跨身份可见，用作查证支点）',
    requiredRole: Role.ADMIN,
    sideEffect: false,
    keyTemplate: null,
    verifyBy: null,
    compensate: null,
    preconditions: [],
    adapter: 'logi',
    notes: [
      '⚠️ keyword 参数语义模糊：实测 keyword=4 会命中 resourceId=6 的记录（疑似多字段模糊匹配），**不可用于精确过滤**',
      '✅ 不带参数时返回**全量列表**（实测 87 条，纯数组非分页对象）—— 这是可靠的用法',
      '⚠️ 无分页参数，数据量增大后无法保证全量 → 编排层对此有安全阈值（见 verify.js）',
      '⚠️ 权限实测：ADMIN 可访问；TEACHER 与 STUDENT 均被拒（HTTP 403）',
      '它的价值在于**跨身份可见**：Agent 提交时用 TEACHER、查证时用 ADMIN，这是幂等机制的关键支点',
    ],
  },
  {
    id: 'logi.maintenance.create',
    domain: 'logi',
    method: 'POST',
    path: '/admin/maintenance',
    summary: '创建维修窗口（用于构造演示场景）',
    requiredRole: Role.ADMIN,
    sideEffect: true,
    keyTemplate: '{resourceType}|{classroomId}|{start}',
    verifyBy: 'logi.maintenance.list',
    compensate: null,
    uncompensable: true,       // 存量系统只提供"创建/取消"，没有按 ID 删除，故显式登记为不可补偿
    orchestrable: false,       // 演示工具接口：由人工/脚本调用，不进入自动编排链路
    preconditions: [],
    adapter: 'logi',
    notes: [
      '⚠️ 同一请求体内命名混用：resourceType（camel）+ start_time（snake）—— 异构的实证',
      '本接口在演示中用于"现场把教室置为检修中"，从而触发自动降级换教室分支',
    ],
  },
];

/** 按 ID 建索引 */
const BY_ID = new Map(INTERFACES.map((s) => [s.id, Object.freeze(s)]));

export function getInterface(id) {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`未登记的接口：${id}`);
  return spec;
}

export function hasInterface(id) {
  return BY_ID.has(id);
}

/** 全部可编排的写接口（有副作用且参与自动编排的） */
export function sideEffectInterfaces() {
  return INTERFACES.filter((s) => s.sideEffect && s.orchestrable !== false);
}

/** 候选清单自检：写接口必须具备可查证性，以及"可补偿或显式登记不可补偿" */
export function auditRegistry() {
  const problems = [];
  for (const s of INTERFACES) {
    if (!s.sideEffect) continue;
    if (!s.verifyBy) problems.push(`${s.id}: 有副作用但未声明 verifyBy（无法收敛 UNKNOWN）`);
    if (!s.compensate && !s.uncompensable) {
      problems.push(`${s.id}: 有副作用，但既未声明 compensate，也未显式登记 uncompensable —— 违反不变量 I6`);
    }
    if (s.compensate && !hasInterface(s.compensate)) {
      problems.push(`${s.id}: compensate 指向未登记的接口 ${s.compensate}`);
    }
    if (s.verifyBy && !hasInterface(s.verifyBy)) {
      problems.push(`${s.id}: verifyBy 指向未登记的接口 ${s.verifyBy}`);
    }
    if (s.orchestrable !== false && !s.sideEffect && s.preconditions.length === 0 && s.requiredRole == null && s.id !== 'auth.login') {
      // 既无副作用、又无前置命题、又不需要身份的接口，通常意味着登记不完整
      problems.push(`${s.id}: 登记信息不完整（无副作用 / 无前置命题 / 无所需身份）`);
    }
  }
  return problems;
}
