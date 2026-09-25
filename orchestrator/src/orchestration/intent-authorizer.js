// 意图鉴权 —— 登录方案决定 4/5（影响面 #3/#4）：**按角色决定这条意图能不能发起**。
//
// 两条硬要求（决定 5 + 不变量 I5）：
//   ① 判权限发生在**任何调用之前**——不通过就直接拒绝，绝不"先用高权限身份试试看"
//   ② 拒绝要有依据地说清"为什么不行 + 谁能办 + 我能替你做什么"（不是"操作失败"）
//
// 判据来自意图计划（intent-plans.yaml）的 requiredRole / allowedRoles 声明——权限也是配置数据，
// 不是散落在代码里的 if。角色一律取自登录响应（决定 2），不接受前端传入。
//
// 零术语纪律：角色枚举不上屏，一律用中文说法（教师/学生/管理员）。

const ROLE_LABELS = { TEACHER: '教师', STUDENT: '学生', ADMIN: '管理员' }

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? (role ? String(role) : '未登录')
}

/**
 * @param {object} p
 * @param {object} p.intent   意图计划（含 requiredRole / allowedRoles / roleDeniedMessage / roleAlternatives）
 * @param {object} p.identity { id, role }
 * @returns {null|{required: string, actual: string|null, message: string, alternatives: string[]}}
 *          返回 null = 允许；返回对象 = 有依据的拒绝
 */
export function authorizeIntent({ intent, identity }) {
  const required = intent?.requiredRole
  if (!required) return null
  const actual = identity?.role ?? null
  const allowed = [required, ...(intent.allowedRoles ?? [])]
  if (allowed.includes(actual)) return null
  return {
    required,
    actual,
    message: intent.roleDeniedMessage ?? defaultDeniedMessage(intent, required, actual),
    alternatives: intent.roleAlternatives ?? [],
  }
}

function defaultDeniedMessage(intent, required, actual) {
  return `「${intent.name}」需要${roleLabel(required)}身份，您当前是${roleLabel(actual)}身份，因此不能代办。`
}
