@echo off
setlocal enabledelayedexpansion

:: DESC: Detiene el stack Docker de Immich para liberar recursos.
:: ARGS: [Ruta_Immich]
:: RISK: low
:: PERM: user
:: MODE: external

:: =============================================
::  CONFIGURACION
:: =============================================
set "IMMICH_DIR=%~1"
if not defined IMMICH_DIR set "IMMICH_DIR=%HORUS_IMMICH_PATH%"
if not defined IMMICH_DIR set "IMMICH_DIR=C:\immich-app"

:: =============================================
::  BANNER
:: =============================================
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║   📸  Servidor de Fotos - Immich      ║
echo  ║       Apagando sistema...             ║
echo  ╚═══════════════════════════════════════╝
echo.

:: =============================================
::  VALIDACIONES
:: =============================================
if not exist "%IMMICH_DIR%" (
    echo  [X] No se encontro la carpeta de Immich: %IMMICH_DIR%
    exit /b 1
)

:: Verificar si Docker esta activo
docker info >nul 2>&1
if errorlevel 1 (
    echo  [OK] Docker no esta activo. No hay nada que apagar.
    powershell -Command "Start-Sleep -Seconds 3"
    exit /b 0
)

:: Verificar si Immich esta corriendo antes de intentar parar
cd /d "%IMMICH_DIR%"

docker compose ps --status running 2>nul | findstr /i "immich" >nul 2>&1
if errorlevel 1 (
    echo  [OK] Immich no estaba en ejecucion.
    powershell -Command "Start-Sleep -Seconds 3"
    exit /b 0
)

:: =============================================
::  APAGAR IMMICH
:: =============================================
echo  [~] Deteniendo contenedores de Immich...
echo.

docker compose down >nul 2>&1
if errorlevel 1 (
    echo  [~] Reintentando con docker-compose...
    docker-compose down >nul 2>&1
    if errorlevel 1 (
        echo  [X] No se pudieron detener los contenedores.
        powershell -Command "Start-Sleep -Seconds 5"
        exit /b 1
    )
)

:: =============================================
::  RESULTADO
:: =============================================
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║  ✅  Immich apagado correctamente.    ║
echo  ║                                       ║
echo  ║  RAM y CPU liberados.                 ║
echo  ╚═══════════════════════════════════════╝
echo.
powershell -Command "Start-Sleep -Seconds 5"
exit /b 0

