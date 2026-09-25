#!/usr/bin/env bash
# 演示账号口令的读取（bash 侧）——与 orchestrator/scripts/legacy-credentials.mjs 同口径。
#
# 为什么要它：本项目的凭证明文纪律是"口令只从环境变量取，任何地方不落值"。但演示脚本若
# 强制要求人先 export 三个口令，一是容易忘、二是会把口令写进命令历史。折中做法：
#   **优先环境变量；缺失时回落到 start-all.bat 的演示账号默认值**（那里是本项目
#   "本地演示环境该用哪个账号"的项目级声明）。本文件不含任何口令字面量。
#
# 用法（在脚本开头）：
#   ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
#   . "$ROOT/deploy/scripts/lib/legacy-credentials.sh"
#   load_legacy_credentials "$ROOT"

# 只认 `set "NAME=值"` 形态：start-all.bat 顶部注释里也出现 NAME=... 的说明文字，
# 裸匹配会先命中注释、取到说明文字而不是口令（2026-09-26 实测踩过这个坑）。
_load_one_credential() {
  _root="$1"
  _var="$2"
  eval "_cur=\${$_var:-}"
  if [ -n "$_cur" ]; then return 0; fi
  _bat="$_root/start-all.bat"
  if [ -f "$_bat" ]; then
    _val=$(sed -n "s/.*set \"$_var=\([^\"]*\)\".*/\1/p" "$_bat" | head -1)
    if [ -n "$_val" ]; then export "$_var=$_val"; fi
  fi
}

load_legacy_credentials() {
  _root="$1"
  _load_one_credential "$_root" ORCH_LEGACY_ADMIN_PASSWORD
  _load_one_credential "$_root" ORCH_LEGACY_TEACHER_PASSWORD
  _load_one_credential "$_root" ORCH_LEGACY_STUDENT_PASSWORD
  # 引擎地址与存量地址同样允许回落（默认值本来就是本机演示口径）
  : "${ORCH_ENGINE_BASE:=http://localhost:8090}"
  : "${ORCH_LEGACY_BASE:=http://localhost:8080}"
  export ORCH_ENGINE_BASE ORCH_LEGACY_BASE
}
