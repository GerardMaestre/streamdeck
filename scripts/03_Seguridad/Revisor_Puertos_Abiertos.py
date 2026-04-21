# DESC: Escaner de vulnerabilidades local. Revisa puertos peligrosos y su exposicion real (solo local o red).
# ARGS: Ninguno
# RISK: medium
# PERM: user
# MODE: internal

import concurrent.futures
import ipaddress
import json
import re
import socket
import subprocess
import sys
from collections import defaultdict


def ensure_console_streams():
    """Repara stdio cuando se ejecuta desde lanzadores sin consola visible."""
    try:
        if sys.stdout is None or getattr(sys.stdout, 'name', '').upper() == 'NUL':
            sys.stdout = open('CONOUT$', 'w', encoding='utf-8')
            sys.stderr = open('CONOUT$', 'w', encoding='utf-8')
            sys.stdin = open('CONIN$', 'r', encoding='utf-8')
    except Exception:
        pass

    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass


ensure_console_streams()

print('=' * 70)
print('     HORUS ENGINE - AUDITOR DE VULNERABILIDADES DE PUERTOS')
print('=' * 70)
print('[*] Escaneando puertos criticos y verificando exposicion real...\n')

# Puertos comunmente explotados o sensibles.
PUERTOS_PELIGROSOS = {
    21: 'FTP (Transferencia de archivos)',
    22: 'SSH (Acceso remoto)',
    23: 'Telnet (Inseguro)',
    25: 'SMTP (Envio de correos)',
    53: 'DNS (Resolucion de nombres)',
    80: 'HTTP (Servidor Web)',
    110: 'POP3 (Recepcion de correos)',
    135: 'RPC (Ataques Blaster/Sasser)',
    139: 'NetBIOS (Sesiones Windows)',
    443: 'HTTPS (Servidor Web Seguro)',
    445: 'SMB (Compartir archivos - Riesgo Ransomware)',
    1433: 'MSSQL (Base de datos Microsoft)',
    3306: 'MySQL (Base de datos)',
    3389: 'RDP (Escritorio Remoto de Windows)',
    5900: 'VNC (Control remoto)',
    8080: 'HTTP Alternativo'
}

HIGH_RISK_PUBLIC_PORTS = {21, 22, 23, 139, 445, 1433, 3306, 3389, 5900}


def parse_local_endpoint(local_address):
    text = str(local_address or '').strip()
    if not text:
        return '', None

    if text.startswith('['):
        match = re.match(r'^\[([^\]]+)\]:(\d+)$', text)
        if match:
            return match.group(1), int(match.group(2))

    if ':' not in text:
        return text, None

    host, raw_port = text.rsplit(':', 1)
    try:
        return host, int(raw_port)
    except ValueError:
        return host, None


def normalize_ip(raw_ip):
    ip = str(raw_ip or '').strip().strip('[]').lower()
    if ip == 'localhost':
        return '127.0.0.1'
    return ip


def get_tcp_listeners():
    """Extrae sockets TCP en escucha con netstat para clasificar exposicion."""
    listeners = defaultdict(list)
    output = ''

    commands = [
        ['netstat', '-ano', '-p', 'tcp'],
        ['netstat', '-ano']
    ]

    for command in commands:
        try:
            output = subprocess.check_output(
                command,
                text=True,
                encoding='utf-8',
                errors='ignore'
            )
            if output:
                break
        except Exception:
            continue

    if not output:
        return listeners

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or not line.upper().startswith('TCP'):
            continue

        parts = re.split(r'\s+', line)
        if len(parts) < 5:
            continue

        state = parts[3].upper()
        if state not in {'LISTENING', 'ESCUCHANDO'}:
            continue

        local_ip, port = parse_local_endpoint(parts[1])
        if port is None:
            continue

        listeners[port].append({
            'ip': normalize_ip(local_ip),
            'pid': parts[4]
        })

    return listeners


def classify_scope(bindings):
    ips = sorted({normalize_ip(item.get('ip')) for item in bindings if item.get('ip')})
    if not ips:
        return 'LOCAL', ['127.0.0.1']

    has_non_loopback = False
    for ip in ips:
        try:
            if not ipaddress.ip_address(ip).is_loopback:
                has_non_loopback = True
                break
        except ValueError:
            if ip not in {'127.0.0.1', '::1'}:
                has_non_loopback = True
                break

    scope = 'PUBLIC' if has_non_loopback else 'LOCAL'
    return scope, ips


def classify_risk(port, scope):
    if scope != 'PUBLIC':
        return 'LOW'
    if port in HIGH_RISK_PUBLIC_PORTS:
        return 'HIGH'
    return 'MEDIUM'


def quick_local_probe(port):
    """Fallback por si netstat no reporta un listener puntual."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.4)
        result = sock.connect_ex(('127.0.0.1', port))
        sock.close()
        return result == 0
    except Exception:
        return False


listeners_by_port = get_tcp_listeners()
findings = []

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    probes = {
        port: executor.submit(quick_local_probe, port)
        for port in PUERTOS_PELIGROSOS.keys()
    }

    for port, service in PUERTOS_PELIGROSOS.items():
        bindings = listeners_by_port.get(port, [])
        local_open = probes[port].result()

        if not bindings and not local_open:
            continue

        scope, bind_ips = classify_scope(bindings)
        if not bindings and local_open:
            bind_ips = ['127.0.0.1']
            scope = 'LOCAL'

        risk = classify_risk(port, scope)

        finding = {
            'port': port,
            'service': service,
            'scope': scope,
            'risk': risk,
            'binds': bind_ips
        }
        findings.append(finding)

        bind_text = ', '.join(bind_ips)
        if scope == 'PUBLIC':
            print(f" [!] ALERTA ROJA: Puerto {port} ({service}) expuesto en red [{bind_text}] | Riesgo {risk}")
        else:
            print(f" [i] Puerto {port} ({service}) abierto solo en local [{bind_text}] | Riesgo {risk}")

        # Marcador estructurado para UI (parser del dashboard)
        print('[PORT_RESULT]' + json.dumps(finding, ensure_ascii=False))


findings.sort(key=lambda item: item['port'])
total_open = len(findings)
public_findings = [item for item in findings if item['scope'] == 'PUBLIC']
local_findings = [item for item in findings if item['scope'] == 'LOCAL']
high_risk_count = sum(1 for item in findings if item['risk'] == 'HIGH')

print('\n' + '-' * 70)

if total_open == 0:
    print('[OK] Excelente. No se detectaron puertos peligrosos abiertos.')
else:
    all_ports = ', '.join(str(item['port']) for item in findings)
    print(f"[*] Puertos detectados al finalizar: {all_ports}")

    if local_findings:
        only_local_ports = ', '.join(str(item['port']) for item in local_findings)
        print(f"[i] Solo en localhost/local: {only_local_ports}")

    if public_findings:
        public_ports = ', '.join(str(item['port']) for item in public_findings)
        print(f"[X] Expuestos a red (LAN/publica segun firewall/NAT): {public_ports}")
        print('[X] Estos puertos pueden ser un problema real y deben revisarse en firewall o servicios.')
    else:
        print('[OK] Los puertos detectados estan solo en local, riesgo externo bajo.')

summary = {
    'open_count': total_open,
    'public_count': len(public_findings),
    'local_count': len(local_findings),
    'high_count': high_risk_count,
    'ports': [item['port'] for item in findings]
}

# Marcador estructurado final para UI.
print('[PORT_SUMMARY]' + json.dumps(summary, ensure_ascii=False))
