@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
:: DESC: Instalador desatendido. Instala todo el software base de tu PC en segundo plano (Chrome, Steam, Discord, etc.).
:: ARGS: Ninguno (Pide permisos de Administrador automáticamente)
:: RISK: high
:: PERM: admin
:: MODE: external

:: =====================================================================
:: HORUS AUTOPILOT - INSTALADOR MAESTRO DE SOFTWARE
:: =====================================================================
color 0b
echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '!errorlevel!' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para analizar informacion del sistema...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ===================================================
echo     INICIANDO INSTALACION DESATENDIDA DE APPS      
echo ===================================================
echo.

:: Lista de aplicaciones (puedes añadir o quitar las que quieras separadas por espacio)
set "APPS=EpicGames.EpicGamesLauncher Google.Chrome Valve.Steam Guru3D.Afterburner Discord.Discord Spotify.Spotify GeekUninstaller.GeekUninstaller Microsoft.PCManager.Beta RARLab.WinRAR Ryochan7.DS4Windows Nexova.UpdateHub KeeWeb.KeeWeb"

:: Bucle de instalación optimizado
for %%A in (%APPS%) do (
    echo [HORUS] Instalando %%A en segundo plano...
    winget install --id=%%A -e --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
    if !errorlevel! equ 0 (
        echo         - Exito.
    ) else (
        echo         - Fallo o ya estaba instalado.
    )
)

echo.
echo ===================================================
echo [OK] El despliegue de software ha finalizado.
echo ===================================================
pause
