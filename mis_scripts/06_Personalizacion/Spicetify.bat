@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
:: DESC: Instalacion 100% silenciosa en memoria para Spicetify CLI + Marketplace
:: ARGS: Ninguno
:: RISK: high
:: PERM: user / admin

title HORUS ENGINE - SPICETIFY
color 0A

set "LOG_DIR=%TEMP%\horus_spicetify"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "LOG_FILE=%LOG_DIR%\spicetify_silent.log"

echo ===========================================================
echo             HORUS ENGINE - SPICETIFY SETUP
echo ===========================================================
echo [INFO] Ejecutando modo 100%% silencioso e integrado...
echo.

:: 1. Comprobar permisos y asignar flags
set "SPICETIFY_FLAGS="
powershell.exe -InputFormat None -NoProfile -Command "exit (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
if !errorlevel! equ 1 (
    set "SPICETIFY_FLAGS=--bypass-admin"
)

:: 2. Cerrar Spotify
echo [1/4] Cerrando Spotify...
taskkill /F /IM Spotify.exe >nul 2>&1
ping 127.0.0.1 -n 3 >nul

:: 3. Instalar CLI (Hackeado en memoria para silenciar prompts)
echo [2/4] Instalando Spicetify CLI (Invisible)...
set "PS_CLI=$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $s = (Invoke-RestMethod -Uri 'https://raw.githubusercontent.com/spicetify/cli/main/install.ps1'); $s = $s.Replace('[Security.Principal.WindowsBuiltInRole]::Administrator', '[Security.Principal.WindowsBuiltInRole]::Guest'); $s = $s -replace '\$Host\.UI\.PromptForChoice\([^)]+\)', '1'; Invoke-Expression $s"
powershell.exe -InputFormat None -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "!PS_CLI!" > "%LOG_FILE%" 2>&1

set "SPICETIFY_EXE=%LOCALAPPDATA%\spicetify\spicetify.exe"
if not exist "%SPICETIFY_EXE%" (
    echo [ERROR] Fallo en la instalacion del CLI. Revisa el log: %LOG_FILE%
    exit /b 1
)

:: 4. Instalar Marketplace (Hackeado en memoria)
echo [3/4] Instalando Spicetify Marketplace...
"%SPICETIFY_EXE%" !SPICETIFY_FLAGS! config custom_apps marketplace >> "%LOG_FILE%" 2>&1
set "PS_MKTP=$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $s = (Invoke-RestMethod -Uri 'https://raw.githubusercontent.com/spicetify/marketplace/main/resources/install.ps1'); $s = $s.Replace('[Security.Principal.WindowsBuiltInRole]::Administrator', '[Security.Principal.WindowsBuiltInRole]::Guest'); Invoke-Expression $s"
powershell.exe -InputFormat None -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "!PS_MKTP!" >> "%LOG_FILE%" 2>&1

:: 5. Aplicar configuraciones a Spotify
echo [4/4] Inyectando codigo en Spotify...
"%SPICETIFY_EXE%" !SPICETIFY_FLAGS! config inject_css 1 replace_colors 1 overwrite_assets 1 >> "%LOG_FILE%" 2>&1

"%SPICETIFY_EXE%" !SPICETIFY_FLAGS! backup apply >> "%LOG_FILE%" 2>&1
if !errorlevel! neq 0 (
    "%SPICETIFY_EXE%" !SPICETIFY_FLAGS! apply >> "%LOG_FILE%" 2>&1
)

echo.
echo ===========================================================
echo [OK] Spicetify instalado y parcheado en segundo plano.
echo ===========================================================
exit /b 0