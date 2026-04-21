@echo off
chcp 65001 >nul
:: DESC: Activa Windows 11 (Home o Pro) conectándose a un servidor KMS de forma segura.
:: ARGS: 1 W11 Home | 2 W11 Pro | 3 Salir
:: RISK: high
:: PERM: admin
:: MODE: external

echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para interactuar con KMS...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

color 0a

:: Interpretar Parámetros Silenciosos (Desde Dashboard)
if "%~1"=="1" set "choice=1" & goto confirm
if /I "%~1"=="home" set "choice=1" & goto confirm
if "%~1"=="2" set "choice=2" & goto confirm
if /I "%~1"=="pro" set "choice=2" & goto confirm
if "%~1"=="3" exit

echo ===================================================
echo         ACTIVADOR UNIVERSAL - WINDOWS 11         
echo ===================================================
echo.
echo Selecciona la edicion de Windows que tienes instalada:
echo.
echo [1] Windows 11 Home
echo [2] Windows 11 Pro
echo [3] Salir
echo.

set /p choice="Ingresa un numero (1-3): "

if "%choice%"=="1" goto confirm
if "%choice%"=="2" goto confirm
if "%choice%"=="3" exit
echo [X] Opcion no valida. Intenta de nuevo.
goto end

:confirm
if "%choice%"=="1" goto home
if "%choice%"=="2" goto pro
goto end


:home
echo [*] Aplicando clave de Windows 11 Home...
slmgr.vbs -upk
slmgr /ipk 7HNRX-D7KGG-3K4RQ-4WPJ4-YTDFH
goto activate

:pro
echo [*] Aplicando clave de Windows 11 Pro...
slmgr.vbs -upk
slmgr /ipk NRG8B-VKK3Q-CXVCJ-9G2XF-6Q84J
goto activate

:activate
echo [*] Conectando al servidor KMS...
slmgr /skms kms.digiboy.ir
echo [*] Forzando activacion...
slmgr /ato
echo.
echo [OK] Windows ha sido activado.
pause
exit

:cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0

:end
echo [X] Opcion no valida.
pause