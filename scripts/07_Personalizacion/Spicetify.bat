@echo off
chcp 65001 >nul
:: DESC: Inyecta el motor Spicetify en el cliente oficial de Spotify para desbloquear temas visuales, extensiones y letras.
:: ARGS: Ninguno
:: RISK: high
:: PERM: user
:: MODE: external
title HORUS ENGINE - SPICETIFY
echo ===================================================
echo     HORUS ENGINE - SPICETIFY THEME INJECTOR
echo ===================================================
echo.
echo [!] ADVERTENCIA: Este script ejecuta instaladores remotos de PowerShell.
echo.

echo [*] Cerrando Spotify...
taskkill /F /IM Spotify.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo.
echo [*] Paso 1/3 - Instalando Spicetify CLI...
echo     Esto puede tardar, espera por favor...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex"
echo.

echo [*] Paso 2/3 - Instalando Marketplace...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb https://raw.githubusercontent.com/spicetify/marketplace/main/resources/install.ps1 | iex"
echo.

echo [*] Paso 3/3 - Aplicando Spicetify...
echo.
set "PATH=%LOCALAPPDATA%\spicetify;%PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "spicetify backup apply"
echo.

echo ===================================================
echo [OK] Spicetify instalado correctamente.
echo     Abre Spotify para ver los cambios.
echo ===================================================
echo.
pause
exit /b 0

:Cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0
