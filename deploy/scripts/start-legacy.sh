#!/usr/bin/env bash
# 启动被测存量系统（mock-legacy）
#
# 零侵入说明：本脚本不向 mock-legacy 目录写入任何文件。
# 全部运行配置通过环境变量注入（见 deploy/config/legacy.env.example）。
#
# 依赖：JDK 17、MariaDB/MySQL（库 classroom 已初始化）、Redis（6379）
# 用法：bash deploy/scripts/start-legacy.sh
#   前台运行并打印日志；如需后台运行请自行重定向：
#   bash deploy/scripts/start-legacy.sh > deploy/logs/legacy.log 2>&1 &

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/mock-legacy/backend"

# ---------- 载入环境变量 ----------
if [ -f "$PROJECT_ROOT/deploy/config/legacy.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$PROJECT_ROOT/deploy/config/legacy.env"; set +a
  echo "[start-legacy] 已载入 deploy/config/legacy.env"
else
  echo "[start-legacy] 未找到 deploy/config/legacy.env，使用内置默认值"
fi

# ---------- JDK 17 ----------
JDK17_HOME="${JDK17_HOME:-C:/Program Files/Microsoft/jdk-17.0.8.7-hotspot}"
export JAVA_HOME="$JDK17_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

# ---------- 既定时序依赖，也给出默认值，避免依赖外部文件即可起 ----------
export SPRING_DATASOURCE_URL="${SPRING_DATASOURCE_URL:-jdbc:mysql://localhost:3306/classroom?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC&useSSL=false&allowPublicKeyRetrieval=true}"
export SPRING_DATASOURCE_USERNAME="${SPRING_DATASOURCE_USERNAME:-root}"
export SPRING_DATASOURCE_PASSWORD="${SPRING_DATASOURCE_PASSWORD:-123456}"
export SPRING_DATA_REDIS_HOST="${SPRING_DATA_REDIS_HOST:-localhost}"
export SPRING_DATA_REDIS_PORT="${SPRING_DATA_REDIS_PORT:-6379}"
export SPRING_MAIL_HOST="${SPRING_MAIL_HOST:-smtp.example.com}"
export SPRING_MAIL_PORT="${SPRING_MAIL_PORT:-465}"
export SPRING_MAIL_USERNAME="${SPRING_MAIL_USERNAME:-noreply@example.com}"
export SPRING_MAIL_PASSWORD="${SPRING_MAIL_PASSWORD:-placeholder}"
export SPRING_MAIL_PROPERTIES_MAIL_SMTP_AUTH="${SPRING_MAIL_PROPERTIES_MAIL_SMTP_AUTH:-true}"
export SPRING_MAIL_PROPERTIES_MAIL_SMTP_SSL_ENABLE="${SPRING_MAIL_PROPERTIES_MAIL_SMTP_SSL_ENABLE:-true}"
export APP_MAIL_FROM="${APP_MAIL_FROM:-noreply@example.com}"
export JWT_SECRET="${JWT_SECRET:-legacy-agent-orchestrator-local-secret}"
# 以下三项在项目的 application.yaml 中没有默认值（原设计放在被 .gitignore 的 application-local.yaml），
# 缺任意一项都会导致启动期 PlaceholderResolutionException，必须注入。
export JWT_ACCESS_EXPIRATION="${JWT_ACCESS_EXPIRATION:-1800000}"
export JWT_REFRESH_EXPIRATION="${JWT_REFRESH_EXPIRATION:-604800000}"
export APP_AUTH_EMAIL_CODE_EXPIRATION_SECONDS="${APP_AUTH_EMAIL_CODE_EXPIRATION_SECONDS:-300}"
export APP_AUTH_EMAIL_CODE_RESEND_SECONDS="${APP_AUTH_EMAIL_CODE_RESEND_SECONDS:-60}"
export APP_AUTH_MAX_DEVICE_SESSIONS="${APP_AUTH_MAX_DEVICE_SESSIONS:-3}"

# ---------- 清除会劫持 server.port 的环境变量 ----------
# 某些托管/沙箱环境会注入 SERVER__PORT（双下划线），Spring Boot 的宽松绑定会把它解析成
# server.port，导致 Tomcat 绑到意外的端口（症状：启动报 "Port xxxxx was already in use"）。
# 这里强制清掉，保证端口恒为 application.yaml 中声明的 8080。
unset SERVER__PORT
unset SERVER_PORT

# ---------- 前置检查 ----------
if ! (exec 3<>/dev/tcp/127.0.0.1/6379) 2>/dev/null; then
  echo "[start-legacy] ⚠️  Redis (6379) 未监听 —— 登录后所有接口会返回 401，请先启动 Redis"
else
  echo "[start-legacy] Redis (6379) 正常"
fi

echo "[start-legacy] 使用 JDK: $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"
echo "[start-legacy] 启动后端 → http://localhost:8080  (Swagger: /swagger-ui.html)"
echo "[start-legacy] 停止：Ctrl+C"

cd "$BACKEND_DIR"
exec mvn -B spring-boot:run
