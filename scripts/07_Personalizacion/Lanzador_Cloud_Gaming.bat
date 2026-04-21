@echo off
chcp 65001 >nul
:: DESC: Automatiza entorno Cloud Gaming. Con menu interactivo o parametros directos.
:: ARGS: host | client 
:: RISK: high
:: PERM: admin
:: MODE: external

echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

color 0b

:: Interpretar Parametros Silenciosos (Para usar desde el Dashboard)
if /I "%~1"=="host" set choice=1& goto mode_selected
if "%~1"=="1" set choice=1& goto mode_selected
if /I "%~1"=="client" set choice=2& goto mode_selected
if "%~1"=="2" set choice=2& goto mode_selected

echo ===================================================
echo     ⚡ HORUS ENGINE - ORQUESTADOR CLOUD GAMING ⚡
echo ===================================================
echo.
echo Selecciona el rol de este PC:
echo.
echo [1] HOST / SERVIDOR (Este PC ejecuta el juego - Instala Sunshine)
echo [2] CLIENTE         (Este PC reproduce el streaming - Instala Moonlight)
echo [3] Salir
echo.

set /p choice="Ingresa un numero (1-3): "

:mode_selected
if "%choice%"=="3" exit
if "%choice%"=="1" goto host
if "%choice%"=="2" goto client
goto end


:: =======================================
:: RUTINA DE INSTALACION COMUN (TAILSCALE)
:: =======================================
:instalar_tailscale
where tailscale >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "C:\Program Files\Tailscale\tailscale.exe" (
        echo [!] Tailscale VPN NO instalado. Descargando silenciosamente con reparacion forzada...
        winget install --id Tailscale.Tailscale -e --force --silent --accept-package-agreements --accept-source-agreements
        echo [*] Esperando 5 segundos a que inicie el servicio Tailscale...
        timeout /t 5 /nobreak >nul
        set "PATH=%PATH%;C:\Program Files\Tailscale"
    ) else (
        set "PATH=%PATH%;C:\Program Files\Tailscale"
    )
)
goto :eof

:: ==========================
:: MODO HOST (SUNSHINE)
:: ==========================
:host
echo.
echo [*] MODO HOST SELECCIONADO.
echo [*] Escaneando dependencias (Tailscale y Sunshine)...
call :instalar_tailscale

if not exist "C:\Program Files\Sunshine\sunshine.exe" (
    if not exist "C:\Program Files\Sunshine\tools\sunshine.exe" (
        echo [!] Sunshine NO instalado. Descargando silenciosamente...
        winget install --id LizardByte.Sunshine -e --force --silent --accept-package-agreements --accept-source-agreements
        echo [*] Esperando 5 segundos a que inicie el servicio Sunshine...
        timeout /t 5 /nobreak >nul
    )
)

echo [*] Levantando tunel VPN (Tailscale)...
tailscale up
echo [OK] Red conectada a los nodos globales.
echo [*] ===== INGRESA ESTA IP EN EL MOONLIGHT CLIENTE =====
tailscale ip -4
echo =======================================================
echo.

echo [*] Iniciando motor de transmision AV1/HEVC (Sunshine)...
tasklist /FI "IMAGENAME eq sunshine.exe" 2>NUL | find /I /N "sunshine.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [I] Sunshine ya esta ejecutando.
) else (
    if exist "C:\Program Files\Sunshine\sunshine.exe" (
        powershell -WindowStyle Hidden -Command "Start-Process 'C:\Program Files\Sunshine\sunshine.exe' -WindowStyle Hidden"
    ) else if exist "C:\Program Files\Sunshine\tools\sunshine.exe" (
        powershell -WindowStyle Hidden -Command "Start-Process 'C:\Program Files\Sunshine\tools\sunshine.exe' -WindowStyle Hidden"
    )
)

timeout /t 2 /nobreak >nul
echo [*] Optimizando prioridad de CPU para cero Input Lag...
powershell -Command "$p = Get-Process -Name 'sunshine' -ErrorAction SilentlyContinue; if ($p) { $p.PriorityClass = 'High' }"
echo.
echo [V] HOST ONLINE Y LISTO.
pause
exit

:: ==========================
:: MODO CLIENTE (MOONLIGHT)
:: ==========================
:client
echo.
echo [*] MODO CLIENTE SELECCIONADO.
echo [*] Escaneando dependencias (Tailscale y Moonlight)...
call :instalar_tailscale

:: Validar si Moonlight existe
set "moonlight_path=C:\Program Files\Moonlight Game Streaming\Moonlight.exe"
if not exist "%moonlight_path%" (
    echo [!] Moonlight NO instalado. Descargando silenciosamente...
    winget install --id MoonlightGameStreamingProject.Moonlight -e --force --silent --accept-package-agreements --accept-source-agreements
    echo [*] Esperando 5 segundos a que Windows reconozca el programa...
    timeout /t 5 /nobreak >nul
)

echo [*] Levantando tunel VPN conectando al Host...
tailscale up

echo [*] Iniciando Interfaz Moonlight...
if exist "%moonlight_path%" (
    start "" "%moonlight_path%"
) else (
    echo [X] Error iniciando Moonlight. Abrelo manualmente desde el menu inicio.
)

echo.
echo [V] CLIENTE LISTO.
echo Recuerda agregar a Moonlight la IP que te mostro tu PC Host.
pause
exit

:end
echo [X] Opcion no valida.
exit /b 1

:cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0
