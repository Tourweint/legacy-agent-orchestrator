#!/usr/bin/env bash
# 演示副作用清理 —— 幕间运行；撤销演示产生的 ACTIVE 预约（走业务接口，不插库）。
# 维护窗口按幕 3 需求由 demo-prepare.sh 创建；如需撤销窗口，用 ADMIN 接口的删除端点或直接复位。
#
# 用法：ORCH_LEGACY_TEACHER_PASSWORD=233 ORCH_LEGACY_STUDENT_PASSWORD=abc bash deploy/scripts/demo-cleanup.sh

set -eu
LEGACY="${ORCH_LEGACY_BASE:-http://localhost:8080}"

login() {
  curl -s --max-time 5 "$LEGACY/auth/login" -X POST \
    -H "Content-Type: application/json" -H "X-Device-Id: demo-cleanup" \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).data.accessToken)})"
}

TEACHER_AUTH=$(login 233 "${ORCH_LEGACY_TEACHER_PASSWORD:?需要 ORCH_LEGACY_TEACHER_PASSWORD}")
ADMIN_AUTH=$(login admin "${ORCH_LEGACY_ADMIN_PASSWORD:?需要 ORCH_LEGACY_ADMIN_PASSWORD}")

# 教师撤销自己名下的 ACTIVE 预约
rows=$(curl -s --max-time 5 "$LEGACY/admin/reservations")
echo "$rows" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d)
  for (const r of (j.data||[]).filter(r=>r.status==='ACTIVE')) console.log(r.id+'|'+r.userId)
})" | while IFS='|' read -r id uid; do
  echo "撤销 ACTIVE 预约 #$id"
  curl -s --max-time 5 "$LEGACY/reservations/$id" -X DELETE \
    -H "Authorization: Bearer $TEACHER_AUTH" | head -c 80; echo
done

# 撤销学生名下的 ACTIVE 预约（若演示中用到学生身份）
if [ -n "${ORCH_LEGACY_STUDENT_PASSWORD:-}" ]; then
  STUDENT_AUTH=$(login abc "$ORCH_LEGACY_STUDENT_PASSWORD")
  echo "$rows" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d)
  for (const r of (j.data||[]).filter(r=>r.status==='ACTIVE'&&(r.username==='abc'))) console.log(r.id)
})" | while read -r id; do
    echo "撤销学生预约 #$id"
    curl -s --max-time 5 "$LEGACY/reservations/$id" -X DELETE \
      -H "Authorization: Bearer $STUDENT_AUTH" | head -c 80; echo
  done
fi

# 复核
after=$(curl -s --max-time 5 "$LEGACY/admin/reservations")
left=$(echo "$after" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log((j.data||[]).filter(r=>r.status==='ACTIVE').length)})")
echo "清理后 ACTIVE: $left（应为 0）"
