# DESC: Levanta un servidor web temporal en tu PC y genera un código QR para compartir archivos por Wi-Fi.
# ARGS: <Ruta_Carpeta>
# RISK: medium
# PERM: user
# MODE: external
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
import sys
from pathlib import Path

if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.console_io import configure_console_utf8

# Compatibilidad con lanzadores/hosts que dejan la consola en NUL o sin UTF-8.
configure_console_utf8(line_buffering=True)

import socket
import threading
import http.server
import socketserver
import functools
import time

try:
    import qrcode
except ImportError:
    print("[*] Instalando motor de Códigos QR...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "qrcode[pil]", "colorama", "--quiet"])
    import qrcode

print("="*65)
print("      ⚡ HORUS ENGINE - SERVIDOR EFÍMERO CON QR ⚡      ")
print("="*65)

args = [arg for arg in sys.argv[1:] if arg.strip()]
puerto = 8080
path_parts = []

i = 0
while i < len(args):
    token = args[i]
    if token in ("--port", "-p") and i + 1 < len(args):
        try:
            puerto = int(args[i + 1])
        except ValueError:
            print(f"[X] Puerto inválido: {args[i + 1]}")
            sys.exit(1)
        i += 2
        continue
    path_parts.append(token)
    i += 1

if not path_parts:
    print("[ERROR] Faltan parámetros.")
    print("En 'Flags / Args' debes poner la ruta de la carpeta que quieres compartir.")
    print("Ejemplo: \"C:\\Users\\gerar\\Desktop\\Peliculas\" --port 8080")
    sys.exit()

if puerto < 1 or puerto > 65535:
    print(f"[X] Puerto fuera de rango: {puerto}. Usa un valor entre 1 y 65535.")
    sys.exit(1)

carpeta_objetivo = " ".join(path_parts).strip('"')

if not os.path.exists(carpeta_objetivo):
    print(f"[X] No se encontró la carpeta: {carpeta_objetivo}")
    sys.exit()

def obtener_ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No importa si la IP de destino es inalcanzable, esto saca la IP de tu tarjeta de red local
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

ip_local = obtener_ip_local()
url_descarga = f"http://{ip_local}:{puerto}"

print(f"[*] Preparando túnel de transferencia en: {carpeta_objetivo}")
print(f"[*] Generando Código QR para acceso rápido...\n")

# Generar QR en formato ASCII para la consola
qr = qrcode.QRCode(version=1, box_size=1, border=2)
qr.add_data(url_descarga)
qr.make(fit=True)
qr.print_ascii(invert=True)

print("\n" + "-"*65)
print(f"[OK] SERVIDOR ACTIVO EN: {url_descarga}")
print("[I] Pide a tus amigos que escaneen el QR con su móvil estando en tu Wi-Fi.")
print("[I] Para apagar el servidor, simplemente pulsa el botón 'Parar' en el HORUS.")
print("-" * 65)

# Iniciar el servidor web de forma silenciosa
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=carpeta_objetivo)
try:
    with socketserver.TCPServer(("", puerto), Handler) as httpd:
        httpd.serve_forever()
except OSError:
    print(f"[X] El puerto {puerto} ya está en uso. Cierra servidores previos o usa --port.")
except KeyboardInterrupt:
    pass
