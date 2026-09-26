@echo off
chcp 65001 >nul
title 幕间 - 清理副作用
cd /d "%~dp0..\.."
echo ============================================================
echo  幕间 / 重录前：清理上一幕造成的副作用
echo  ------------------------------------------------------------
echo  它做什么（全走业务接口，不插库）：
echo    ① 用记录归属者本人的身份撤销所有 ACTIVE 预约
echo    ② 用 ADMIN 取消所有生效中的维修窗口
echo    ③ 复核：两者都应为 0，不清干净会以红字报错
echo  什么时候跑：每幕收尾；重录某幕之前必跑
echo  跑完之后：按下一幕的「幕X前-…」BAT 做预置，然后开录
echo ============================================================
echo.
where bash >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 bash，请确认 Git Bash 在 PATH 里。
  pause
  exit /b 1
)
bash deploy/scripts/demo-cleanup.sh
echo.
echo 清理完成（若上面有红字警告，先排查再录）。按任意键关闭本窗口……
pause >nul
