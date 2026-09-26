#!/usr/bin/env bash
# 演示副作用清理 —— 幕间/演示后运行；把演示造出来的东西撤回去（走业务接口，不插库）。
#
# 三审 §九 3.1 的"复位"要求：每幕录完立即清理，把该幕产生的副作用清回干净基线
# （ACTIVE=0、无遗留维修窗口）。本脚本按顺序做三件事：
#   ① 撤销所有 ACTIVE 预约（用**记录所有者的身份**撤——撤销接口只认本人）
#   ② 取消所有生效中的维修窗口（ADMIN）
#   ③ 复核：ACTIVE 预约与生效窗口都应为 0
#
# 用法：bash deploy/scripts/demo-cleanup.sh
# 凭证：优先环境变量；未设时回落 start-all.bat 的演示默认值（见 lib/legacy-credentials.sh）。
#
# 说明（2026-09-26 修复）：旧版取列表时**没带令牌**（401 → 空列表 → 什么都没清），
# 且依赖 PATH 里的 node 解析 JSON。现改为带 ADMIN 令牌 + sed/grep 解析，不依赖 node。

set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT/deploy/scripts/lib/legacy-credentials.sh"
load_legacy_credentials "$ROOT"
LEGACY="$ORCH_LEGACY_BASE"

login_token() {
  # 设备会话预算：与 demo-prepare / demo-checklist 共用同一设备 ID（同 ID 重登只顶替自己，
  # 不会新开槽挤掉浏览器或引擎的会话）。
  DEMO_DEVICE_ID="${ORCH_DEMO_DEVICE_ID:-demo-scripts}"
  curl -s --max-time 5 "$LEGACY/auth/login" -X POST -H "Content-Type: application/json" \
    -H "X-Device-Id: $DEMO_DEVICE_ID" -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}

TEACHER_AUTH=$(login_token 233 "$ORCH_LEGACY_TEACHER_PASSWORD")
ADMIN_AUTH=$(login_token admin "$ORCH_LEGACY_ADMIN_PASSWORD")
STUDENT_AUTH=$(login_token abc "$ORCH_LEGACY_STUDENT_PASSWORD")

rows=$(curl -s --max-time 8 "$LEGACY/admin/reservations" -H "Authorization: Bearer $ADMIN_AUTH")

# ① 撤销 ACTIVE 预约：按记录的归属账号选对应身份（撤销只认本人）
echo "$rows" | tr '}' '\n' | grep '"status":"ACTIVE"' | while read -r row; do
  id=$(echo "$row" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  owner=$(echo "$row" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
  [ -n "$id" ] || continue
  case "$owner" in
    233) token="$TEACHER_AUTH" ;;
    abc) token="$STUDENT_AUTH" ;;
    *)   token="$ADMIN_AUTH" ;;   # 非演示账号（历史数据）：用管理身份尝试；撤不动就保留
  esac
  echo "撤销 ACTIVE 预约 #$id（归属 $owner）"
  curl -s --max-time 5 "$LEGACY/reservations/$id" -X DELETE -H "Authorization: Bearer $token" | head -c 80; echo
done

# ② 取消生效中的维修窗口（幕 3 预置的窗口；ADMIN）
windows=$(curl -s --max-time 8 "$LEGACY/admin/maintenance" -H "Authorization: Bearer $ADMIN_AUTH")
echo "$windows" | tr '}' '\n' | grep '"status":"ACTIVE"' | while read -r row; do
  id=$(echo "$row" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  [ -n "$id" ] || continue
  echo "取消维修窗口 #$id"
  curl -s --max-time 5 "$LEGACY/admin/maintenance/$id" -X DELETE -H "Authorization: Bearer $ADMIN_AUTH" | head -c 80; echo
done

# ③ 复核
after=$(curl -s --max-time 8 "$LEGACY/admin/reservations" -H "Authorization: Bearer $ADMIN_AUTH")
left=$(echo "$after" | tr '}' '\n' | grep -c '"status":"ACTIVE"' || true)
windows_after=$(curl -s --max-time 8 "$LEGACY/admin/maintenance" -H "Authorization: Bearer $ADMIN_AUTH")
left_windows=$(echo "$windows_after" | tr '}' '\n' | grep -c '"status":"ACTIVE"' || true)
echo "清理后 ACTIVE 预约: $left（应为 0）；生效中维修窗口: $left_windows（应为 0）"
if [ "$left" != "0" ] || [ "$left_windows" != "0" ]; then
  echo "⚠️ 仍有残留——按第 11 章 §七 排查表处理（残留会让断言与镜头不可复现）"
  exit 1
fi
