@echo off
setlocal enabledelayedexpansion

:: DESC: Inicia el stack Docker de Immich para servidor local de fotos.
:: ARGS: [Ruta_Immich]
:: RISK: medium
:: PERM: user
:: MODE: external

:: =============================================
::  CONFIGURACION
:: =============================================
set "IMMICH_DIR=%~1"
if not defined IMMICH_DIR set "IMMICH_DIR=%HORUS_IMMICH_PATH%"
if not defined IMMICH_DIR set "IMMICH_DIR=C:\immich-app"
set "MAX_DOCKER_WAIT=120"
set "MAX_HEALTH_WAIT=60"
set "IMMICH_PORT=2283"
set "LOG_FILE=%TEMP%\immich_start.log"

echo [%DATE% %TIME%] Iniciando fotos.bat > "%LOG_FILE%"

:: =============================================
::  BANNER
:: =============================================
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║   📸  Servidor de Fotos - Immich      ║
echo  ║       Iniciando sistema...            ║
echo  ╚═══════════════════════════════════════╝
echo.

:: =============================================
::  VALIDACIONES PREVIAS
:: =============================================

if not exist "%IMMICH_DIR%" (
    echo  [X] No se encontro la carpeta de Immich: %IMMICH_DIR%
    echo [%DATE% %TIME%] ERROR: Directorio no encontrado: %IMMICH_DIR% >> "%LOG_FILE%"
    exit /b 1
)

:: =============================================
::  DOCKER: ARRANCAR SI NO ESTA ACTIVO
:: =============================================
docker info >nul 2>&1
if errorlevel 1 (
    echo  [~] Docker no esta activo. Intentando arrancar...
    echo [%DATE% %TIME%] Docker inactivo. Lanzando... >> "%LOG_FILE%"

    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        start docker-desktop://
    )

    echo  [~] Esperando a que Docker responda...
    set /a intentos=0
    :esperar_docker
    powershell -Command "Start-Sleep -Seconds 2"
    docker info >nul 2>&1
    if errorlevel 1 (
        set /a intentos+=2
        if !intentos! GEQ %MAX_DOCKER_WAIT% (
            echo  [X] Docker no respondio tras 2 minutos.
            echo [%DATE% %TIME%] ERROR: Timeout Docker >> "%LOG_FILE%"
            powershell -Command "Start-Sleep -Seconds 5"
            exit /b 1
        )
        echo  [~] Esperando Docker... (!intentos!s)
        goto esperar_docker
    )
    echo  [OK] Docker listo.
) else (
    echo  [OK] Docker ya estaba activo.
)

:: =============================================
::  ARRANCAR IMMICH
:: =============================================
cd /d "%IMMICH_DIR%"
echo [%DATE% %TIME%] CWD: %CD% >> "%LOG_FILE%"

:: Comprobar si ya corre
docker compose ps --status running 2>nul | findstr /i "immich" >nul 2>&1
if not errorlevel 1 (
    echo  [!] Immich ya esta en ejecucion.
    echo [%DATE% %TIME%] Ya en ejecucion. >> "%LOG_FILE%"
    goto mostrar_acceso
)

echo  [~] Levantando contenedores de Immich...
echo [%DATE% %TIME%] Ejecutando docker compose up... >> "%LOG_FILE%"

docker compose up -d 2>>"%LOG_FILE%"
if errorlevel 1 (
    echo  [~] Reintentando con docker-compose...
    docker-compose up -d 2>>"%LOG_FILE%"
    if errorlevel 1 (
        echo  [X] Error al arrancar contenedores.
        echo [%DATE% %TIME%] ERROR FATAL: docker compose up fallo >> "%LOG_FILE%"
        powershell -Command "Start-Sleep -Seconds 5"
        exit /b 1
    )
)

:: =============================================
::  HEALTH CHECK
:: =============================================
echo  [~] Verificando que Immich responde...
set /a health_tries=0
:health_loop
powershell -Command "Start-Sleep -Seconds 3"

curl -s -o nul -w "%%{http_code}" http://localhost:%IMMICH_PORT%/api/server/ping 2>nul | findstr "200" >nul 2>&1
if not errorlevel 1 (
    echo  [OK] Immich responde correctamente.
    echo [%DATE% %TIME%] Health check OK >> "%LOG_FILE%"
    goto mostrar_acceso
)

set /a health_tries+=1
if !health_tries! GEQ %MAX_HEALTH_WAIT% (
    echo  [!] Immich tarda en responder. Revisa manualmente.
    echo [%DATE% %TIME%] Health check timeout (continuando) >> "%LOG_FILE%"
    goto mostrar_acceso
)

echo  [~] Immich iniciandose... (!health_tries!)
goto health_loop

:: =============================================
::  RESULTADO
:: =============================================
:mostrar_acceso
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0"') do (
    set "LOCAL_IP=%%a"
    set "LOCAL_IP=!LOCAL_IP: =!"
    if defined LOCAL_IP goto finalizado
)

:finalizado
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║  ✅  Servidor Immich en linea!        ║
echo  ╠═══════════════════════════════════════╣
if defined LOCAL_IP (
echo  ║  📱 Movil:  http://!LOCAL_IP!:%IMMICH_PORT%  ║
)
echo  ║  💻 Local:  http://localhost:%IMMICH_PORT%    ║
echo  ╚═══════════════════════════════════════╝
echo.
powershell -Command "Start-Sleep -Seconds 5"
exit /b 0