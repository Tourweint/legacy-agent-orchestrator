@echo off
chcp 65001 >nul
title 加镜 C3 - 预置占用 222
cd /d "%~dp0..\.."
echo ============================================================
echo  加镜 C3（借两间的第二间失败 → 看第一间是否自动撤销）· 开录前预置
echo  ------------------------------------------------------------
echo  它做什么：教师 233 走业务接口占用数智楼 222（id=4）
echo            「明天下午 13:00-17:00（北京）」——不插库、零侵入
echo  跑完之后：直接开录。左屏说「帮我借下周三下午 123 和 222 各一间」
echo            → 第二间失败，观察第一间是否被自动撤掉
echo            （任务后断言：ACTIVE 增量应为 0）
echo  本幕收尾：双击「幕间-清理副作用」
echo ============================================================
echo.
where bash >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 bash，请确认 Git Bash 在 PATH 里。
  pause
  exit /b 1
)
bash deploy/scripts/demo-prepare.sh occupy-222
echo.
echo 预置完成。按任意键关闭本窗口……
pause >nul
