// 三条结构性约束的机器检查 —— 第 02 章 §四：约束要设计成"能被一条 grep 式规则判否"。
//
// 约束 A（唯一 HTTP 出口）：发起对存量系统请求的写法只允许出现在 src/contact/http-transport.js；
//   存量系统地址（端口/base URL 字面量）不允许出现在任何代码里——它来自 constants.yaml。
//   注意区分：src/access/ 的 node:http 是【服务端监听】（对外入口，L1 职责），不是出站请求——
//   放行 import，但 http.request/fetch 等出站写法仍然只允许在传输层。
//   src/understanding/llm-client.js 的 fetch 是【LLM API 调用】（约束 C 的执行体）——与存量
//   系统出口无关，随阶段 5 加入白名单。
// 约束 C（唯一非确定性入口）：大模型客户端用法只允许出现在 src/understanding/。
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
const HTTP_EXIT_ALLOWLIST = new Set([join('src', 'contact', 'http-transport.js'), join('src', 'understanding', 'llm-client.js')])
// 服务端监听放行目录（node:http import 仅限接入层）
const SERVER_IMPORT_ALLOWLIST = new Set([join('src', 'access')])
// 约束 C：LLM 用法放行目录（阶段 5 起为 src/understanding）
const LLM_ALLOWLIST = new Set([join('src', 'understanding')])

// 约束 A：出站请求写法（只允许出现在 HTTP_EXIT_ALLOWLIST）
const OUTBOUND_CLIENT_PATTERN =
  /\bfetch\s*\(|require\(['"]http|axios|XMLHttpRequest|\bundici\b|https?\.(get|post|put|delete|request)\s*\(/
// 约束 A：服务端监听写法（node:http 只允许出现在接入层）
const SERVER_IMPORT_PATTERN = /node:http\b/
// 约束 A：存量系统地址字面量（必须来自 constants.yaml）
const LEGACY_ADDRESS_PATTERN = /localhost:8080|127\.0\.0\.1:8080|ORCH_LEGACY_BASE_URL/
// 约束 C：大模型客户端写法（只允许出现在 LLM_ALLOWLIST）
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
  const serverViolations = []
  const addressViolations = []
  const llmViolations = []

  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/')
    const relKey = join(...rel.split('/'))
    const inServerLayer = [...SERVER_IMPORT_ALLOWLIST].some((dir) => relKey.startsWith(join(...dir.split('/'))))
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const loc = `${rel}:${i + 1}`
      // 纯注释行不参与判否：注释里描述约束（如"需要 DASHSCOPE_API_KEY"）不等于在代码里使用它
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      if (OUTBOUND_CLIENT_PATTERN.test(line) && !HTTP_EXIT_ALLOWLIST.has(relKey)) {
        httpViolations.push(`${loc} —— 出站请求写法出现在唯一出口之外: ${line.trim().slice(0, 80)}`)
      }
      if (SERVER_IMPORT_PATTERN.test(line) && !inServerLayer) {
        serverViolations.push(`${loc} —— node:http 服务端用法只允许在 src/access/: ${line.trim().slice(0, 80)}`)
      }
      if (LEGACY_ADDRESS_PATTERN.test(line)) {
        addressViolations.push(`${loc} —— 存量系统地址字面量（应来自 constants.yaml）: ${line.trim().slice(0, 80)}`)
      }
      if (LLM_CLIENT_PATTERN.test(line) && ![...LLM_ALLOWLIST].some((dir) => relKey.startsWith(join(...dir.split('/'))))) {
        llmViolations.push(`${loc} —— 大模型客户端用法（约束 C）: ${line.trim().slice(0, 80)}`)
      }
    })
  }

  const results = [
    check(`约束 A：出站请求只出现在 ${[...HTTP_EXIT_ALLOWLIST].join(', ')}`, httpViolations),
    check('约束 A：node:http 服务端用法只在 src/access/（对外入口，非出站）', serverViolations),
    check('约束 A：存量系统地址不出现在代码字面量中', addressViolations),
    check('约束 C：大模型客户端用法只在 src/understanding/（唯一非确定性入口）', llmViolations),
  ]
  console.log('='.repeat(64))
  console.log(`结果：${results.filter(Boolean).length}/4 通过`)
  if (results.some((r) => !r)) process.exitCode = 1
}

main()
