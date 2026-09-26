@echo off
chcp 65001 >nul
title 第 4 幕前 - 预置维修窗口
cd /d "%~dp0..\.."
echo ============================================================
echo  第 4 幕（跨域事实不可替代）· 开录前预置
echo  ------------------------------------------------------------
echo  它做什么：ADMIN 走存量系统【管理接口】给数智楼 123（id=5）
echo            创建一条「明天全天」的维修窗口——不插库、零侵入
echo  跑完之后（不入镜，先做这两步再开录）：
echo    ① 右屏用 admin 登录（密码过不了 8 位前端校验的话，用给过你的
echo       控制台命令登录）→「维护管理」→ 窗口应恰有 1 条
echo    ② 开录：左屏说「帮我借下周三下午数智楼 123」→ 应得红卡并
echo       精确说出检修时间
echo  本幕收尾：双击「幕间-清理副作用」清掉这个窗口
echo ============================================================
echo.
where bash >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 bash，请确认 Git Bash 在 PATH 里。
  pause
  exit /b 1
)
bash deploy/scripts/demo-prepare.sh maintenance
echo.
echo 预置完成。按任意键关闭本窗口……
pause >nul
