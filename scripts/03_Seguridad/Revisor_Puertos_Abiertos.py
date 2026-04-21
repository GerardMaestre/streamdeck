# DESC: Escáner de vulnerabilidades local. Revisa si tienes puertos peligrosos expuestos a la red (FTP, SSH, RDP).
# ARGS: Ninguno
# RISK: medium
# PERM: user
# MODE: internal

import socket
import concurrent.futures
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

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

print("="*65)
print("     ⚡ HORUS ENGINE - AUDITOR DE VULNERABILIDADES ⚡    ")
print("="*65)
print("[*] Escaneando tu propio sistema en busca de puertas traseras...\n")

# Puertos más comunes atacados por malware o mal configurados
PUERTOS_PELIGROSOS = {
    21: "FTP (Transferencia de archivos)",
    22: "SSH (Acceso remoto)",
    23: "Telnet (Inseguro)",
    25: "SMTP (Envío de correos)",
    53: "DNS (Resolución de nombres)",
    80: "HTTP (Servidor Web)",
    110: "POP3 (Recepción de correos)",
    135: "RPC (Ataques Blaster/Sasser)",
    139: "NetBIOS (Sesiones Windows)",
    443: "HTTPS (Servidor Web Seguro)",
    445: "SMB (Compartir archivos - Peligro Ransomware)",
    1433: "MSSQL (Base de datos Microsoft)",
    3306: "MySQL (Base de datos)",
    3389: "RDP (Escritorio Remoto de Windows)",
    5900: "VNC (Control Remoto)",
    8080: "HTTP Alternativo"
}

abiertos = []

def escanear_puerto(puerto, descripcion):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.0)
        resultado = s.connect_ex(("127.0.0.1", puerto))
        s.close()
        if resultado == 0:
            return puerto, descripcion
    except Exception:
        pass
    return None

# Utilizar Threading seguro
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    futuros = [executor.submit(escanear_puerto, port, desc) for port, desc in PUERTOS_PELIGROSOS.items()]
    for futuro in concurrent.futures.as_completed(futuros):
        res = futuro.result()
        if res:
            p, d = res
            print(f" [!] ALERTA ROJA: El puerto {p} ({d}) está ABIERTO.")
            abiertos.append(p)

print("\n" + "-"*65)
if len(abiertos) == 0:
    print("[OK] Excelente. Tu sistema parece estar blindado localmente.")
else:
    print(f"[X] CUIDADO: Se encontraron {len(abiertos)} puertos abiertos. Revisa tu Firewall o cierra aplicaciones de fondo.")
