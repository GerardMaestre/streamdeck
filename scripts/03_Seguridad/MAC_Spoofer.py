# DESC: Falsifica la dirección MAC de tu adaptador de red para evitar baneos o límites de tiempo en redes Wi-Fi públicas.
# ARGS: Ninguno (Solicitará permisos de Administrador automáticamente)
# RISK: high
# PERM: admin
# MODE: external
# Requisitos:
# - Python 3.10+
# - Permisos de administrador.
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

    if True:
        try:
            import ctypes
            is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            is_admin = False
        if not is_admin:
            print("[X] Se requieren privilegios de Administrador para ejecutar este script.", file=sys.stderr)
            sys.exit(3)


import os
import subprocess
import random
import ctypes
import sys
from pathlib import Path

if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.console_io import configure_console_utf8

# Compatibilidad con lanzadores/hosts que dejan la consola en NUL o sin UTF-8.
configure_console_utf8(line_buffering=True)

import re

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

import atexit, tempfile, time
def _horus_cleanup():
    if "HORUS_LOG_FILE" in os.environ:
        try: open(os.environ["HORUS_LOG_FILE"] + ".done", "w").close()
        except: pass
atexit.register(_horus_cleanup)

if "--horus-log" in sys.argv:
    idx = sys.argv.index("--horus-log")
    log_file = sys.argv[idx + 1]
    
    class Tee:
        def __init__(self, name, stream):
            self.file = open(name, 'w', encoding='utf-8')
            self.stream = stream
        def write(self, data):
            self.file.write(data)
            self.file.flush()
            try:
                self.stream.write(data)
                self.stream.flush()
            except Exception:
                pass
        def flush(self):
            self.file.flush()
            try:
                self.stream.flush()
            except Exception:
                pass
        def isatty(self):
            return hasattr(self.stream, 'isatty') and self.stream.isatty()
            
    sys.stdout = Tee(log_file, sys.stdout)
    sys.stderr = sys.stdout
    del sys.argv[idx:idx+2]
    os.environ["HORUS_LOG_FILE"] = log_file
elif not ctypes.windll.shell32.IsUserAnAdmin():
    print("[!] Solicitando permisos de Administrador para Spoofing (Acepta el escudo amarillo abajo)...", flush=True)
    log_file = os.path.join(tempfile.gettempdir(), f"horus_admin_{os.getpid()}.log")
    open(log_file, "w").close()
    params = f'"{os.path.abspath(__file__)}" ' + " ".join(f'"{a}"' for a in sys.argv[1:]) + f' --horus-log "{log_file}"'
    sw_mode = 1 if sys.stdout and sys.stdout.isatty() else 0
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, sw_mode) <= 32:
        print("[X] Elevación UAC rechazada.", flush=True); sys.exit(1)
    
    print("[*] Privilegios obtenidos. Ejecutando falsificación de red en modo oculto...", flush=True)
    done_file = log_file + ".done"
    with open(log_file, "r", encoding="utf-8", errors="replace") as f:
        while True:
            line = f.readline()
            if not line:
                if os.path.exists(done_file):
                    res = f.read()
                    if res: print(res, end="", flush=True)
                    break
                time.sleep(0.1)
                continue
            print(line, end="", flush=True)
    try: os.remove(log_file); os.remove(done_file)
    except: pass
    sys.exit(0)

print("="*65)
print("        ⚡ HORUS ENGINE - PROTOCOLO FANTASMA ⚡       ")
print("="*65)

def generar_mac_valida():
    # El segundo caracter de una MAC falsificada en Windows DEBE ser 2, 6, A, o E
    caracteres_validos = "26AE"
    hex_chars = "0123456789ABCDEF"
    mac = [random.choice(hex_chars) + random.choice(caracteres_validos)]
    for _ in range(5):
        mac.append(random.choice(hex_chars) + random.choice(hex_chars))
    return "-".join(mac)

nueva_mac = generar_mac_valida()
print(f"[*] Identidad de red falsa generada: {nueva_mac}")
print(f"[*] Buscando adaptador de red activo...")

try:
    # Usar PowerShell para cambiar la MAC de la forma más estable
    ps_cmd = f"""
    $adapter = Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1
    if ($adapter) {{
        Write-Host " [>] Engañando al adaptador: $($adapter.Name)"
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -RegistryKeyword "NetworkAddress" -RegistryValue "{nueva_mac.replace('-', '')}"
        Write-Host " [*] Reiniciando adaptador para aplicar el camuflaje..."
        Restart-NetAdapter -Name $adapter.Name
        Write-Host " [OK] Exito"
    }} else {{
        Write-Host " [X] Fallo"
    }}
    """
    resultado = subprocess.check_output(["powershell", "-Command", ps_cmd]).decode('utf-8', errors='replace')
    print(resultado)
except Exception as e:
    print(f"[X] Fallo crítico: {e}")
