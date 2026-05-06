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
    echo  [X] No se encontro la carpeta de Immich:
    echo      %IMMICH_DIR%
    exit /b 1
)

:: Verificar si Docker esta activo
docker info >nul 2>&1
if errorlevel 1 (
    echo  [OK] Docker no esta activo. No hay nada que apagar.
    echo.
    echo  ╔═══════════════════════════════════════╗
    echo  ║  ✅  No habia contenedores activos.   ║
    echo  ╚═══════════════════════════════════════╝
    timeout /t 3 >nul
    exit /b 0
)

:: Verificar si Immich esta corriendo antes de intentar parar
cd /d "%IMMICH_DIR%"

docker compose ps --status running 2>nul | findstr /i "immich" >nul 2>&1
if errorlevel 1 (
    echo  [OK] Immich no estaba en ejecucion.
    echo.
    echo  ╔═══════════════════════════════════════╗
    echo  ║  ✅  No habia contenedores activos.   ║
    echo  ╚═══════════════════════════════════════╝
    timeout /t 3 >nul
    exit /b 0
)

:: =============================================
::  APAGAR IMMICH
:: =============================================
echo  [~] Deteniendo contenedores de Immich...
echo.

docker compose down >nul 2>&1
if errorlevel 1 (
    echo  [~] Reintentando con docker-compose (v1)...
    docker-compose down >nul 2>&1
    if errorlevel 1 (
        echo.
        echo  [X] No se pudieron detener los contenedores.
        echo      Prueba manualmente: docker compose down
        timeout /t 5 >nul
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
echo  ║  Tus fotos siguen seguras en disco.   ║
echo  ╚═══════════════════════════════════════╝
echo.
timeout /t 4 >nul
exit /b 0
