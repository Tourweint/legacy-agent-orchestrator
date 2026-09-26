@echo off
chcp 65001 >nul
title 第 0 幕 - 存量系统零改动证明
cd /d "%~dp0..\.."
echo ============================================================
echo  第 0 幕（开场）· 证明：mock-legacy（存量系统）零改动
echo  ------------------------------------------------------------
echo  ※ 本窗口【可以入镜】：它展示的不是我们的代码，是 git 的证词
echo  它做什么：git status --short mock-legacy —— 输出为空 =
echo            该目录没有任何修改、没有任何新增文件
echo  念稿要点：见逐字稿第 0 幕，最后那行结论可直接指着念
echo ============================================================
echo.
where git >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 git。
  pause
  exit /b 1
)
echo [1] git status --short mock-legacy：
echo ------------------------------------------------------------
set "CHANGES="
for /f "delims=" %%i in ('git status --short mock-legacy') do set "CHANGES=1"
git status --short mock-legacy
echo ------------------------------------------------------------
if not defined CHANGES (
  echo   [√] 输出为空 —— 存量系统零改动：没改一行代码，没加一个文件
) else (
  echo   [✗] 检测到改动（上面列出的就是）——先排查再录！
)
echo.
echo [2] 最后一次触碰 mock-legacy 的提交（证明它从导入起就没动过）：
echo ------------------------------------------------------------
git log -1 --format="%%h  %%ad  %%s" --date=short -- mock-legacy
echo ------------------------------------------------------------
echo.
pause >nul
