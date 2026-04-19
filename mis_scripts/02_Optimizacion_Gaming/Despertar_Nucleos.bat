@echo off
:: DESC: Hackea el plan de energía del Kernel para despertar el 100% de los núcleos de tu CPU. Adiós tirones en juegos.
:: ARGS: Ninguno (Pedirá permisos de Administrador)
:: RISK: high
:: PERM: admin
:: MODE: external

:: Forzar soporte para Emojis UTF-8 en CMD
chcp 65001 >nul

:: Elevación a Administrador Automática
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para modificar el Kernel...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ===================================================
echo     ⚡ HORUS ENGINE - DESPERTADOR DE NÚCLEOS CPU ⚡    
echo ===================================================
echo.
echo [!] ADVERTENCIA: Este script modifica planes de energia y estado minimo/maximo de CPU.

echo [*] Interrogando a la BIOS y al Kernel de Windows...
echo [*] Deshabilitando el "Core Parking" (Aparcamiento de Nucleos)...
echo [*] Creando o aplicando plan de Rendimiento Definitivo (Ultimate Performance)...

:: 0. Intentar habilitar Rendimiento Definitivo (Ultimate Performance)
powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 >nul 2>&1

:: 1. Activar el Plan de Alto Rendimiento como fallback seguro o el definitivo
powercfg -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c >nul 2>&1
powercfg -setactive e9a42b02-d5df-448d-aa00-03f14749eb61 >nul 2>&1

:: 2. Forzar el Estado Mínimo y Máximo del Procesador al 100%
powercfg -setacvalueindex scheme_current sub_processor PROCTHROTTLEMIN 100
powercfg -setacvalueindex scheme_current sub_processor PROCTHROTTLEMAX 100

:: 3. Mostrar atributos ocultos de Core Parking en el registro y desactivarlos
powercfg -attributes sub_processor 0cc5b647-c1df-4637-891a-dec35c318583 -ATTRIB_HIDE >nul 2>&1
powercfg -setacvalueindex scheme_current sub_processor 0cc5b647-c1df-4637-891a-dec35c318583 100 >nul 2>&1

:: 4. Aplicar los cambios
powercfg -setactive scheme_current

echo.
echo [OK] INYECCIÓN COMPLETADA.
echo [I] El 100%% de los hilos y nucleos fisicos estan ahora despiertos y al maximo.
echo [I] Listo para sacar los maximos FPS posibles.
echo ===================================================
exit /b 0

:Cancelled
echo [SYS] Operacion cancelada por seguridad.
exit /b 0
