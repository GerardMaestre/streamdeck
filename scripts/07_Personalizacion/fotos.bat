@echo off
setlocal enabledelayedexpansion
for /f %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"
:: DESC: Inicia el stack Docker de Immich para servidor local de fotos con estilo.
:: ARGS: [Ruta_Immich]
:: RISK: medium
:: PERM: user
:: MODE: external

set "C_C=!ESC![36m"
set "C_G=!ESC![32m"
set "C_Y=!ESC![33m"
set "C_R=!ESC![31m"
set "C_W=!ESC![97m"
set "C_RST=!ESC![0m"
set "C_DIM=!ESC![90m"

set "IMMICH_DIR=%~1"
if not defined IMMICH_DIR set "IMMICH_DIR=%HORUS_IMMICH_PATH%"
if not defined IMMICH_DIR set "IMMICH_DIR=C:\immich-app"

echo %C_C%   ___                      _      %C_RST%
echo %C_C%  ^|_ _^|_ __  _ __ ___ _ __ ^| ^|__   %C_RST%
echo %C_C%   ^| ^|^| '_ \^| '_ ` _ \ '_ \^| '_ \  %C_RST%
echo %C_C%   ^| ^|^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^|  %C_RST%
echo %C_C%  ^|___^|_^| ^|_^|_^| ^|_^| ^|_^|_^| ^|_^|_^| ^|_^| %C_RST%
echo %C_DIM%=========================================%C_RST%
echo %C_G%   INICIANDO SERVIDOR DE FOTOS LOCAL%C_RST%
echo %C_DIM%=========================================%C_RST%
echo.

:: Validar ruta objetivo ANTES de tocar Docker
if not exist "%IMMICH_DIR%" (
    echo %C_R% [x] ERROR: No se encontro la carpeta de Immich: %IMMICH_DIR%%C_RST%
    echo %C_DIM%     Puedes pasar la ruta como argumento o definir HORUS_IMMICH_PATH.%C_RST%
    ping 127.0.0.1 -n 6 >nul
    exit /b 1
)

:: Verificar si Docker esta respondiendo
docker info >nul 2>&1
if errorlevel 1 (
    echo %C_Y% [?] Docker no esta activo. Invocando Motor de Docker Desktop...%C_RST%
    
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo %C_Y% [?] Intentando encendido secundario mediante enlace de sistema...%C_RST%
        start docker-desktop://
    )
    
    echo %C_C% [~] Despertando motor... espere un momento por favor.%C_RST%
    set /a intentos=0
    :esperar_docker
    ping 127.0.0.1 -n 6 >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        set /a intentos+=1
        if !intentos! GEQ 24 (
            echo.
            echo %C_R% [x] FATAL: Docker no respondio tras 2 minutos.%C_RST%
            echo %C_DIM%     Asegurate de tener Docker Desktop instalado correctamente.%C_RST%
            ping 127.0.0.1 -n 6 >nul
            exit /b 1
        )
        echo %C_DIM%     [ Motor arrancando... Intento !intentos! / 24 ]%C_RST%
        goto esperar_docker
    )
    echo %C_G% [✓] Motor Docker en linea y estabilizado!%C_RST%
    echo.
) else (
    echo %C_G% [✓] Motor Docker detectado y funcionando.%C_RST%
    echo.
)

cd /d "%IMMICH_DIR%"

echo %C_C% [~] Desplegando ecosistema de contenedores (Base de datos, IA, Servidor, Caché)...%C_RST%
docker compose up -d
if errorlevel 1 (
    echo %C_Y% [!] Ajustando version de comando... (Intentando V1)%C_RST%
    docker-compose up -d
    if errorlevel 1 (
        echo.
        echo %C_R% [x] ERROR: Fallo la creacion de los contenedores Docker.%C_RST%
        ping 127.0.0.1 -n 6 >nul
        exit /b 1
    )
)

echo.
echo %C_DIM%===========================================================%C_RST%
echo %C_G%  [✓] COMPLETO: Servidor desplegado con exito.%C_RST%
echo %C_C%      Puedes abrir la aplicacion en tu Movil o TV ahora.%C_RST%
echo %C_DIM%===========================================================%C_RST%
ping 127.0.0.1 -n 6 >nul
exit /b 0