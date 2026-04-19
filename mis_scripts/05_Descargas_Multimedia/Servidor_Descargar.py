# DESC: Levanta un servidor web temporal en tu PC y genera un código QR para compartir archivos por Wi-Fi.
# ARGS: <Ruta_Carpeta>
# RISK: medium
# PERM: user
# MODE: external

import os
import sys
try:
    if sys.stdout is None or getattr(sys.stdout, 'name', '').upper() == 'NUL':
        sys.stdout = open('CONOUT$', 'w', encoding='utf-8')
        sys.stderr = open('CONOUT$', 'w', encoding='utf-8')
        sys.stdin = open('CONIN$', 'r', encoding='utf-8')
except Exception: pass

if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    except Exception: pass
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
