:: DESC: Mata todos los procesos inutiles de la RAM (Spotify, Adobe, OneDrive, Edge...)
:: ARGS: Ninguno
:: RISK: high
:: PERM: admin
:: MODE: external

@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para liquidar procesos...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ====================================
echo      ⚡ INICIANDO GOD MODE RAM ⚡     
echo ====================================
echo.
echo [!] ADVERTENCIA: se forzara el cierre de procesos y podrias perder trabajo sin guardar.

echo [*] Asesinando procesos zombis...
set "KILLED=0"
for %%P in (
"OneDrive.exe"
"AdobeIPCBroker.exe"
"CCXProcess.exe"
"Spotify.exe"
"Discord.exe"
"chrome.exe"
"msedge.exe"
"YourPhone.exe"
"Widgets.exe"
"Skype.exe"
"Cortana.exe"
"SearchUI.exe"
"EpicGamesLauncher.exe"
"Steam.exe"
"Razer Synapse 3.exe"
"Razer Central.exe"
) do (
	taskkill /F /IM %%~P /T >nul 2>&1
	if !errorlevel! EQU 0 (
		set /a KILLED+=1
		echo [✓] %%~P cerrado.
	)
)

echo.
echo [V] MEMORIA RAM PURGADA Y LISTA PARA GAMING. Procesos cerrados: !KILLED!
exit /b 0

:Cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0