@echo off
:: DESC: Detiene el stack Docker de Immich para liberar recursos.
:: ARGS: [Ruta_Immich]
:: RISK: low
:: PERM: user
:: MODE: external

set "IMMICH_DIR=%~1"
if not defined IMMICH_DIR set "IMMICH_DIR=%HORUS_IMMICH_PATH%"
if not defined IMMICH_DIR set "IMMICH_DIR=C:\immich-app"

echo =========================================
echo       Apagando Servidor Immich...
echo =========================================
echo.

:: Validar ruta objetivo ANTES de tocar Docker
if not exist "%IMMICH_DIR%" (
    echo [ERROR] No se encontro la carpeta de Immich: %IMMICH_DIR%
    echo         Puedes pasar la ruta como argumento o definir HORUS_IMMICH_PATH.
    pause
    exit /b 1
)

:: Verificar si Docker esta activo antes de intentar parar nada
docker info >nul 2>&1
if errorlevel 1 (
    echo [INFO] Docker no esta activo o no responde. No hay nada que apagar.
    echo.
    echo =========================================
    echo  No habia contenedores ejecutandose.
    echo =========================================
    timeout /t 3 >nul
    exit /b 0
)

cd /d "%IMMICH_DIR%"

:: Intentar apagar con docker compose (V2) o docker-compose (V1)
echo [INFO] Ejecutando docker compose down...
docker compose down >nul 2>&1
if errorlevel 1 (
    echo [WARN] Fallo 'docker compose'. Intentando 'docker-compose'...
    docker-compose down
)

echo.
echo =========================================
echo  Todos los contenedores de Immich se han
echo  apagado. Ya no consumen RAM ni CPU.
echo =========================================
timeout /t 5 >nul
exit /b 0
