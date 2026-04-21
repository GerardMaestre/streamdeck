:: DESC: Optimiza el DNS, Winsock y adaptador de red para reducir PING en gaming.
:: ARGS: Ninguno
:: RISK: high
:: PERM: admin
:: MODE: external

@echo off
chcp 65001 >nul
echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para configurar la Red...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ====================================
echo     OPTIMIZADOR DE RED AGRESIVO
echo ====================================
echo.
echo [!] ADVERTENCIA: Este script reinicia la pila de red y puede cortar tu conexion temporalmente.

echo [*] Renovando direccion IP...
ipconfig /release >nul 2>&1
ipconfig /renew >nul 2>&1

echo [*] Limpiando cache DNS...
ipconfig /flushdns >nul

echo [*] Reseteando Winsock y capa TCP/IP...
netsh winsock reset >nul
netsh int ip reset >nul
netsh interface ipv4 reset >nul
netsh interface ipv6 reset >nul

echo [*] Maximizando autotuning de red y algoritmos TCP...
netsh int tcp set global autotuninglevel=normal >nul
netsh int tcp set global chimney=enabled >nul 2>&1
netsh int tcp set global dca=enabled >nul 2>&1
netsh int tcp set global netdma=enabled >nul 2>&1
netsh int tcp set global ecncapability=enabled >nul 2>&1
netsh int tcp set heuristics disabled >nul 2>&1
netsh int tcp set global rfc1323=disabled >nul 2>&1

echo [*] Optimizando resolucion de DNS local...
ipconfig /flushdns >nul
ipconfig /registerdns >nul 2>&1

echo.
echo [V] RED OPTIMIZADA. SE RECOMIENDA REINICIAR.
exit /b 0

:Cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0