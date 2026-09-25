@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title legacy-agent-orchestrator 一键启动

rem ============================================================================
rem  一键启动（Windows）—— 存量系统 8080 / 编排引擎 8090 / 对话前端 5173
rem
rem  用法（双击运行等价于 all）：
rem    start-all.bat [all|legacy|engine|web|deps|dry]
rem      all      启动三个进程（默认）
rem      legacy   只启动存量系统（8080）
rem      engine   只启动编排引擎（8090）
rem      web      只启动前端（5173）
rem      deps     只做前置检查，不启动任何进程
rem      dry      只打印将要执行的命令，不启动、不等待
rem
rem  可选的环境变量文件（存在即载入，不存在用内置默认值）：
rem    deploy\config\legacy.env        存量系统库/Redis/JDK 配置（模板见 legacy.env.example）
rem    deploy\config\orchestrator.env  引擎凭证（ORCH_LEGACY_ADMIN_PASSWORD=... 等）
rem
rem  零侵入：本脚本不向 mock-legacy\ 写入任何文件，全部配置走环境变量。
rem  演示纪律：混沌默认撤防；本脚本不设置 ORCH_CHAOS_INJECT。
rem ============================================================================

pushd "%~dp0"
set "ROOT=%CD%"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=all"
set "DRY=0"
if /i "%MODE%"=="dry" set "DRY=1"
if /i "%MODE%"=="dry" set "MODE=all"
set "FAILED=0"

echo ============================================================================
echo  legacy-agent-orchestrator 一键启动     仓库：%ROOT%
echo  模式：%MODE% ^(all/legacy/engine/web/deps/dry^)
echo ============================================================================
echo.

rem ---------------------------------------------------------------- 载入配置 --
call :loadEnv "deploy\config\legacy.env"
call :loadEnv "deploy\config\orchestrator.env"

rem ---- 存量系统默认值（与 deploy/scripts/start-legacy.sh 保持一致：文件优先）----
if not defined JDK17_HOME set "JDK17_HOME=C:\Program Files\Microsoft\jdk-17.0.8.7-hotspot"
if not defined SPRING_DATASOURCE_URL set "SPRING_DATASOURCE_URL=jdbc:mysql://localhost:3306/classroom?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC&useSSL=false&allowPublicKeyRetrieval=true"
if not defined SPRING_DATASOURCE_USERNAME set "SPRING_DATASOURCE_USERNAME=root"
if not defined SPRING_DATASOURCE_PASSWORD set "SPRING_DATASOURCE_PASSWORD=123456"
if not defined SPRING_DATA_REDIS_HOST set "SPRING_DATA_REDIS_HOST=localhost"
if not defined SPRING_DATA_REDIS_PORT set "SPRING_DATA_REDIS_PORT=6379"
if not defined SPRING_MAIL_HOST set "SPRING_MAIL_HOST=smtp.example.com"
if not defined SPRING_MAIL_PORT set "SPRING_MAIL_PORT=465"
if not defined SPRING_MAIL_USERNAME set "SPRING_MAIL_USERNAME=noreply@example.com"
if not defined SPRING_MAIL_PASSWORD set "SPRING_MAIL_PASSWORD=placeholder"
if not defined SPRING_MAIL_PROPERTIES_MAIL_SMTP_AUTH set "SPRING_MAIL_PROPERTIES_MAIL_SMTP_AUTH=true"
if not defined SPRING_MAIL_PROPERTIES_MAIL_SMTP_SSL_ENABLE set "SPRING_MAIL_PROPERTIES_MAIL_SMTP_SSL_ENABLE=true"
if not defined APP_MAIL_FROM set "APP_MAIL_FROM=noreply@example.com"
if not defined JWT_SECRET set "JWT_SECRET=legacy-agent-orchestrator-local-secret"
if not defined JWT_ACCESS_EXPIRATION set "JWT_ACCESS_EXPIRATION=1800000"
if not defined JWT_REFRESH_EXPIRATION set "JWT_REFRESH_EXPIRATION=604800000"
if not defined APP_AUTH_EMAIL_CODE_EXPIRATION_SECONDS set "APP_AUTH_EMAIL_CODE_EXPIRATION_SECONDS=300"
if not defined APP_AUTH_EMAIL_CODE_RESEND_SECONDS set "APP_AUTH_EMAIL_CODE_RESEND_SECONDS=60"
if not defined APP_AUTH_MAX_DEVICE_SESSIONS set "APP_AUTH_MAX_DEVICE_SESSIONS=3"

rem ---- 引擎凭证默认值（= 被测系统自带的演示账号，见根 README；本地可用
rem      deploy\config\orchestrator.env 覆盖，不要往仓库里写真实密码）----
if not defined ORCH_LEGACY_ADMIN_PASSWORD set "ORCH_LEGACY_ADMIN_PASSWORD=admin"
if not defined ORCH_LEGACY_TEACHER_PASSWORD set "ORCH_LEGACY_TEACHER_PASSWORD=233"
if not defined ORCH_LEGACY_STUDENT_PASSWORD set "ORCH_LEGACY_STUDENT_PASSWORD=abc"

rem ---- 清掉会劫持 server.port 的环境变量（见 start-legacy.sh 的说明）----
set "SERVER__PORT="
set "SERVER_PORT="

rem ------------------------------------------------------------------ 前置检查 --
echo ---- 前置检查 -----------------------------------------------------------
call :checkCmd node "Node.js" || set "FAILED=1"
call :checkCmd mvn  "Maven（存量系统需要）"
call :checkDir "%JDK17_HOME%\bin\java.exe" "JDK 17（%JDK17_HOME%）"
if not exist "%ROOT%\orchestrator\node_modules" echo   [提示] orchestrator\node_modules 不存在，引擎首次启动前请执行：cd orchestrator ^&^& npm install
if not exist "%ROOT%\frontend\node_modules" set "NEED_WEB_INSTALL=1"

call :portListening 6379
if errorlevel 1 (echo   [✗] Redis 6379 未监听 —— 登录后所有接口会返回 401，请先启动 Redis) else echo   [√] Redis 6379
call :portListening 3306
if errorlevel 1 (echo   [✗] MariaDB/MySQL 3306 未监听 —— 存量系统起不来) else echo   [√] MariaDB 3306

call :portListening 8080
if errorlevel 1 (set "P8080=0" & echo   [√] 端口 8080 空闲) else (set "P8080=1" & echo   [警告] 端口 8080 已被占用 —— 存量系统疑似已在运行，本次跳过)
call :portListening 8090
if errorlevel 1 (set "P8090=0" & echo   [√] 端口 8090 空闲) else (set "P8090=1" & echo   [警告] 端口 8090 已被占用 —— 引擎疑似已在运行，本次跳过^(注意：旧进程可能仍是缺陷版本，见 docs/变更记录/2026-09-25-引擎入口缺陷修复与一键启动脚本.md^))
call :portListening 5173
if errorlevel 1 (set "P5173=0" & echo   [√] 端口 5173 空闲) else (set "P5173=1" & echo   [警告] 端口 5173 已被占用 —— 前端疑似已在运行，本次跳过)
echo.

if /i "%MODE%"=="deps" goto :summary
if "%FAILED%"=="1" (
  echo   [中止] 缺少必需的前置（Node.js / JDK 17）。修好后重跑本脚本。
  goto :end
)

rem ------------------------------------------------------------------ 启动进程 --
set "JAVA_HOME=%JDK17_HOME%"
set "PATH=%JDK17_HOME%\bin;%PATH%"

if /i "%MODE%"=="legacy" goto :startLegacy
if /i "%MODE%"=="engine" goto :startEngine
if /i "%MODE%"=="web" goto :startWeb
if /i "%MODE%"=="all" goto :startLegacy
goto :summary

:startLegacy
if "%P8080%"=="1" goto :startEngine
call :launch "存量系统 8080" "%ROOT%\mock-legacy\backend" "mvn -B spring-boot:run"
if /i "%MODE%"=="legacy" goto :waitLoop
goto :startEngine

:startEngine
if /i "%MODE%"=="legacy" goto :waitLoop
if "%P8090%"=="1" goto :startWeb
call :launch "编排引擎 8090" "%ROOT%\orchestrator" "node src\access\main.js"
if /i "%MODE%"=="engine" goto :waitLoop
goto :startWeb

:startWeb
if /i "%MODE%"=="legacy" goto :waitLoop
if /i "%MODE%"=="engine" goto :waitLoop
if "%P5173%"=="1" goto :waitLoop
if defined NEED_WEB_INSTALL (
  call :launch "对话前端 5173" "%ROOT%\frontend" "npm install && npm run dev"
) else (
  call :launch "对话前端 5173" "%ROOT%\frontend" "npm run dev"
)

rem ------------------------------------------------------------------ 等待就绪 --
:waitLoop
if "%DRY%"=="1" goto :summary
echo ---- 等待服务就绪（最多 90 秒）-------------------------------------------
if /i "%MODE%"=="all" if "%P8080%"=="0" (
  call :waitPort 8080 90
  if errorlevel 1 (echo   [✗] 存量系统 8080 未就绪 —— 看那个窗口的日志) else echo   [√] 存量系统 8080
)
if /i "%MODE%"=="legacy" if "%P8080%"=="0" (
  call :waitPort 8080 90
  if errorlevel 1 (echo   [✗] 存量系统 8080 未就绪 —— 看那个窗口的日志) else echo   [√] 存量系统 8080
)
if /i "%MODE%"=="all" if "%P8090%"=="0" (
  call :waitPort 8090 30
  if errorlevel 1 (echo   [✗] 编排引擎 8090 未就绪) else echo   [√] 编排引擎 8090
)
if /i "%MODE%"=="engine" if "%P8090%"=="0" (
  call :waitPort 8090 30
  if errorlevel 1 (echo   [✗] 编排引擎 8090 未就绪) else echo   [√] 编排引擎 8090
)
if /i "%MODE%"=="all" if "%P5173%"=="0" (
  call :waitPort 5173 30
  if errorlevel 1 (echo   [✗] 前端 5173 未就绪) else echo   [√] 前端 5173
)
if /i "%MODE%"=="web" if "%P5173%"=="0" (
  call :waitPort 5173 30
  if errorlevel 1 (echo   [✗] 前端 5173 未就绪) else echo   [√] 前端 5173
)
if /i "%MODE%"=="engine" call :probeHealth "http://localhost:8090/api/health"
if /i "%MODE%"=="all" call :probeHealth "http://localhost:8090/api/health"
echo.

rem ---------------------------------------------------------------------- 汇总 --
:summary
echo ============================================================================
echo  入口与下一步
echo ----------------------------------------------------------------------------
echo   前端（对话界面）  http://localhost:5173
echo   编排引擎健康检查  http://localhost:8090/api/health
echo   存量系统          http://localhost:8080        （Swagger: /swagger-ui.html）
echo.
echo   验证引擎回归：    cd orchestrator ^&^& npm test ^&^& npm run check
echo   演示前 14 项检查：bash deploy/scripts/demo-checklist.sh   ^(需 Git Bash^)
echo   停止：直接关闭对应的三个黑窗口 ^(Ctrl+C^)
echo   演示纪律：混沌默认撤防；第 5 幕布防用 node deploy/scripts/inject-once.mjs
echo ============================================================================
:end
if "%DRY%"=="1" goto :done
echo.
pause
:done
popd
endlocal
exit /b 0

rem ============================== 子过程 ======================================

:loadEnv
rem %~1 = 相对路径的环境变量文件
if not exist "%~1" exit /b 0
echo [env] 载入 %~1
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%~1") do (
  if not "%%~a"=="" set "%%a=%%b"
)
exit /b 0

:checkCmd
rem %~1 = 命令名  %~2 = 说明
where %~1 >nul 2>nul
if errorlevel 1 (
  if "%~1"=="node" echo   [✗] 找不到 %~1 —— %~2
  if not "%~1"=="node" echo   [警告] 找不到 %~1 —— %~2
  exit /b 1
)
echo   [√] %~1 —— %~2
exit /b 0

:checkDir
rem %~1 = 待检查的路径  %~2 = 说明
if exist "%~1" (echo   [√] %~2) else (echo   [警告] 不存在：%~2)
exit /b 0

:portListening
rem %~1 = 端口；errorlevel 0 = 已在监听
netstat -an | findstr /C:":%~1 " | findstr /C:"LISTENING" >nul
if errorlevel 1 (exit /b 1) else (exit /b 0)

:waitPort
rem %~1 = 端口  %~2 = 超时秒数；errorlevel 0 = 就绪
set /a "WAITED=0"
:waitPortLoop
call :portListening %~1
if not errorlevel 1 exit /b 0
if !WAITED! GEQ %~2 exit /b 1
rem 用 ping 代替 timeout：timeout 在 stdin 被重定向（如 < nul、计划任务、CI）时
rem 会立即报 "Input redirection is not supported" 并退出，导致等待循环空转。
ping -n 4 127.0.0.1 >nul 2>nul
set /a "WAITED+=3"
goto :waitPortLoop

:probeHealth
rem %~1 = 健康检查 URL
if "%DRY%"=="1" exit /b 0
set "HEALTH=DOWN"
for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri '%~1').StatusCode}catch{'DOWN'}"`) do set "HEALTH=%%H"
if "!HEALTH!"=="200" (echo   [√] 引擎健康检查 %~1 → 200) else (echo   [✗] 引擎健康检查 %~1 → !HEALTH! ^(引擎窗口可能有报错^))
exit /b 0

:launch
rem %~1 = 窗口标题  %~2 = 工作目录  %~3 = 命令
if "%DRY%"=="1" (
  echo [dry] start "%~1" /D "%~2" cmd /k "%~3"
  exit /b 0
)
echo [启动] %~1  ^(新窗口^)  %~2
start "%~1" /D "%~2" cmd /k "%~3"
exit /b 0
