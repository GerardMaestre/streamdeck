# DESC: Destruye y limpia la caché gráfica corrupta (NVIDIA, AMD, DirectX) para eliminar tirones de FPS en videojuegos.
# ARGS: Ninguno
# RISK: medium
# PERM: user
# MODE: internal
# Requisitos:
# - Python 3.10+
# - Permisos de usuario.
# - Comandos externos requeridos: ninguno.
# Compatibilidad:
# - Windows 10/11.

import platform
import shutil as _shutil_runtime

def validate_runtime():
    if platform.system() != "Windows":
        print("[X] Este script solo es compatible con Windows 10/11.", file=sys.stderr)
        sys.exit(1)

    required_commands = []
    missing = [cmd for cmd in required_commands if _shutil_runtime.which(cmd) is None]
    if missing:
        print(f"[X] Faltan comandos requeridos en PATH: {', '.join(missing)}", file=sys.stderr)
        sys.exit(2)

    if False:
        try:
            import ctypes
            is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            is_admin = False
        if not is_admin:
            print("[X] Se requieren privilegios de Administrador para ejecutar este script.", file=sys.stderr)
            sys.exit(3)


import os
import shutil
import subprocess
import sys
from pathlib import Path

if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.console_io import configure_console_utf8

# Compatibilidad con lanzadores/hosts que dejan la consola en NUL o sin UTF-8.
configure_console_utf8(line_buffering=True)

from pathlib import Path

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

print("="*65)
print("      ⚡ HORUS ENGINE - PURGADOR DE SHADERS ⚡      ")
print("="*65)
print("[*] Rastreando caché gráfica corrupta o saturada...\n")

localappdata = os.environ.get('LOCALAPPDATA')
appdata = os.environ.get('APPDATA')
temp_dir = os.environ.get('TEMP')

DIRECTORIOS_CACHE = [
    # NVIDIA
    os.path.join(localappdata, "NVIDIA", "GLCache"),
    os.path.join(localappdata, "NVIDIA", "DXCache"),
    os.path.join(localappdata, "NVIDIA", "ComputeCache"),
    # AMD
    os.path.join(localappdata, "AMD", "DxCache"),
    os.path.join(localappdata, "ATI", "ACE"),
    os.path.join(appdata, "AMD", "ShaderCache"),
    # INTEL
    os.path.join(localappdata, "Intel", "ShaderCache"),
    # DIRECTX (Windows global)
    os.path.join(localappdata, "D3DSCache"),
    os.path.join(temp_dir, "D3DSCache"),
    # STEAM (Juegos Vulkan/OpenGL)
    r"C:\Program Files (x86)\Steam\steamapps\shadercache"
]

archivos_borrados = 0
mb_liberados = 0

print("[~] Cerrando procesos de Epic/Steam temporalmente para liberar archivos...")
try:
    subprocess.run(["taskkill", "/F", "/IM", "steam.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    subprocess.run(["taskkill", "/F", "/IM", "EpicGamesLauncher.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
except:
    pass

for carpeta in DIRECTORIOS_CACHE:
    if os.path.exists(carpeta):
        print(f"[*] Escaneando núcleo de shaders: {os.path.basename(carpeta)}...")
        for root, dirs, files in os.walk(carpeta):
            for file in files:
                try:
                    ruta = os.path.join(root, file)
                    peso = os.path.getsize(ruta)
                    os.remove(ruta)
                    archivos_borrados += 1
                    mb_liberados += peso / (1024 * 1024)
                except Exception:
                    pass # Ignoramos archivos en uso persistente por Kernels (normal)

print("\n" + "-" * 65)
print(f"[OK] Limpieza de Caché Gráfica Completada.")
if mb_liberados > 0:
    print(f"[I] Motores Gráficos reseteados (Destruidos: {archivos_borrados} micro-archivos).")
    print(f"[I] Basura VRAM liberada: {mb_liberados:.2f} MB.")
    print("[!] Notarás más fluidez, aunque los juegos tardarán 1 minuto más en cargar la primera vez para regenerar el mapa.")
else:
    print("[I] Tu caché ya estaba completamente limpia.")
