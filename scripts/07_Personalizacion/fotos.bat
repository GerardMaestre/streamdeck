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

:: 1. Comprobar que la carpeta de Immich existe
if not exist "%IMMICH_DIR%" (
    echo  [X] No se encontro la carpeta de Immich:
    echo      %IMMICH_DIR%
    echo.
    echo  Soluciones:
    echo    1. Pasa la ruta como argumento: fotos.bat "C:\ruta\immich"
    echo    2. Define la variable HORUS_IMMICH_PATH en el sistema.
    echo.
    exit /b 1
)

:: 2. Comprobar que existe docker-compose.yml o compose.yaml
if not exist "%IMMICH_DIR%\docker-compose.yml" (
    if not exist "%IMMICH_DIR%\compose.yaml" (
        echo  [X] No se encontro docker-compose.yml ni compose.yaml en:
        echo      %IMMICH_DIR%
        echo.
        echo  Asegurate de que Immich esta correctamente instalado.
        timeout /t 5 >nul
        exit /b 1
    )
)

:: =============================================
::  DOCKER: ARRANCAR SI NO ESTA ACTIVO
:: =============================================
docker info >nul 2>&1
if errorlevel 1 (
    echo  [~] Docker no esta activo. Arrancando Docker Desktop...

    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        :: Fallback: URI protocol
        start docker-desktop://
    )

    echo  [~] Esperando a que Docker responda...
    set /a intentos=0
    :esperar_docker
    timeout /t 5 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        set /a intentos+=1
        if !intentos! GEQ %MAX_DOCKER_WAIT% (
            echo.
            echo  [X] Docker no respondio tras 2 minutos.
            echo      Verifica que Docker Desktop este instalado y funcionando.
            timeout /t 5 >nul
            exit /b 1
        )
        :: Barra de progreso visual
        set /a pct=!intentos!*100/%MAX_DOCKER_WAIT%
        echo  [~] Esperando Docker... (!pct!%%)
        goto esperar_docker
    )
    echo  [OK] Docker Desktop listo.
    echo.
) else (
    echo  [OK] Docker ya estaba activo.
)

:: =============================================
::  COMPROBAR SI IMMICH YA ESTA CORRIENDO
:: =============================================
cd /d "%IMMICH_DIR%"

docker compose ps --status running 2>nul | findstr /i "immich" >nul 2>&1
if not errorlevel 1 (
    echo  [!] Immich ya esta en ejecucion.
    echo      No es necesario volver a arrancarlo.
    echo.
    goto mostrar_acceso
)

:: =============================================
::  ARRANCAR IMMICH
:: =============================================
echo  [~] Levantando contenedores de Immich...
echo.

docker compose up -d 2>nul
if errorlevel 1 (
    echo  [~] Reintentando con docker-compose (v1)...
    docker-compose up -d
    if errorlevel 1 (
        echo.
        echo  [X] No se pudo arrancar Immich.
        echo      Revisa los logs con: docker compose logs
        timeout /t 5 >nul
        exit /b 1
    )
)

echo.
echo  [OK] Contenedores levantados correctamente.

:: =============================================
::  HEALTH CHECK: ESPERAR A QUE IMMICH RESPONDA
:: =============================================
echo  [~] Verificando que Immich responde...

set /a health_tries=0
:health_loop
timeout /t 5 /nobreak >nul

:: Intentar una peticion HTTP al puerto de Immich
curl -s -o nul -w "%%{http_code}" http://localhost:%IMMICH_PORT%/api/server/ping 2>nul | findstr "200" >nul 2>&1
if not errorlevel 1 (
    echo  [OK] Immich responde correctamente.
    goto mostrar_acceso
)

set /a health_tries+=1
if !health_tries! GEQ %MAX_HEALTH_WAIT% (
    echo  [!] Immich tarda en responder, pero los contenedores estan arriba.
    echo      Puede necesitar unos minutos mas para cargar la base de datos.
    goto mostrar_acceso
)

set /a hpct=!health_tries!*100/%MAX_HEALTH_WAIT%
echo  [~] Immich iniciandose... (!hpct!%%)
goto health_loop

:: =============================================
::  MOSTRAR INFORMACION DE ACCESO
:: =============================================
:mostrar_acceso

:: Obtener la IP local de la red
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0"') do (
    set "LOCAL_IP=%%a"
    set "LOCAL_IP=!LOCAL_IP: =!"
    :: Tomar solo la primera IP valida
    if defined LOCAL_IP goto mostrar_url
)

:mostrar_url
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║  ✅  Servidor Immich en linea!        ║
echo  ╠═══════════════════════════════════════╣
if defined LOCAL_IP (
echo  ║  📱 Movil:  http://!LOCAL_IP!:%IMMICH_PORT%  ║
)
echo  ║  💻 Local:  http://localhost:%IMMICH_PORT%    ║
echo  ╠═══════════════════════════════════════╣
echo  ║  Para apagar: ejecuta cerrar_fotos    ║
echo  ╚═══════════════════════════════════════╝
echo.
timeout /t 8 >nul
exit /b 0