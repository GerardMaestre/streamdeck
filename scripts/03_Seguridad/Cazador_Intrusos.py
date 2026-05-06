# DESC: Escanea tu red Wi-Fi/Local con un barrido militar para mostrar todos los dispositivos (móviles, TVs) conectados.
# ARGS: Ninguno
# RISK: medium
# PERM: user
# MODE: internal

import os
import sys
import sys
try:
    if sys.stdout is None or getattr(sys.stdout, 'name', '').upper() == 'NUL':
        sys.stdout = open('CONOUT$', 'w', encoding='utf-8')
        sys.stderr = open('CONOUT$', 'w', encoding='utf-8')
        sys.stdin = open('CONIN$', 'r', encoding='utf-8')
except Exception: pass

if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8')
    except Exception: pass
import subprocess
import re
import threading
from queue import Queue

from scripts.common.console_ui import error, info, step, success, table_header, table_row

# Forzar codificación UTF-8 y escritura en tiempo real para la consola de HORUS
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

print("="*65)
print("      ⚡ HORUS ENGINE - CAZADOR DE INTRUSOS (RADAR) ⚡      ")
print("="*65)
step("Iniciando barrido de radar en la subred local...")

# 1. Obtener la IP local para saber en qué red estamos
ip_local = ""
try:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    ip_local = s.getsockname()[0]
    s.close()
except Exception:
    pass

if not ip_local:
    error("No se pudo detectar la red. ¿Estás conectado al Wi-Fi?")
    sys.exit()

# Extraer los 3 primeros octetos (ej: 192.168.1.X)
base_ip = ".".join(ip_local.split('.')[:-1]) + "."
info("Base de red detectada", f"{base_ip}X")
step("Lanzando 254 sondas de reconocimiento simultáneas. Por favor espera...")

def ping_sweeper(ip):
    # Enviar un ping ultrarrápido a una IP para que responda y se guarde en la tabla ARP
    subprocess.call(f"ping -n 1 -w 200 {ip}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# 2. Multithreading para hacer el escaneo en 2 segundos en lugar de 5 minutos
hilos = []
for i in range(1, 255):
    ip_objetivo = f"{base_ip}{i}"
    hilo = threading.Thread(target=ping_sweeper, args=(ip_objetivo,))
    hilos.append(hilo)
    hilo.start()

# Esperar a que terminen todas las sondas
for hilo in hilos:
    hilo.join()

step("Analizando respuestas de la tabla ARP...")
print()
cols=[('DIRECCIÓN IP', 18), ('DIRECCIÓN MAC (HUELLA)', 20), ('TIPO', 24)]
header, separator = table_header(cols)
print(header)
print(separator)

# 3. Leer la tabla ARP de Windows para ver quién ha respondido
dispositivos = 0
try:
    salida_arp = subprocess.check_output("arp -a", shell=True).decode(sys.stdout.encoding or 'cp850', errors='replace')
    for linea in salida_arp.split('\n'):
        if base_ip in linea and ("din" in linea.lower() or "dyn" in linea.lower()):
            partes = linea.split()
            if len(partes) >= 2:
                ip_encontrada = partes[0]
                mac_encontrada = partes[1].upper()
                
                # Excluir la IP de broadcast (.255)
                if not ip_encontrada.endswith(".255"):
                    print(table_row([ip_encontrada, mac_encontrada, 'Dispositivo Detectado'], [18, 20, 24]), flush=True)
                    dispositivos += 1
except Exception as e:
    error("Error leyendo la tabla ARP", str(e))

print("\n" + "=" * 65)
success("BARRIDO COMPLETADO", f"Se encontraron {dispositivos} dispositivos en tu red.")
info("Si ves más dispositivos de los que tienes en tu casa, alguien está robando tu Wi-Fi.")
