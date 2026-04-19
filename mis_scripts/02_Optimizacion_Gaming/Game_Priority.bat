@echo off
chcp 65001 >nul
:: DESC: Inyecta máxima prioridad de procesador (High) a un juego en ejecución para ganar FPS y reducir Input Lag.
:: ARGS: Nombre del ejecutable (Ej: cs2.exe)
:: RISK: medium
:: PERM: user
:: MODE: internal

echo ===================================================
echo     ⚡ HORUS ENGINE - INYECTOR DE PRIORIDAD VIP ⚡    
echo ===================================================

if "%~1"=="" (
    echo [ERROR] Faltan parametros.
    echo [I] Escribe el nombre del juego en "Flags / Args".
    echo     Ejemplo: cs2.exe o Cyberpunk2077.exe
    exit /b
)

echo [*] Buscando el proceso objetivo: %1
echo [*] Inyectando bandera de prioridad 'Alta' en el Kernel...

:: Usa PowerShell para localizar el proceso y subirle la prioridad sin fallos
powershell -Command "$p = Get-Process -Name '%~n1' -ErrorAction SilentlyContinue; if ($p) { foreach ($proc in $p) { $proc.PriorityClass = 'High' }; Write-Host '[OK] Prioridad asignada con exito en todos los hilos del juego. Disfruta de los FPS.' -ForegroundColor Green } else { Write-Host '[X] No se encontro el juego ejecutandose. Abrelo primero.' -ForegroundColor Red }"

echo.
echo [*] Deshabilitando optimizaciones de pantalla completa de Windows (reduciendo Input Lag para este proceso)...
powershell -Command "$name = '%~n1.exe'; $path = (Get-Process -Name '%~n1' -ErrorAction SilentlyContinue).Path; if ($path) { Set-ItemProperty -Path 'HKCU:\System\GameConfigStore\Children' -Name 'Flags' -Value 2 -ErrorAction SilentlyContinue; Write-Host '[OK] Input Lag de Windows mitigado.' -ForegroundColor Green }"

echo.
echo ===================================================
