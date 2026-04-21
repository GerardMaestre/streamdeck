@echo off
setlocal enabledelayedexpansion
:: DESC: Inicia el stack Docker de Immich para servidor local de fotos.
:: ARGS: [Ruta_Immich]
:: RISK: medium
:: PERM: user
:: MODE: external

set "IMMICH_DIR=%~1"
if not defined IMMICH_DIR set "IMMICH_DIR=%HORUS_IMMICH_PATH%"
if not defined IMMICH_DIR set "IMMICH_DIR=C:\immich-app"

echo =========================================
echo       Encendiendo Servidor Immich...
echo =========================================
echo.

:: Validar ruta objetivo ANTES de tocar Docker
if not exist "%IMMICH_DIR%" (
    echo [ERROR] No se encontro la carpeta de Immich: %IMMICH_DIR%
    echo         Puedes pasar la ruta como argumento o definir HORUS_IMMICH_PATH.
    pause
    exit /b 1
)

:: Verificar si Docker esta respondiendo
docker info >nul 2>&1
if errorlevel 1 (
    echo [INFO] Docker no esta activo. Intentando arrancar Docker Desktop...
    
    :: Intentar localizar Docker Desktop si no esta en la ruta por defecto
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo [ERROR] No se encontro Docker Desktop en la ruta habitual.
        echo         Intentando comando 'start docker-desktop'...
        start docker-desktop://
    )
    
    echo [INFO] Esperando a que Docker se inicie...
    set /a intentos=0
    :esperar_docker
    timeout /t 5 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        set /a intentos+=1
        if !intentos! GEQ 24 (
            echo.
            echo [ERROR] Docker no respondio tras 2 minutos de espera.
            echo         Asegurate de que Docker Desktop esta instalado y funcionando.
            pause
            exit /b 1
        )
        echo [INFO] Docker aun no esta listo... esperando ^(intento !intentos!/24^)
        goto esperar_docker
    )
    echo [OK] Docker Desktop esta listo!
    echo.
)

cd /d "%IMMICH_DIR%"

:: Intentar arrancar con docker compose (V2) o docker-compose (V1)
echo [INFO] Ejecutando docker compose up...
docker compose up -d
if errorlevel 1 (
    echo [WARN] Fallo 'docker compose'. Intentando 'docker-compose'...
    docker-compose up -d
    if errorlevel 1 (
        echo.
        echo [ERROR] No se pudo arrancar Immich con ningun comando de Docker.
        pause
        exit /b 1
    )
)

echo.
echo =========================================
echo  Magia hecha! El servidor esta en linea.
echo  Ya puedes abrir la app en tu movil.
echo =========================================
timeout /t 5 >nul
exit /b 0