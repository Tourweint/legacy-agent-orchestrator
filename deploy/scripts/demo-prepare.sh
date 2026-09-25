#!/usr/bin/env bash
# 演示场景预置 —— 第 11 章 §5.2：演示用的"额外场景"必须走接口，不能插库。
# 每一幕演示前按需调用（`demo-prepare.sh <scene>`）；造成的副作用由 demo-cleanup.sh 撤销。
#
# 场景（三审 §九 3.2 的"预置 → 机械断言 → 复位"总表）：
#   maintenance    幕 3：ADMIN 给数智楼123(id=5) 建一条生效中的维修窗口（明天全天）
#   occupy         幕 4：TEACHER 占用数智楼123(id=5) 明天下午（13:00–17:00 北京）→ 触发降级换 222
#   occupy-222     加镜 C3：占用数智楼222(id=4) 明天下午 → 让"借两间"的第二间失败，演示自动撤第一间
#   mine           幕 6：TEACHER 名下造 **2 条** 明天的预约（123 14:00–15:00、222 15:00–16:00）
#                  ——一条供"退"，一条供"改期"；明天上午 10:00–11:00 保持空闲作为改期目标
#
# 凭证：优先环境变量；未设时回落到 start-all.bat 的演示默认值（见 lib/legacy-credentials.sh）。
# 纪律：预置脚本用完即退，不与两个浏览器窗口抢设备会话名额（三审 §九 9.3）。

set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT/deploy/scripts/lib/legacy-credentials.sh"
load_legacy_credentials "$ROOT"
ENGINE="$ORCH_ENGINE_BASE"
LEGACY="$ORCH_LEGACY_BASE"
SCENE="${1:?用法: demo-prepare.sh <maintenance|occupy|occupy-222|mine>}"

login_token() { # $1=用户名 $2=口令 → access token
  curl -s --max-time 5 "$LEGACY/auth/login" -X POST -H "Content-Type: application/json" \
    -H "X-Device-Id: demo-prepare" -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}

TEACHER_AUTH=$(login_token 233 "$ORCH_LEGACY_TEACHER_PASSWORD")
ADMIN_AUTH=$(login_token admin "$ORCH_LEGACY_ADMIN_PASSWORD")

# 明天 / 后天的日期（北京墙钟；用 GNU date 计算，不依赖 PATH 里有没有 node）
TOMORROW=$(date -u -d '+1 day 8 hours' +%F)
DAY_AFTER=$(date -u -d '+2 day 8 hours' +%F)

book() { # $1=教室 id $2=起始 UTC 时刻 $3=结束 UTC 时刻 $4=理由
  curl -s --max-time 10 "$LEGACY/reservations/classrooms" -X POST \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TEACHER_AUTH" \
    -d "{\"classroom_id\":$1,\"start_time\":\"$2\",\"end_time\":\"$3\",\"reason\":\"$4\"}" | head -c 160; echo
}

case "$SCENE" in
  maintenance)
    echo "[幕3预置] ADMIN 创建维修窗口：数智楼123（id=5）$TOMORROW 全天（覆盖可预约时段）"
    curl -s --max-time 10 "$LEGACY/admin/maintenance" -X POST \
      -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_AUTH" \
      -d "{\"resourceType\":\"CLASSROOM\",\"resourceId\":5,\"start_time\":\"${TOMORROW}T23:00:00Z\",\"end_time\":\"${DAY_AFTER}T14:30:00Z\",\"reason\":\"机房检修（演示场景预置）\",\"clear_conflicting_reservations\":false}" \
      | head -c 200; echo
    echo "  → 断言：$LEGACY/admin/maintenance?classroomId=5 应恰有 1 条 status=ACTIVE"
    ;;
  occupy)
    echo "[幕4预置] TEACHER 占用数智楼123（id=5）$TOMORROW 下午 13:00–17:00（北京）"
    book 5 "${TOMORROW}T05:00:00Z" "${TOMORROW}T09:00:00Z" "课程占用（演示场景预置）"
    echo "  → 引擎第 4 幕说同一句话时，P-SLOT-FREE 不成立并进入降级（123 → 222）"
    ;;
  occupy-222)
    echo "[加镜C3预置] TEACHER 占用数智楼222（id=4）$TOMORROW 下午 13:00–17:00（北京）"
    book 4 "${TOMORROW}T05:00:00Z" "${TOMORROW}T09:00:00Z" "课程占用（C3 加镜预置）"
    echo "  → '借两间'时第二间失败 → 观察第一间是否被自动撤销（任务后断言 ACTIVE 增量=0）"
    ;;
  mine)
    echo "[幕6预置] TEACHER 明天 2 条本人预约（一条供撤销、一条供改期）"
    echo "  ① 数智楼123（id=5）$TOMORROW 14:00–15:00（北京）"
    book 5 "${TOMORROW}T06:00:00Z" "${TOMORROW}T07:00:00Z" "本人课程（幕6预置·供撤销）"
    echo "  ② 数智楼222（id=4）$TOMORROW 15:00–16:00（北京）"
    book 4 "${TOMORROW}T07:00:00Z" "${TOMORROW}T08:00:00Z" "本人课程（幕6预置·供改期）"
    echo "  → 断言：'我订了哪些教室'应报 2 条；明天上午 10:00–11:00（北京）保持空闲，作为改期目标"
    ;;
  *)
    echo "未知场景: $SCENE（可选 maintenance | occupy | occupy-222 | mine）"; exit 1 ;;
esac
