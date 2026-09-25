#!/usr/bin/env bash
# 演示场景预置 —— 第 11 章 §5.2：演示用的"额外场景"必须走接口，不能插库。
# 每一幕演示前按需调用；构造的副作用在演示后由 demo-cleanup.sh 撤销。
#
# 用法：bash deploy/scripts/demo-prepare.sh <scene>
#   scene = maintenance   幕 3 前置：ADMIN 接口给数智楼123(id=5)创建一条生效中的维护窗口（明天全天）
#   scene = occupy        幕 4 前置：TEACHER 接口占用数智楼123(id=5)的下午时段（13:00–17:00）
#
# 凭证走环境变量（不写进任何文件）。

set -eu
ENGINE="${ORCH_ENGINE_BASE:-http://localhost:8090}"
LEGACY="${ORCH_LEGACY_BASE:-http://localhost:8080}"
SCENE="${1:?用法: demo-prepare.sh <maintenance|occupy>}"

# TEACHER 直接登录（场景预置是"人在旁边准备场景"，不走引擎编排——第 12 章 §4/第 01 章 §6.5）
TEACHER_AUTH=$(curl -s --max-time 5 "$LEGACY/auth/login" -X POST \
  -H "Content-Type: application/json" -H "X-Device-Id: demo-prepare" \
  -d "{\"username\":\"233\",\"password\":\"${ORCH_LEGACY_TEACHER_PASSWORD:?需要 ORCH_LEGACY_TEACHER_PASSWORD}\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).data.accessToken)})")

ADMIN_AUTH=$(curl -s --max-time 5 "$LEGACY/auth/login" -X POST \
  -H "Content-Type: application/json" -H "X-Device-Id: demo-prepare" \
  -d "{\"username\":\"admin\",\"password\":\"${ORCH_LEGACY_ADMIN_PASSWORD:?需要 ORCH_LEGACY_ADMIN_PASSWORD}\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).data.accessToken)})")

# 明天（北京墙钟）的 00:00–23:59 → UTC 绝对时刻
BJ=$(node -e "const b=new Date(Date.now()+8*3600000);console.log(b.getUTCFullYear(),b.getUTCMonth()+1,b.getUTCDate())")
read -r Y M D <<< "$BJ"

case "$SCENE" in
  maintenance)
    echo "[幕3预置] ADMIN 创建维修窗口：数智楼123（id=5）明天 07:00–22:30（覆盖全天可预约时段）"
    curl -s --max-time 10 "$LEGACY/admin/maintenance" -X POST \
      -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_AUTH" \
      -d "{\"resourceType\":\"CLASSROOM\",\"resourceId\":5,\"start_time\":\"${Y}-${M}-${D}T23:00:00Z\",\"end_time\":\"${Y}-${M}-$(node -e "console.log(String(Number('$D')+1).padStart(2,'0'))")T14:30:00Z\",\"reason\":\"机房检修（演示场景预置）\",\"clear_conflicting_reservations\":false}" \
      | head -c 200; echo
    echo "  → 验证：$LEGACY/admin/maintenance?classroomId=5 应出现 status=ACTIVE 窗口"
    ;;
  occupy)
    echo "[幕4预置] TEACHER 占用数智楼123（id=5）明天下午 13:00–17:00（北京）"
    curl -s --max-time 10 "$LEGACY/reservations/classrooms" -X POST \
      -H "Content-Type: application/json" -H "Authorization: Bearer $TEACHER_AUTH" \
      -d "{\"classroom_id\":5,\"start_time\":\"${Y}-${M}-${D}T05:00:00Z\",\"end_time\":\"${Y}-${M}-${D}T09:00:00Z\",\"reason\":\"课程占用（演示场景预置）\"}" \
      | head -c 200; echo
    echo "  → 引擎演示第 4 幕输入同一句话时，P-SLOT-FREE 将不成立并进入降级（123→222）"
    ;;
  *)
    echo "未知场景: $SCENE（可选 maintenance | occupy）"; exit 1 ;;
esac
