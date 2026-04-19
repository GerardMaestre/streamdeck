@echo off
chcp 65001 >nul
:: DESC: Lanza la navaja suiza de Chris Titus. Perfecta para instalar programas base y optimizar Windows a fondo.
:: ARGS: Ninguno
:: RISK: high
:: PERM: admin
:: MODE: external

echo [*] Elevando privilegios para desinstalar telemetría profunda...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para purgar telemetria...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ===================================================
echo     ⚡ HORUS ENGINE - CHRIS TITUS WIN-UTILS ⚡    
echo ===================================================
echo [!] ADVERTENCIA: Este script ejecuta una herramienta remota con permisos de Administrador.
echo [!] Asegurate de tener copia de seguridad o punto de restauracion.
echo [*] Descargando y ejecutando motor de optimización...

powershell.exe -NoProfile -Command "iwr -useb https://christitus.com/win | iex"
goto :EOF

:Cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0
