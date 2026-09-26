@echo off
title Act6 - DISARM (restart clean engine)
cd /d "%~dp0..\.."
set "ROOT=%CD%"
echo ============================================================
echo  Act 6 wrap-up * DISARM T5 inject, restart clean engine
echo  ------------------------------------------------------------
echo  What it does (fully automatic):
echo    1) stop current (possibly armed) engine process
echo    2) restart engine with default (disarmed) config
echo    3) verify /api/health is ok and chaos.armed is gone
echo  Then run: cleanup BAT (remove the Act 6 reservation),
echo            then the pre-show checklist BAT to re-verify.
echo  NOTE: engine restarted - log in again on the left screen.
echo ============================================================
echo.
echo [1/4] Stopping current engine process...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*main.js*' -and $_.Name -eq 'node.exe' } | ForEach-Object { Write-Output ('  stopped engine PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue; if ($c) { Write-Output '  [WARN] port 8090 still occupied (PID ' + $c.OwningProcess + ')' } else { Write-Output '  port 8090 is free' }"
echo.
echo [2/4] Writing clean (disarmed) engine launcher (via PowerShell, ASCII)...
powershell -NoProfile -Command "$l = @('@echo off', 'title Engine 8090 (disarmed)', 'cd /d \"%ROOT%\orchestrator\"', 'set \"ORCH_LEGACY_ADMIN_PASSWORD=admin\"', 'set \"ORCH_LEGACY_TEACHER_PASSWORD=233\"', 'set \"ORCH_LEGACY_STUDENT_PASSWORD=abc\"', 'node src\access\main.js'); Set-Content -Path \"$env:TEMP\orch-clean-engine.bat\" -Value $l -Encoding Ascii"
echo.
echo [3/4] Starting clean engine (new window, keep it open)...
start "Engine 8090 (disarmed)" /D "%ROOT%\orchestrator" cmd /k "%TEMP%\orch-clean-engine.bat"
echo.
echo [4/4] Waiting for engine + verifying disarm (up to 60s)...
set /a TRIES=0
:waitloop
set /a TRIES+=1
echo   probe %TRIES% ...
powershell -NoProfile -Command "try { $r = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri 'http://localhost:8090/api/health').Content; if ($r -match '\"status\"\s*:\s*\"ok\"') { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 goto up_ok
if %TRIES% geq 20 goto fail
ping -n 4 127.0.0.1 >nul
goto waitloop
:up_ok
powershell -NoProfile -Command "try { $r = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri 'http://localhost:8090/api/health').Content; if ($r -match '\"armed\"\s*:\s*true') { exit 1 } else { exit 0 } } catch { exit 1 }"
if errorlevel 1 goto still_armed
echo.
echo   [OK] engine disarmed and healthy
echo   Next: run cleanup BAT, then the checklist BAT.
echo.
pause
exit /b 0
:still_armed
echo.
echo   [FAIL] engine is up but chaos.armed is still true - run this bat again.
echo.
pause
exit /b 1
:fail
echo.
echo   [FAIL] engine not ready within 60s. Health right now:
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri 'http://localhost:8090/api/health').Content } catch { Write-Output '  engine 8090 NOT responding (did not start or port busy)' }"
echo   Check the last lines of the "Engine 8090 (disarmed)" window.
echo.
pause
exit /b 1
