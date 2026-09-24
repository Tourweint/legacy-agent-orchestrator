#!/usr/bin/env bash
# 启动 Redis（被测存量系统的必需依赖）
#
# 说明：被测系统的令牌会话、邮箱验证码、设备会话都存 Redis。
#       **Redis 未启动时，登录后所有接口会返回 401**，这是最常见的"卡住"原因。
#
# 用法：
#   前台：bash deploy/scripts/start-redis.sh
#   后台：bash deploy/scripts/start-redis.sh > deploy/logs/redis.log 2>&1 &

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="${REDIS_DATA_DIR:-$PROJECT_ROOT/deploy/data/redis}"
PORT="${SPRING_DATA_REDIS_PORT:-6379}"

# ---------- 定位 redis-server ----------
REDIS_SERVER="${REDIS_SERVER:-}"
if [ -z "$REDIS_SERVER" ]; then
  for c in redis-server "$HOME/scoop/apps/redis/current/redis-server.exe" "/c/Program Files/Redis/redis-server.exe"; do
    if command -v "$c" > /dev/null 2>&1 || [ -x "$c" ]; then REDIS_SERVER="$c"; break; fi
  done
fi
if [ -z "$REDIS_SERVER" ]; then
  echo "[redis] ✗ 找不到 redis-server。" >&2
  echo "[redis]   安装（Windows，需已装 scoop）：scoop install redis" >&2
  echo "[redis]   或设置环境变量 REDIS_SERVER 指向可执行文件。" >&2
  exit 1
fi

# ---------- 端口占用检查 ----------
if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
  echo "[redis] 端口 $PORT 已被占用，疑似 Redis 已在运行。"
  echo "[redis] 验证：redis-cli -p $PORT ping   （期望输出 PONG）"
  exit 0
fi

mkdir -p "$DATA_DIR" "$PROJECT_ROOT/deploy/logs"

echo "[redis] 启动：$REDIS_SERVER  port=$PORT  dir=$DATA_DIR"
echo "[redis] 说明：演示环境使用 AOF 持久化，重启后登录会话仍在，无需重新登录。"

exec "$REDIS_SERVER" \
  --port "$PORT" \
  --dir "$DATA_DIR" \
  --appendonly yes \
  --save ""
