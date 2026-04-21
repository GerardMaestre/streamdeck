@echo off
chcp 65001 >nul
:: DESC: Lanza la potente herramienta de Raphi para erradicar todo el bloatware basura preinstalado en tu PC.
:: ARGS: Ninguno
:: RISK: high
:: PERM: admin
:: MODE: external

echo [*] Elevando privilegios para purgar bloatware del sistema...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para eliminar bloatware...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ===================================================
echo     ⚡ HORUS ENGINE - WIN DEBLOATER (RAPHI) ⚡    
echo ===================================================
echo [!] ADVERTENCIA: Este script ejecuta una herramienta remota con privilegios de Administrador.
echo [!] Revisa que entiendes los cambios antes de continuar.
echo [*] Descargando el motor de desinstalación de Bloatware...

powershell.exe -NoProfile -Command "& ([scriptblock]::Create((irm 'https://debloat.raphi.re/')))"
goto :EOF

:Cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0
