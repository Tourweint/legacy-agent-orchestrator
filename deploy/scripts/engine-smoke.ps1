# =============================================================================
#  引擎真实冒烟（Windows / PowerShell）—— 登录 → 会话 → 只读任务全链路
#
#  为什么要它：项目的既有冒烟脚本是 node（scripts/smoke-contact.mjs，只打接触层）与
#  bash 演示脚本。登录上线后，"进程到底能不能起来、会话与身份派生是否真的生效"必须
#  由一次真实调用证明（AGENTS.md：测试全绿不等于能启动）。本脚本用 PowerShell 的
#  WebSession 天然处理会话 Cookie，正好覆盖浏览器那条路径。
#
#  零副作用：跑的是**只读意图**（查询教室可用性），不创建任何预约。
#
#  前置：存量系统在线（8080）、引擎已启动（默认 8090）、Redis/MariaDB 就绪。
#  用法：
#     powershell -ExecutionPolicy Bypass -File deploy/scripts/engine-smoke.ps1
#     powershell -ExecutionPolicy Bypass -File deploy/scripts/engine-smoke.ps1 -EnginePort 8091
#
#  凭证：优先环境变量；未设时读 start-all.bat 里的演示账号默认值。
#        本脚本不含任何口令字面量。
# =============================================================================
param(
  [int]$EnginePort = 8090,
  [string]$Username = '233',
  [string]$PasswordEnv = 'ORCH_LEGACY_TEACHER_PASSWORD',
  # 默认零写入；加 -IncludeWriteCheck 才跑"借→查→退→复查"闭环（会造一条预约并撤销它）
  [switch]$IncludeWriteCheck
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$base = "http://127.0.0.1:$EnginePort"
$script:failures = 0

function Report($ok, $text) {
  if ($ok) { Write-Host "  [OK]   $text" } else { Write-Host "  [FAIL] $text"; $script:failures++ }
}

function Resolve-Password($envName) {
  $fromEnv = [Environment]::GetEnvironmentVariable($envName)
  if ($fromEnv) { return @{ value = $fromEnv; from = 'env' } }
  $batPath = Join-Path $root 'start-all.bat'
  if (Test-Path $batPath) {
    $bat = Get-Content -Encoding utf8 -Raw $batPath
    # 只认 set "NAME=值" 形态：文件顶部注释里也会出现 NAME=... 的说明文字（踩过这个坑）
    $m = [regex]::Match($bat, 'set "' + [regex]::Escape($envName) + '=([^"]+)"')
    if ($m.Success) { return @{ value = $m.Groups[1].Value.Trim(); from = 'start-all.bat' } }
  }
  throw "缺少 $envName：既没设环境变量，也没在 start-all.bat 找到演示账号默认值"
}

Write-Host "引擎真实冒烟 -> $base（账号 $Username）"
Write-Host ('=' * 68)

# ① 健康检查（同时验证进程真的起来了）
Write-Host "① 健康检查"
$health = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
Report ($health.code -eq 0) "GET /api/health -> status=$($health.data.status) 任务数=$($health.data.tasks) 会话数=$($health.data.sessions)"
Report ($null -ne $health.data.chaos.armed) "健康检查暴露布防状态 chaos.armed=$($health.data.chaos.armed)（录制前可机械断言）"

# ② 未登录：受保护端点必须被拒
Write-Host "② 未登录访问受保护端点"
$payload = '{"intentId":"query-classroom-availability","slot":{"start":"2026-09-27T05:00:00Z","end":"2026-09-27T09:00:00Z"},"resources":[{"classroom":{"classroomId":5}}]}'
$unauthStatus = 0
try {
  Invoke-RestMethod -Method Post -Uri "$base/api/tasks" -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 5 | Out-Null
} catch {
  $unauthStatus = [int]$_.Exception.Response.StatusCode
}
Report ($unauthStatus -eq 401) "未登录 POST /api/tasks -> HTTP $unauthStatus（期望 401）"

# ③ 登录（口令只在内存里，不打印）
Write-Host "③ 登录与会话"
$cred = Resolve-Password $PasswordEnv
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$body = @{ username = $Username; password = $cred.value } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json; charset=utf-8' -Body $body -WebSession $session -TimeoutSec 15
Report ($login.data.role -eq 'TEACHER') "POST /api/auth/login -> role=$($login.data.role) nickname=$($login.data.userInfo.nickname)（口令来源 $($cred.from)）"
Report ($null -eq $login.data.accessToken -and $null -eq $login.data.refreshToken) "登录响应不回带任何令牌（前端只拿会话 Cookie）"

$me = Invoke-RestMethod -Uri "$base/api/auth/me" -WebSession $session -TimeoutSec 5
Report ($me.data.role -eq 'TEACHER') "GET /api/auth/me -> role=$($me.data.role)"

# ④ 只读任务（零副作用）：查询教室可用性——会真的走服务只读身份读跨权限域事实
Write-Host "④ 只读任务全链路（数智楼123，明天下午）"
$accepted = Invoke-RestMethod -Method Post -Uri "$base/api/tasks" -ContentType 'application/json; charset=utf-8' -Body $payload -WebSession $session -TimeoutSec 10
$taskId = $accepted.data.taskId
Report ([bool]$taskId) "POST /api/tasks -> taskId=$taskId"

$snapshot = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  $snapshot = (Invoke-RestMethod -Uri "$base/api/tasks/$taskId" -WebSession $session -TimeoutSec 5).data
  if ($snapshot.status -eq 'terminal') { break }
}
Report ($snapshot.status -eq 'terminal') "任务在 20 秒内到达终态（status=$($snapshot.status)）"
Report ($snapshot.result.terminal -eq 'DONE') "只读链路终态=$($snapshot.result.terminal)（期望 DONE）"
Report ($snapshot.owner -eq $Username) "任务归属 owner=$($snapshot.owner)（= 登录用户）"
Write-Host "  结论：$($snapshot.result.conclusion)"

# ⑤ 证据链：调用条目必须带发起人与使用身份（影响面 #13）
Write-Host "⑤ 证据链：发起人与使用身份"
$evidence = Invoke-RestMethod -Uri "$base/api/tasks/$taskId/evidence" -WebSession $session -TimeoutSec 5
$calls = @($evidence.data.entries | Where-Object { $_.action -like 'contact:*' })
Report ($calls.Count -gt 0) "证据链含 $($calls.Count) 条调用条目"
$missingInitiator = @($calls | Where-Object { $_.initiator -ne $Username })
Report ($missingInitiator.Count -eq 0) "每条调用都记录了发起人（缺失 $($missingInitiator.Count) 条）"
$acting = ($calls | ForEach-Object { $_.actingIdentity } | Sort-Object -Unique) -join ' / '
Write-Host "  [i]    本次使用的身份：$acting（只读链路应只见 服务只读身份）"
Report ($missingInitiator.Count -eq 0) '身份标注完整（本人身份 / 服务只读身份 二选一）'

# ⑥（可选）C7 写链路：造一条预约 → 查我的预约 → 撤销 → 复查。净副作用为零。
#    默认不跑（默认档是"零写入"）；演示前彩排第 6 幕时用 -IncludeWriteCheck 跑一次。
if ($IncludeWriteCheck) {
  Write-Host "⑥ C7 写链路自检（借 → 查 → 退 → 复查；结束时会撤销自己造的预约）"
  $future = (Get-Date).ToUniversalTime().AddDays(20).ToString('yyyy-MM-dd')
  $taskBody = @{
    intentId  = 'borrow-classroom'
    slot      = @{ start = "${future}T05:00:00Z"; end = "${future}T06:00:00Z" }
    resources = @(@{ classroom = @{ classroomId = 5 } })
  } | ConvertTo-Json -Depth 5
  $borrow = Invoke-RestMethod -Method Post -Uri "$base/api/tasks" -ContentType 'application/json; charset=utf-8' -Body $taskBody -WebSession $session -TimeoutSec 10
  $borrowSnap = $null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    $borrowSnap = (Invoke-RestMethod -Uri "$base/api/tasks/$($borrow.data.taskId)" -WebSession $session -TimeoutSec 5).data
    if ($borrowSnap.status -eq 'terminal') { break }
  }
  Report ($borrowSnap.result.terminal -eq 'DONE') "借教室 → $($borrowSnap.result.terminal)（$($borrowSnap.result.conclusion)）"

  # 查我的预约（C7 查）：不传 slot 也能办——这是"目标不是教室"的意图
  $queryBody = @{ intentId = 'query-my-reservations'; resources = @(@{ classroom = @{} }); slot = @{ start = "${future}T05:00:00Z"; end = "${future}T06:00:00Z" } } | ConvertTo-Json -Depth 5
  $q = Invoke-RestMethod -Method Post -Uri "$base/api/tasks" -ContentType 'application/json; charset=utf-8' -Body $queryBody -WebSession $session -TimeoutSec 10
  $qSnap = $null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $qSnap = (Invoke-RestMethod -Uri "$base/api/tasks/$($q.data.taskId)" -WebSession $session -TimeoutSec 5).data
    if ($qSnap.status -eq 'terminal') { break }
  }
  Report ($qSnap.result.terminal -eq 'DONE' -and $qSnap.result.conclusion -match '生效预约') "查我的预约 → $($qSnap.result.conclusion)"

  # 退掉（C7 退）：唯一命中即直接撤销
  $cancelBody = @{ intentId = 'cancel-my-reservation'; resources = @(@{ classroom = @{} }); slot = @{ start = "${future}T05:00:00Z"; end = "${future}T06:00:00Z" } } | ConvertTo-Json -Depth 5
  $c = Invoke-RestMethod -Method Post -Uri "$base/api/tasks" -ContentType 'application/json; charset=utf-8' -Body $cancelBody -WebSession $session -TimeoutSec 10
  $cSnap = $null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $cSnap = (Invoke-RestMethod -Uri "$base/api/tasks/$($c.data.taskId)" -WebSession $session -TimeoutSec 5).data
    if ($cSnap.status -eq 'terminal') { break }
  }
  Report ($cSnap.result.terminal -eq 'DONE') "撤销我的预约 → $($cSnap.result.terminal)（$($cSnap.result.conclusion)）"

  # 复查：应已无生效预约（净副作用为零）
  $again = Invoke-RestMethod -Method Post -Uri "$base/api/tasks" -ContentType 'application/json; charset=utf-8' -Body $queryBody -WebSession $session -TimeoutSec 10
  $againSnap = $null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $againSnap = (Invoke-RestMethod -Uri "$base/api/tasks/$($again.data.taskId)" -WebSession $session -TimeoutSec 5).data
    if ($againSnap.status -eq 'terminal') { break }
  }
  Report ($againSnap.result.conclusion -match '没有生效中的预约|没有匹配') "复查：$($againSnap.result.conclusion)"
}

# ⑦ 登出
Write-Host "⑦ 登出"
Invoke-RestMethod -Method Post -Uri "$base/api/auth/logout" -WebSession $session -TimeoutSec 10 | Out-Null
$afterStatus = 0
try {
  Invoke-RestMethod -Uri "$base/api/auth/me" -WebSession $session -TimeoutSec 5 | Out-Null
} catch {
  $afterStatus = [int]$_.Exception.Response.StatusCode
}
Report ($afterStatus -eq 401) "登出后 GET /api/auth/me -> HTTP $afterStatus（期望 401）"

Write-Host ('=' * 68)
if ($script:failures -eq 0) { Write-Host '引擎真实冒烟：全部通过'; exit 0 }
Write-Host "引擎真实冒烟：$script:failures 项未通过"; exit 1
