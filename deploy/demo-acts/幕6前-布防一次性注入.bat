@echo off
title Act6 - ARM T5 inject (auto restart engine)
cd /d "%~dp0..\.."
set "ROOT=%CD%"
echo ============================================================
echo  Act 6 (response lost - THE core scene) * ARM T5 inject
echo  ------------------------------------------------------------
echo  What it does (fully automatic):
echo    1) stop current engine process
echo    2) write inject spec (T5: first create-reservation call
echo       forwards + commits, then DROPS the response) and restart
echo       the engine with it. The engine only honors this at
echo       startup, so a restart is MANDATORY.
echo    3) wait until /api/health reports chaos.armed = true
echo  Then record: say "book classroom 123 next Wed afternoon"
echo    expect AMBER "verifying..." then manager-identity lookup,
echo    then GREEN "confirmed, not duplicated" (badge on trace)
echo  AFTER recording: run disarm BAT (Act6 - DISARM)
echo ============================================================
echo.
echo [1/4] Stopping current engine process...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*main.js*' -and $_.Name -eq 'node.exe' } | ForEach-Object { Write-Output ('  stopped engine PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue; if ($c) { Write-Output '  [WARN] port 8090 still occupied (PID ' + $c.OwningProcess + ')' } else { Write-Output '  port 8090 is free' }"
echo.
echo [2/4] Writing ARMED engine launcher (via PowerShell, ASCII)...
powershell -NoProfile -Command "$l = @('@echo off', 'title Engine 8090 (ARMED T5 - run DISARM after Act 6)', 'cd /d \"%ROOT%\orchestrator\"', 'set \"ORCH_LEGACY_ADMIN_PASSWORD=admin\"', 'set \"ORCH_LEGACY_TEACHER_PASSWORD=233\"', 'set \"ORCH_LEGACY_STUDENT_PASSWORD=abc\"', 'set \"ORCH_CHAOS_INJECT={\"injects\":[{\"interface\":\"edu.reservation.classroom.create\",\"nth\":1,\"fault\":\"T5\"}]}\"', 'node src\access\main.js'); Set-Content -Path \"$env:TEMP\orch-armed-engine.bat\" -Value $l -Encoding Ascii"
powershell -NoProfile -Command "Write-Output '--- launcher content ---'; Get-Content \"$env:TEMP\orch-armed-engine.bat\"; Write-Output '------------------------'"
echo.
echo [3/4] Starting ARMED engine (new window, keep it open)...
start "Engine 8090 (ARMED T5)" /D "%ROOT%\orchestrator" cmd /k "%TEMP%\orch-armed-engine.bat"
echo.
echo [4/4] Waiting for engine + verifying chaos.armed = true (up to 60s)...
set /a TRIES=0
:waitloop
set /a TRIES+=1
echo   probe %TRIES% ...
powershell -NoProfile -Command "try { $r = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri 'http://localhost:8090/api/health').Content; if ($r -match '\"armed\"\s*:\s*true') { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 goto armed_ok
if %TRIES% geq 20 goto armed_fail
ping -n 4 127.0.0.1 >nul
goto waitloop
:armed_ok
echo.
echo   [OK] engine restarted with T5 inject, chaos.armed = true
echo   You can record Act 6 now. AFTER recording run the DISARM bat!
echo   NOTE: engine restarted - log in again as teacher 233 on the left screen.
echo.
pause
exit /b 0
:armed_fail
echo.
echo   [FAIL] could not confirm chaos.armed = true within 60s.
echo   Engine health right now:
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri 'http://localhost:8090/api/health').Content } catch { Write-Output '  engine 8090 NOT responding (did not start or port busy)' }"
echo   Check the last lines of the "Engine 8090 (ARMED T5)" window.
echo   Rescue: run the DISARM bat to get a normal engine back.
echo.
pause
exit /b 1
