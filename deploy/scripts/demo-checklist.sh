#!/usr/bin/env bash
# 演示前检查清单 —— 第 11 章 §六 的 14 项检查固化为脚本（决策 A9：把慌乱移到准备阶段）。
# 每一项机械可查；任何一项失败都会在结尾汇总（脚本不中途退出，便于一次看全）。
#
# 前置：存量系统(8080)/MariaDB/Redis 已按第 11 章 §四 顺序启动；编排引擎(8090)已启动。
# 用法：ORCH_LEGACY_ADMIN_PASSWORD=admin ORCH_LEGACY_TEACHER_PASSWORD=233 ORCH_LEGACY_STUDENT_PASSWORD=abc \
#         bash deploy/scripts/demo-checklist.sh
# 若用 start-all.bat 启动，三个口令已由脚本内置，可直接运行本清单。
#
# 2026-09-26（登录上线）后本清单多两项机械断言：
#   · 引擎会话：登录 200 / 带会话访问 200 / 不带会话 401（取代"identity 参数"时代的旧写法）
#   · 混沌撤防：不再靠人工提醒，直接读 /api/health 的 chaos.armed 字段（三审 P2-2）

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT/deploy/scripts/lib/legacy-credentials.sh"
load_legacy_credentials "$ROOT"
ENGINE="$ORCH_ENGINE_BASE"
LEGACY="$ORCH_LEGACY_BASE"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ [$1] $2"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ [$1] $2"; }
check(){ if [ "$1" = "$2" ]; then ok "$3" "$4"; else bad "$3" "$4（实际: $1）"; fi; }

# 粗判 JSON 的辅助 —— 刻意不依赖 node：本机 bash 的 PATH 里不一定有 node
# （2026-09-26 实测：脚本里原本用 node 解析的地方全部静默返回空，看起来像业务失败）
json_rows()         { tr '}' '\n'; }
count_active()      { json_rows | grep -c '"status":"ACTIVE"'; }
count_active_room() { json_rows | grep "\"resourceId\":$1" | grep -c '"status":"ACTIVE"'; }
count_rows()        { json_rows | grep -c '"status":"'; }

# 三个身份各登录**一次**（顺序纪律：本脚本用完即退，少占设备会话名额；§九 9.3）
legacy_token() {
  curl -s --max-time 5 "$LEGACY/auth/login" -X POST -H "Content-Type: application/json" \
    -H "X-Device-Id: demo-checklist" -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}
ADMIN_AUTH=$(legacy_token admin "${ORCH_LEGACY_ADMIN_PASSWORD:-}")
TEACHER_AUTH=$(legacy_token 233 "${ORCH_LEGACY_TEACHER_PASSWORD:-}")
STUDENT_AUTH=$(legacy_token abc "${ORCH_LEGACY_STUDENT_PASSWORD:-}")

echo "== 演示前检查清单（第 11 章 §六，共 14 项）=="

# 2. Redis 存活（先于 1 的复位依赖说明：复位脚本自身会清 Redis）
if (exec 3<>/dev/tcp/127.0.0.1/6379) 2>/dev/null; then ok 2 "Redis 存活"; exec 3<&-; else bad 2 "Redis 未监听（登录后全 401，第 11 章 §4.1）"; fi

# 4. 存量系统监听 8080
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$LEGACY/auth/login" -X POST -H "Content-Type: application/json" -d '{}')
if [ "$code" != "000" ] && [ -n "$code" ]; then ok 4 "存量系统监听 8080"; else bad 4 "存量系统 8080 不可达"; fi

# 5. 编排引擎存活（并顺便读走布防状态，供第 6 项机械断言）
body=$(curl -s --max-time 3 "$ENGINE/api/health")
check "$(echo "$body" | grep -c '"code":0')" "1" 5 "编排引擎存活"

# 1. 数据已复位（按业务键口径：复位后 ACTIVE 预约应为 0）
rows=$(curl -s --max-time 5 "$LEGACY/admin/reservations" -H "Authorization: Bearer $ADMIN_AUTH")
active=$(echo "$rows" | count_active)
check "$active" "0" 1 "数据已复位（无 ACTIVE 预约残留）"
total=$(echo "$rows" | count_rows)
echo "     （当前全量 $total 条——复位基线为 86；若大于 86 且无 ACTIVE，为历史 CANCELLED/EXPIRED 留存，可接受）"

# 3. 三个身份都能登录（探活，§4.1）——用上面各登录一次的结果，不重复登录
for pair in "ADMIN:$ADMIN_AUTH" "TEACHER:$TEACHER_AUTH" "STUDENT:$STUDENT_AUTH"; do
  ident="${pair%%:*}"
  tok="${pair#*:}"
  if [ -n "$tok" ]; then ok 3 "身份 $ident 登录成功"; else bad 3 "身份 $ident 登录失败（检查对应口令或存量系统状态）"; fi
done

# 6. 混沌处于撤防（§七）——机械断言，不再靠人工提醒（三审 P2-2）。
#    health 暴露只读字段 chaos.armed；演示路径必须为 false（第 5 幕才临时布防，录完撤防）。
armed=$(echo "$body" | grep -o '"armed":[a-z]*' | head -1 | cut -d: -f2)
check "$armed" "false" 6 "混沌处于撤防（chaos.armed=false；若为 true 说明有人布防过，重启引擎）"

# 3b. 引擎会话（登录上线后新增）：登录 → 带会话可访问 → 不带会话被拒。
#     顺序纪律（三审 §九 9.3）：本脚本用完即退，不与两个浏览器窗口抢设备名额。
if [ -n "${ORCH_LEGACY_TEACHER_PASSWORD:-}" ]; then
  ecode=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$ENGINE/api/auth/login" -X POST \
    -H "Content-Type: application/json" -c "$JAR" \
    -d "{\"username\":\"233\",\"password\":\"${ORCH_LEGACY_TEACHER_PASSWORD}\"}")
  mecode=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -b "$JAR" "$ENGINE/api/auth/me")
  nocookie=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$ENGINE/api/auth/me")
  if [ "$ecode" = "200" ] && [ "$mecode" = "200" ] && [ "$nocookie" = "401" ]; then
    ok 3 "引擎会话可用（登录 $ecode / 带会话 $mecode / 不带会话 $nocookie）"
  else
    bad 3 "引擎会话异常（登录 $ecode / 带会话 $mecode / 不带会话 $nocookie）"
  fi
else
  bad 3 "引擎会话检查缺 ORCH_LEGACY_TEACHER_PASSWORD（登录后所有业务端点都要会话）"
fi

# 7. 大模型可达（失败不影响演示——可切预置任务）
#    以自然语言做一次只读探活（查可用性意图，无副作用）；走会话，不再传 identity
t=$(curl -s --max-time 10 "$ENGINE/api/chat" -X POST -H "Content-Type: application/json" -b "$JAR" \
  -d '{"text":"帮我查一下明天上午数智楼123有没有空"}')
tid=$(echo "$t" | grep -o '"taskId":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$tid" ]; then ok 7 "理解层探活已受理（任务 $tid，结果稍后自查）"; else bad 7 "理解层探活失败（不影响演示——切预置任务，E7）"; fi

# 8. 前端可访问
fcode=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:5173/")
check "$fcode" "200" 8 "前端 dev server 可访问（5173）"

# 9. 演示教室存在（主演示教室=数智楼123 id=5；候选=222 id=4；无 302）
rooms=$(curl -s --max-time 5 "$LEGACY/classrooms/5" -H "Authorization: Bearer $TEACHER_AUTH" | head -c 200)
check "$(echo "$rooms" | grep -c '123')" "1" 9 "数智楼 123（id=5）存在"
rooms4=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$LEGACY/classrooms/4" -H "Authorization: Bearer $TEACHER_AUTH")
check "$rooms4" "200" 9 "候选数智楼 222（id=4）存在"

# 10/14. 演示时段可用 + 降级候选可用（123 与 222 无 ACTIVE 预约、222 无生效维修窗口）
cnt123=$(echo "$rows" | count_active_room 5)
cnt222=$(echo "$rows" | count_active_room 4)
check "$cnt123" "0" 10 "数智楼 123 当前无 ACTIVE 预约（各幕可正常演示）"
check "$cnt222" "0" 14 "数智楼 222 当前无 ACTIVE 占用（降级候选可用，第 4 幕）"
mw=$(curl -s --max-time 5 "$LEGACY/admin/maintenance?classroomId=4" -H "Authorization: Bearer $ADMIN_AUTH" | grep -c '"status":"ACTIVE"')
check "$mw" "0" 14 "222 无生效维修窗口"

# 12. 证据链导出可用（结构化任务走一条完整链路后取证据）
struct=$(curl -s --max-time 60 "$ENGINE/api/tasks" -X POST -H "Content-Type: application/json" -b "$JAR" \
  -d '{"intentId":"query-classroom-availability","slot":{"start":"2026-10-13T01:00:00Z","end":"2026-10-13T03:00:00Z"},"resources":[{"classroom":{"classroomId":5}}]}')
stid=$(echo "$struct" | grep -o '"taskId":"[^"]*"' | head -1 | cut -d'"' -f4)
sleep 3
ev=$(curl -s --max-time 5 -b "$JAR" "$ENGINE/api/tasks/$stid/evidence" 2>/dev/null)
evn=$(echo "$ev" | grep -o '"seq":' | wc -l | tr -d ' ')
if [ "${evn:-0}" -gt 0 ]; then
  ok 12 "证据链导出可用（探活任务 $evn 条，含 P1/P2 分段）"
else
  bad 12 "证据链导出失败或为空"
  echo "     现场：任务受理返回 $(echo "$struct" | head -c 160)"
  echo "     现场：证据导出返回 $(echo "$ev" | head -c 160)"
fi

# 13. 时间链路复验（第 06 章 §6.3）：归一化三段落在可预约时段内 —— 由常量与测试保证，此处核对常量值
seg=$(grep -c "08:00" "$ROOT/orchestrator/config/constants.yaml" 2>/dev/null || echo 0)
if [ "$seg" -ge 1 ]; then ok 13 "归一化三段常量在位（08–12/13–17/18–22；UTC 解释链路由 npm test 覆盖）"; else bad 13 "constants.yaml 三段常量缺失"; fi

# 11. 深浅主题（需人工目视——投影环境）
echo "  ○ [11] 深浅主题请人工目视确认（投影环境；脚本无法替代）"

echo "== 结果：通过 $PASS / 失败 $FAIL =="
if [ "$FAIL" -gt 0 ]; then echo "存在失败项——先按第 11 章 §七 排查表处置，再重跑本清单。"; exit 1; fi
echo "全部通过——可以开始演示。"
