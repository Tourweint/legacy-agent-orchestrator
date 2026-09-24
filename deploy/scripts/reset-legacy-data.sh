#!/usr/bin/env bash
# 复位被测存量系统（mock-legacy）的数据与缓存到已知初始状态
#
# 用途：每次演示前执行，保证「旧系统里只有种子数据」这一事实可复现。
# 零侵入：只操作数据库与 Redis，不触碰 mock-legacy 任何文件。
# 幂等性：classroom.sql 自带 DROP TABLE IF EXISTS，可反复执行。
#
# 用法：bash deploy/scripts/reset-legacy-data.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_FILE="$PROJECT_ROOT/mock-legacy/backend/sql/classroom.sql"

# ---------- 载入配置 ----------
if [ -f "$PROJECT_ROOT/deploy/config/legacy.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$PROJECT_ROOT/deploy/config/legacy.env"; set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${SPRING_DATASOURCE_USERNAME:-root}"
DB_PASS="${SPRING_DATASOURCE_PASSWORD:-123456}"
DB_NAME="${DB_NAME:-classroom}"
REDIS_PORT="${SPRING_DATA_REDIS_PORT:-6379}"

MYSQL_BIN="${MYSQL_BIN:-}"
REDIS_CLI="${REDIS_CLI:-}"

# 自动探测可执行文件位置（这些工具通常不在 Git Bash 的 PATH 里）
if [ -z "$MYSQL_BIN" ]; then
  for c in mysql "/c/Program Files/MariaDB 12.1/bin/mysql.exe" "/c/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe"; do
    if command -v "$c" > /dev/null 2>&1 || [ -x "$c" ]; then MYSQL_BIN="$c"; break; fi
  done
fi
if [ -z "$REDIS_CLI" ]; then
  for c in redis-cli "$HOME/scoop/apps/redis/current/redis-cli.exe" "/c/Program Files/Redis/redis-cli.exe"; do
    if command -v "$c" > /dev/null 2>&1 || [ -x "$c" ]; then REDIS_CLI="$c"; break; fi
  done
fi
if [ -z "$MYSQL_BIN" ]; then echo "[reset] ✗ 找不到 mysql 客户端，请设置 MYSQL_BIN 环境变量" >&2; exit 1; fi

echo "[reset] mysql   = $MYSQL_BIN"
echo "[reset] redis   = ${REDIS_CLI:-（未找到，跳过缓存清理）}"

echo "[reset] 重建数据库 $DB_NAME ..."
export MYSQL_PWD="$DB_PASS"
"$MYSQL_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -e \
  "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "[reset] 导入种子数据 $SQL_FILE ..."
"$MYSQL_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" --default-character-set=utf8mb4 "$DB_NAME" < "$SQL_FILE"

echo "[reset] 清空 Redis（登录会话 / 邮箱验证码 / 设备会话）..."
"$REDIS_CLI" -p "$REDIS_PORT" flushall > /dev/null

echo "[reset] 校验初始状态 ..."
"$MYSQL_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -N -e "
SELECT CONCAT('  classroom=', (SELECT COUNT(*) FROM \`$DB_NAME\`.classroom),
              ' seat=',     (SELECT COUNT(*) FROM \`$DB_NAME\`.seat),
              ' reservation=', (SELECT COUNT(*) FROM \`$DB_NAME\`.reservation),
              ' maintenance_window=', (SELECT COUNT(*) FROM \`$DB_NAME\`.maintenance_window),
              ' user=',     (SELECT COUNT(*) FROM \`$DB_NAME\`.user));
"
unset MYSQL_PWD

echo "[reset] 完成。注意：若后端已在运行，无需重启（数据源为连接池，重连即可）。"
