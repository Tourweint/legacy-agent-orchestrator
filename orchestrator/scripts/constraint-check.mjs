// 三条结构性约束的机器检查 —— 第 02 章 §四：约束要设计成"能被一条 grep 式规则判否"。
//
// 约束 A（唯一 HTTP 出口）：发起网络请求的写法只允许出现在 src/contact/http-transport.js；
//   存量系统地址（端口/base URL 字面量）不允许出现在任何代码里——它来自 constants.yaml。
// 约束 C（唯一非确定性入口）：大模型客户端用法不允许出现在任何地方——理解层尚不存在
//   （阶段 5 落地时，本脚本的白名单同步加入 src/understanding/）。
// 约束 B（唯一副作用出口）无法静态 grep——它由 8 条结构自检的 SUBMITTING 入边检查承接。
//
// 用法：node scripts/constraint-check.mjs（已并入 npm run check）

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = [join(ROOT, 'src'), join(ROOT, 'scripts')]
const SELF = fileURLToPath(import.meta.url)

// 约束 A：唯一放行文件（相对路径判定，跨平台）
const HTTP_EXIT_ALLOWLIST = new Set([join('src', 'contact', 'http-transport.js')])

const HTTP_CLIENT_PATTERN =
  /\bfetch\s*\(|node:http\b|node:https\b|require\(['"]http|\baxios\b|XMLHttpRequest|\bundici\b|https?\.(get|post|put|delete|request)\s*\(/
const LEGACY_ADDRESS_PATTERN = /localhost:8080|127\.0\.0\.1:8080|ORCH_LEGACY_BASE_URL/
const LLM_CLIENT_PATTERN =
  /dashscope|openai|anthropic|chat\.completions|completions\/|model\.generate|generateContent/i

function listFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue
      out.push(...listFiles(full))
    } else if (/\.(js|mjs)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function check(name, violations) {
  if (violations.length === 0) {
    console.log(`  [PASS] ${name}`)
    return true
  }
  console.log(`  [FAIL] ${name}`)
  for (const v of violations) console.log(`         └─ ${v}`)
  return false
}

function main() {
  console.log('结构性约束检查（第 02 章 §四，grep 式判否）')
  console.log('='.repeat(64))

  const files = SCAN_DIRS.flatMap(listFiles).filter((f) => f !== SELF)
  const httpViolations = []
  const addressViolations = []
  const llmViolations = []

  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const loc = `${rel}:${i + 1}`
      if (HTTP_CLIENT_PATTERN.test(line) && !HTTP_EXIT_ALLOWLIST.has(join(...rel.split('/')))) {
        httpViolations.push(`${loc} —— 网络请求写法出现在唯一出口之外: ${line.trim().slice(0, 80)}`)
      }
      if (LEGACY_ADDRESS_PATTERN.test(line)) {
        addressViolations.push(`${loc} —— 存量系统地址字面量（应来自 constants.yaml）: ${line.trim().slice(0, 80)}`)
      }
      if (LLM_CLIENT_PATTERN.test(line)) {
        llmViolations.push(`${loc} —— 大模型客户端用法（约束 C）: ${line.trim().slice(0, 80)}`)
      }
    })
  }

  const results = [
    check(`约束 A：网络请求只出现在 ${[...HTTP_EXIT_ALLOWLIST].join(', ')}`, httpViolations),
    check('约束 A：存量系统地址不出现在代码字面量中', addressViolations),
    check('约束 C：大模型客户端用法零出现（理解层未建）', llmViolations),
  ]
  console.log('='.repeat(64))
  console.log(`结果：${results.filter(Boolean).length}/3 通过`)
  if (results.some((r) => !r)) process.exitCode = 1
}

main()
