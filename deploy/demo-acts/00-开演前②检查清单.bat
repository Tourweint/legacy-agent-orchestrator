@echo off
chcp 65001 >nul
title 幕前 00 - 检查清单
cd /d "%~dp0..\.."
echo ============================================================
echo  开演前（2/2）：演示前检查清单
echo  ------------------------------------------------------------
echo  什么时候跑：四个服务都起来之后、按下录制键之前
echo  它做什么：自动核对 19 项（三身份登录 / 混沌撤防 / 双屏在线 /
echo            教室状态 / 证据链等），失败会红字点名并退出
echo  跑完之后：最后剩 1 项人工——投影上目视确认深浅主题，然后开录
echo ============================================================
echo.
where bash >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 bash，请确认 Git Bash 在 PATH 里。
  pause
  exit /b 1
)
bash deploy/scripts/demo-checklist.sh
echo.
echo 按“全过——可以开始演示”后，按任意键关闭本窗口……
pause >nul
