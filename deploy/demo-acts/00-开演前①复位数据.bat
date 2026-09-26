@echo off
chcp 65001 >nul
title 幕前 00 - 复位数据
cd /d "%~dp0..\.."
echo ============================================================
echo  开演前（1/2）：复位存量系统数据
echo  ------------------------------------------------------------
echo  什么时候跑：每次开录前；连续录多条时，重录前也再跑一次
echo  它做什么：DROP 并重建 classroom 库、导入种子数据（幂等可反复跑）
echo            复位后全量记录应回到 86 条、无 ACTIVE 预约
echo  ※ 数据库重建时后端无需重启（连接池自动重连）
echo  ※ Redis 缓存不清（本机没有 redis-cli 时自动跳过，不影响演示）
echo  跑完之后：接着双击「00-开演前②检查清单」
echo ============================================================
echo.
rem —— 优先用 Git Bash（/c/... 路径探测才能命中 mysql.exe）；
rem    本机 PATH 上的 bash 是 WSL，跑不了 Windows 的 mysql.exe。
if exist "C:\Program Files\Git\bin\bash.exe" (
  set "BASH_CMD=C:\Program Files\Git\bin\bash.exe"
) else (
  set "BASH_CMD=bash"
)
echo 使用 bash：%BASH_CMD%
echo.
"%BASH_CMD%" deploy/scripts/reset-legacy-data.sh
if errorlevel 1 (
  echo.
  echo [✗] 复位失败——把上面的报错发回去排查。
) else (
  echo.
  echo [√] 复位完成。按任意键关闭本窗口……
)
pause >nul
