// 展示用名称映射 —— 界面上的"人话名"有三个来源，别混：
//   1. 命题 / 事实 / 规则 / 意图 / 槽位 → **引擎下发**（GET /api/meta/glossary → stores/glossary.js）
//   2. 接口的业务语义名 → **事件自带的 text**（引擎从接口注册表派生，
//      见 orchestrator/src/access/event-stream.js 的 buildInterfaceNames）
//   3. 身份的显示名 → 本文件（引擎只给 ADMIN/TEACHER/STUDENT 这类标识，中文名是展示层的事）
//
// 历史（值得记一笔）：这里曾有一份 `INTERFACE_NAMES`（接口 id → 中文名）。删掉右侧轨迹面板后
// 暴露出一个洞——`call` 事件本身只带 "ok"，业务名原来是面板去查证据补的；右栏一删，对话里的
// 步骤就只剩 "ok"。修法不是在前端再补一份映射，而是把它**移回引擎、从接口注册表派生**，
// 让事件自带人话。于是这里只剩身份名。

/** 身份的中文显示名（§2.2：身份必须可见）。 */
export const IDENTITY_NAMES = {
  ADMIN: '管理端身份',
  TEACHER: '教师身份',
  STUDENT: '学生身份',
}

/** 身份标识 → 中文显示名；取不到时原样返回（诚实优先于好看）。 */
export function identityName(id) {
  if (!id) return null
  return IDENTITY_NAMES[id] ?? id
}
