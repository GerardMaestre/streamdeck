# DESC: Escanea tu red Wi-Fi/Local con un barrido militar para mostrar todos los dispositivos (móviles, TVs) conectados.
# ARGS: Ninguno
# RISK: medium
# PERM: user
# MODE: internal

import os
import sys
import time
import subprocess
import ipaddress
from concurrent.futures import ThreadPoolExecutor

try:
    if sys.stdout is None or getattr(sys.stdout, 'name', '').upper() == 'NUL':
        sys.stdout = open('CONOUT$', 'w', encoding='utf-8')
        sys.stderr = open('CONOUT$', 'w', encoding='utf-8')
        sys.stdin = open('CONIN$', 'r', encoding='utf-8')
except Exception:
    pass

# Forzar codificación UTF-8 y escritura en tiempo real para la consola de HORUS
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    except Exception:
        pass


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
print("[*] Iniciando barrido de radar en la subred local...")

base_ip = detect_local_network()
if not base_ip:
    print("[X] Error: No se pudo detectar la red. ¿Estás conectado al Wi-Fi?")
    sys.exit()

if not _is_valid_base_ip(base_ip):
    print(f"[X] Error: IP base inválida detectada ({base_ip}).")
    sys.exit()

max_workers = int(os.getenv("HORUS_MAX_WORKERS", "32"))
timeout_ms = int(os.getenv("HORUS_PING_TIMEOUT_MS", "200"))

print(f"[*] Base de red detectada: {base_ip}X")
print(f"[*] Configuración: timeout={timeout_ms}ms, max_workers={max_workers}")
print("[*] Lanzando 254 sondas de reconocimiento simultáneas. Por favor espera...", flush=True)

start = time.perf_counter()
hosts_scanned, ping_responses = sweep_subnet(base_ip, timeout_ms, max_workers)
duration_sec = time.perf_counter() - start

print("[*] Analizando respuestas de la tabla ARP...\n")
print(f"{'DIRECCIÓN IP':<18} | {'DIRECCIÓN MAC (HUELLA)':<20} | TIPO")
print("-" * 65)

try:
    dispositivos = parse_arp_table(base_ip)
    for ip_encontrada, mac_encontrada in dispositivos:
        print(f" [>] {ip_encontrada:<14} | {mac_encontrada:<20} | Dispositivo Detectado", flush=True)
except Exception as e:
    dispositivos = []
    print(f"[X] Error leyendo la tabla ARP: {e}")

print("\n" + "=" * 65)
print(f"[OK] BARRIDO COMPLETADO. Se encontraron {len(dispositivos)} dispositivos en tu red.")
print("[I] Resumen de métricas:")
print(f"    - Hosts sondeados: {hosts_scanned}")
print(f"    - Respuestas a ping: {ping_responses}")
print(f"    - Dispositivos ARP detectados: {len(dispositivos)}")
print(f"    - Duración total: {duration_sec:.2f} segundos")
print("[I] Si ves más dispositivos de los que tienes en tu casa, alguien está robando tu Wi-Fi.")
