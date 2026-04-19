@echo off
chcp 65001 >nul
:: DESC: Lee los sensores S.M.A.R.T. de tus discos (HDD/SSD) para alertarte si están a punto de romperse físicamente.
:: ARGS: Ninguno
:: RISK: medium
:: PERM: admin
:: MODE: external

echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para verificar los discos...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ===================================================
echo       ⚡ HORUS ENGINE - ORÁCULO DE HARDWARE ⚡      
echo ===================================================
echo [*] Interrogando a los chips S.M.A.R.T. de los discos...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$disks = Get-PhysicalDisk; foreach ($disk in $disks) { Write-Host '========================================='; Write-Host ('DISCO: ' + $disk.FriendlyName) -ForegroundColor Cyan; Write-Host ('TIPO: ' + $disk.MediaType); Write-Host ('TAMAÑO: ' + [math]::Round($disk.Size / 1GB, 2) + ' GB'); if ($disk.HealthStatus -eq 'Healthy') { Write-Host 'ESTADO DE SALUD: SALUDABLE (Sin riesgo inminente)' -ForegroundColor Green } elseif ($disk.HealthStatus -eq 'Warning') { Write-Host 'ESTADO DE SALUD: ADVERTENCIA (Sectores dañados, haz backup)' -ForegroundColor Yellow } else { Write-Host 'ESTADO DE SALUD: PELIGRO CRÍTICO (Fallo inminente)' -ForegroundColor Red }; Write-Host 'ESTADO OPERATIVO: ' $disk.OperationalStatus; }"

echo.
echo ===================================================
echo [OK] Diagnostico profundo finalizado.
echo ===================================================
pause
