# DESC: Escanea tu red Wi-Fi/Local con un barrido militar para mostrar todos los dispositivos (móviles, TVs) conectados.
# ARGS: Ninguno
# RISK: medium
# PERM: user
# MODE: internal
# Requisitos:
# - Python 3.10+
# - Permisos de usuario.
# - Comandos externos requeridos: arp, ping.
# Compatibilidad:
# - Windows 10/11.

import platform
import shutil as _shutil_runtime

def validate_runtime():
    if platform.system() != "Windows":
        print("[X] Este script solo es compatible con Windows 10/11.", file=sys.stderr)
        sys.exit(1)

    required_commands = ['arp', 'ping']
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
from scripts.common.console_ui import error, info, step, success, table_header, table_row

# Compatibilidad con lanzadores/hosts que dejan la consola en NUL o sin UTF-8.
configure_console_utf8(line_buffering=True)

import time
import subprocess
import ipaddress
from concurrent.futures import ThreadPoolExecutor


def detect_local_network():
    """Detecta la red local y devuelve base_ip (ej: 192.168.1.)."""
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip_local = sock.getsockname()[0]
        sock.close()
    except Exception:
        return ""

    try:
        ip_obj = ipaddress.ip_address(ip_local)
        if ip_obj.version != 4:
            return ""
    except ValueError:
        return ""

    return ".".join(ip_local.split('.')[:-1]) + "."


def _is_valid_base_ip(base_ip):
    """Valida prefijo de red IPv4 en formato X.X.X."""
    parts = base_ip.split('.')
    if len(parts) != 4 or parts[-1] != '':
        return False
    try:
        octets = [int(part) for part in parts[:-1]]
    except ValueError:
        return False
    return all(0 <= octet <= 255 for octet in octets)


def _ping_host(ip, timeout_ms):
    """Hace ping con timeout explícito y devuelve True si responde."""
    cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip]
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return result.returncode == 0


def sweep_subnet(base_ip, timeout_ms, max_workers):
    """Sondea toda la subred /24 usando ThreadPoolExecutor."""
    if not _is_valid_base_ip(base_ip):
        raise ValueError(f"IP base inválida: {base_ip}")

    ips = [f"{base_ip}{i}" for i in range(1, 255)]
    responses = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for ok in executor.map(lambda ip: _ping_host(ip, timeout_ms), ips):
            if ok:
                responses += 1

    return len(ips), responses


def parse_arp_table(base_ip):
    """Parsea la tabla ARP y devuelve lista de (ip, mac) dinámicas."""
    if not _is_valid_base_ip(base_ip):
        raise ValueError(f"IP base inválida: {base_ip}")

    dispositivos = []
    salida_arp = subprocess.check_output("arp -a", shell=True).decode(
        sys.stdout.encoding or 'cp850',
        errors='replace',
    )
    for linea in salida_arp.splitlines():
        if base_ip in linea and ("din" in linea.lower() or "dyn" in linea.lower()):
            partes = linea.split()
            if len(partes) >= 2:
                ip_encontrada = partes[0]
                mac_encontrada = partes[1].upper()
                if not ip_encontrada.endswith(".255"):
                    dispositivos.append((ip_encontrada, mac_encontrada))
    return dispositivos


print("=" * 65)
print("      ⚡ HORUS ENGINE - CAZADOR DE INTRUSOS (RADAR) ⚡      ")
print("=" * 65)
step("Iniciando barrido de radar en la subred local...")

base_ip = detect_local_network()
if not base_ip:
    error("No se pudo detectar la red. ¿Estás conectado al Wi-Fi?")
    sys.exit()

if not _is_valid_base_ip(base_ip):
    error(f"IP base inválida detectada ({base_ip}).")
    sys.exit()

max_workers = int(os.getenv("HORUS_MAX_WORKERS", "32"))
timeout_ms = int(os.getenv("HORUS_PING_TIMEOUT_MS", "200"))

info("Base de red detectada", f"{base_ip}X")
info("Configuración", f"timeout={timeout_ms}ms, max_workers={max_workers}")
step("Lanzando 254 sondas de reconocimiento simultáneas. Por favor espera...", flush=True)

start = time.perf_counter()
hosts_scanned, ping_responses = sweep_subnet(base_ip, timeout_ms, max_workers)
duration_sec = time.perf_counter() - start

step("Analizando respuestas de la tabla ARP...")
print()
cols = [('DIRECCIÓN IP', 18), ('DIRECCIÓN MAC (HUELLA)', 20), ('TIPO', 24)]
header, separator = table_header(cols)
print(header)
print(separator)

dispositivos_detectados = []
try:
    dispositivos_detectados = parse_arp_table(base_ip)
    for ip_encontrada, mac_encontrada in dispositivos_detectados:
        print(table_row([ip_encontrada, mac_encontrada, 'Dispositivo Detectado'], [18, 20, 24]), flush=True)
except Exception as e:
    error("Error leyendo la tabla ARP", str(e))

print("\n" + "=" * 65)
success("BARRIDO COMPLETADO", f"Se encontraron {len(dispositivos_detectados)} dispositivos en tu red.")
info("Resumen de métricas:")
print(f"    - Hosts sondeados: {hosts_scanned}")
print(f"    - Respuestas a ping: {ping_responses}")
print(f"    - Dispositivos ARP detectados: {len(dispositivos_detectados)}")
print(f"    - Duración total: {duration_sec:.2f} segundos")
info("Si ves más dispositivos de los que tienes en tu casa, alguien está robando tu Wi-Fi.")
