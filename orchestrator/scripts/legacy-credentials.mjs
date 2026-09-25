// 演示账号口令的读取 —— 供 Gate 实测与真实冒烟脚本使用。
//
// 为什么要这个文件：本项目的凭证明文纪律是"口令只从环境变量取，任何地方不落值"。
// 但演示/实测脚本如果要求人手在命令行前挂三个环境变量，命令行里就出现了口令明文——
// 那等于绕了个圈子还是把口令写在了命令历史里。
//
// 做法：**优先环境变量**；缺失时回落到仓库里唯一声明演示账号默认口令的地方——
// `start-all.bat` 的一键启动默认值（它就是"本地演示环境该用哪个账号"的项目级声明）。
// 本文件不包含任何口令字面量，只在运行时读取并返回内存值。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ACCOUNTS = [
  { role: 'ADMIN', username: 'admin', env: 'ORCH_LEGACY_ADMIN_PASSWORD' },
  { role: 'TEACHER', username: '233', env: 'ORCH_LEGACY_TEACHER_PASSWORD' },
  { role: 'STUDENT', username: 'abc', env: 'ORCH_LEGACY_STUDENT_PASSWORD' },
]

/**
 * @returns {{role: string, username: string, env: string, password: string, from: 'env'|'start-all.bat'}[]}
 *          缺少来源时抛错并指明该设哪个环境变量（不猜、不用默认值兜底）
 */
export function loadLegacyCredentials() {
  const bat = readStartAllDefaults()
  return ACCOUNTS.map((account) => {
    const fromEnv = process.env[account.env]
    if (fromEnv) return { ...account, password: fromEnv, from: 'env' }
    const fromBat = bat[account.env]
    if (fromBat) return { ...account, password: fromBat, from: 'start-all.bat' }
    throw new Error(
      `缺少 ${account.env}：既没有设该环境变量，也没在 start-all.bat 找到演示账号默认值。\n` +
        `请以环境变量注入（不要写进任何文件）：${account.env}=... node <script>`,
    )
  })
}

function readStartAllDefaults() {
  const out = {}
  let text
  try {
    text = readFileSync(join(ROOT, 'start-all.bat'), 'utf8')
  } catch {
    return out
  }
  for (const account of ACCOUNTS) {
    // 只认 `set "NAME=值"` 这一种形态：文件顶部注释里也会出现 `NAME=...` 的说明文字，
    // 若按裸 `NAME=` 匹配会先命中注释（实测踩过这个坑），那样取到的是说明文字不是口令。
    const match = new RegExp(`set "${account.env}=([^"]+)"`).exec(text)
    if (match) out[account.env] = match[1].trim()
  }
  return out
}
