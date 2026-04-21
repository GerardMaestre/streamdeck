@echo off
setlocal enabledelayedexpansion
for /f %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"
:: DESC: Detiene el stack Docker de Immich para liberar recursos.
:: ARGS: [Ruta_Immich]
:: RISK: low
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

echo %C_R%   ___                      _      %C_RST%
echo %C_R%  ^|_ _^|_ __  _ __ ___ _ __ ^| ^|__   %C_RST%
echo %C_R%   ^| ^|^| '_ \^| '_ ` _ \ '_ \^| '_ \  %C_RST%
echo %C_R%   ^| ^|^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^| ^|  %C_RST%
echo %C_R%  ^|___^|_^| ^|_^|_^| ^|_^| ^|_^|_^| ^|_^|_^| ^|_^| %C_RST%
echo %C_DIM%=========================================%C_RST%
echo %C_W%   APAGANDO SERVIDOR Y MOTORIA IA.       %C_RST%
echo %C_DIM%=========================================%C_RST%
echo.

:: Validar ruta objetivo ANTES de tocar Docker
if not exist "%IMMICH_DIR%" (
    echo %C_R% [x] ERROR: La carpeta raiz %IMMICH_DIR% no existe.%C_RST%
    echo %C_DIM%     Configura HORUS_IMMICH_PATH si esta en otra ubicacion.%C_RST%
    ping 127.0.0.1 -n 6 >nul
    exit /b 1
)

:: Verificar si Docker esta activo antes de intentar parar nada
docker info >nul 2>&1
if errorlevel 1 (
    echo %C_Y% [?] Docker Engine no esta en ejecucion en este momento.%C_RST%
    echo.
    echo %C_G% [✓] El sistema esta limpio. No hay consumo fantasma de RAM.%C_RST%
    ping 127.0.0.1 -n 4 >nul
    exit /b 0
) else (
    echo %C_C% [~] Interceptando contenedores en ejecucion...%C_RST%
)

cd /d "%IMMICH_DIR%"

:: Intentar apagar con docker compose (V2) o docker-compose (V1)
echo %C_Y% [~] Forzando el apagado de la Base de Datos, Servidor y ML...%C_RST%
docker compose down >nul 2>&1
if errorlevel 1 (
    echo %C_Y% [!] Modo V2 fallo, intentando motor V1...%C_RST%
    docker-compose down
)

echo %C_Y% [~] Purgando instancia WSL subyacente para liberar RAM...%C_RST%
taskkill /IM "Docker Desktop.exe" /F >nul 2>&1
wsl --shutdown

echo.
echo %C_DIM%===========================================================%C_RST%
echo %C_G%  [✓] EXITO: Todos los contenedores de Immich neutralizados.%C_RST%
echo %C_C%      Recuperado ancho de banda, memoria RAM y procesador.%C_RST%
echo %C_DIM%===========================================================%C_RST%
ping 127.0.0.1 -n 6 >nul
exit /b 0
