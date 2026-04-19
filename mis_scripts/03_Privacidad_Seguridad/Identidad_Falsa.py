# DESC: Genera un perfil de prueba y buzón temporal para entornos de testing.
# ARGS: Ninguno
# RISK: high
# PERM: user
# MODE: external

import urllib.request
import json
import string
import secrets
import random
import time
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
import os

# Forzar codificación correcta en terminales
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

# ===== CONSTANTES ESTETICAS ANSI =====
C_CYAN = "\x1B[36m"
C_GREEN = "\x1B[32m"
C_MAGENTA = "\x1B[35m"
C_YELLOW = "\x1B[33m"
C_RED = "\x1B[31m"
C_GRAY = "\x1B[90m"
C_RESET = "\x1B[0m"
C_BOLD = "\x1B[1m"

dry_run = any(arg.lower() in ("--prueba", "--dry-run") for arg in sys.argv[1:])


def type_print(text, delay=0.012, end='\n'):
    """Efecto de terminal retro al imprimir"""
    for char in text:
        sys.stdout.write(char)
        sys.stdout.flush()
        if char != ' ': time.sleep(delay)
    if end: sys.stdout.write(end)
    sys.stdout.flush()

# ===== DATOS OFFLINE INDESTRUCTIBLES =====
LOCAL_NOMBRES = ["Alex", "Jordan", "Taylor", "Casey", "Morgan", "Riley", "Sam", "Jamie", "Skyler", "Jesse", "Avery", "Parker"]
LOCAL_APELLIDOS = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez"]
LOCAL_CIUDADES = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose"]
LOCAL_CALLLES = ["Maple St", "Oak Ave", "Pine Ln", "Cedar Rd", "Elm St", "Washington Blvd", "Lakeview Dr", "Sunset Blvd"]
LOCAL_PROFESIONES = ["Ingeniero de Software", "Analista de Datos", "Diseñador Gráfico", "Consultor Independiente", "Gerente de Proyectos", "Especialista en Marketing"]

def gen_fake_visa():
    """Genera numero VISA valido por algoritmo de Luhn (Test propouses)"""
    cc = [4] + [random.randint(0, 9) for _ in range(14)]
    check_sum = 0
    for i, n in enumerate(cc):
        if i % 2 == 0:
            n *= 2
            if n > 9: n -= 9
        check_sum += n
    cc.append((10 - (check_sum % 10)) % 10)
    cc_str = "".join(map(str, cc))
    return f"{cc_str[:4]}-{cc_str[4:8]}-{cc_str[8:12]}-{cc_str[12:]}", f"{random.randint(1,12):02d}/{random.randint(26,32)}", f"{random.randint(100,999)}"

def api_request(url, method='GET', data=None, token=None):
    """Auxiliar para peticiones JSON con urllib"""
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'HorusEngine/2.0 (Identity Generator)'
    }
    if token:
        headers['Authorization'] = f'Bearer {token}'
    
    req_data = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        return None

def fetch_identity():
    id_data = {}
    profile = None
    try:
        req = urllib.request.Request("https://randomuser.me/api/?nat=us,gb,es", headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            profile = json.loads(resp.read().decode())['results'][0]
            id_data['nombre'] = f"{profile['name']['first']} {profile['name']['last']}"
            id_data['usuario'] = profile['login']['username'] + str(random.randint(10,99))
            id_data['direccion'] = f"{profile['location']['street']['number']} {profile['location']['street']['name']}"
            id_data['ciudad'] = f"{profile['location']['city']}, {profile['location']['postcode']}"
            id_data['telefono'] = profile['phone']
            id_data['profesion'] = random.choice(LOCAL_PROFESIONES)
    except Exception:
        id_data['nombre'] = f"{random.choice(LOCAL_NOMBRES)} {random.choice(LOCAL_APELLIDOS)}"
        id_data['usuario'] = id_data['nombre'].replace(" ", "").lower() + str(random.randint(100,9999))
        id_data['direccion'] = f"{random.randint(100, 9999)} {random.choice(LOCAL_CALLLES)}"
        id_data['ciudad'] = f"{random.choice(LOCAL_CIUDADES)}, {random.randint(10000, 99999)}"
        id_data['telefono'] = f"+1 ({random.randint(200,999)}) {random.randint(100,999)}-{random.randint(1000,9999)}"
        id_data['profesion'] = random.choice(LOCAL_PROFESIONES)
    
    id_data['password'] = ''.join(random.choices(string.ascii_letters + string.digits, k=12)) + "X!"
    return id_data

def setup_mail_tm(username, password):
    """Configura una cuenta real en mail.tm"""
    # 1. Obtener dominio
    domains_resp = api_request("https://api.mail.tm/domains")
    if not domains_resp:
        return None
    
    # Manejar respuesta tanto si es el objeto Hydra como si es la lista directa
    members = []
    if isinstance(domains_resp, dict):
        members = domains_resp.get('hydra:member', [])
    elif isinstance(domains_resp, list):
        members = domains_resp

    if not members:
        return None
    
    domain = members[0]['domain']
    address = f"{username}@{domain}"
    
    # 2. Crear cuenta
    acc = api_request("https://api.mail.tm/accounts", "POST", {'address': address, 'password': password})
    if not acc:
        # Reintentar con otro nombre si el usuario existe
        address = f"{username}{random.randint(100,999)}@{domain}"
        acc = api_request("https://api.mail.tm/accounts", "POST", {'address': address, 'password': password})
        if not acc: return None

    # 3. Obtener Token
    token_data = api_request("https://api.mail.tm/token", "POST", {'address': address, 'password': password})
    if not token_data or not isinstance(token_data, dict): return None
    
    return {'address': address, 'token': token_data.get('token')}

def check_messages(token, seen_ids):
    msgs_resp = api_request("https://api.mail.tm/messages", "GET", token=token)
    if not msgs_resp:
        return False
    
    members = []
    if isinstance(msgs_resp, dict):
        members = msgs_resp.get('hydra:member', [])
    elif isinstance(msgs_resp, list):
        members = msgs_resp

    if not members:
        return False
    
    found_new = False
    for m in members:
        if m['id'] not in seen_ids:
            seen_ids.add(m['id'])
            found_new = True
            # Leer contenido
            content = api_request(f"https://api.mail.tm/messages/{m['id']}", "GET", token=token)
            if content and isinstance(content, dict):
                print(f"\n{C_MAGENTA}╔════ ✉️ NUEVO CORREO ENTRANTE ══════════════{C_RESET}")
                print(f"{C_MAGENTA}║ De:{C_RESET} {content.get('from', {}).get('name', '') or ''} <{content.get('from', {}).get('address', '')}>")
                print(f"{C_MAGENTA}║ Asunto:{C_RESET} {C_BOLD}{content.get('subject', '(Sin asunto)')}{C_RESET}")
                body = content.get('text', content.get('intro', ''))[:300].strip()
                print(f"{C_MAGENTA}║ Contenido:{C_RESET} {body.replace(chr(10), ' ')}")
                print(f"{C_MAGENTA}╚═════════════════════════════════════════════{C_RESET}\n")
    return found_new

def run():

    print(f"\n{C_CYAN}[*] Inicializando Motor de Identidad Fantasma V2.2 (Mail.tm Edition)...{C_RESET}")
    time.sleep(0.5)
    
    identidad = fetch_identity()
    mail_data = setup_mail_tm(identidad['usuario'], identidad['password'])
    
    if not mail_data:
        email = f"{identidad['usuario']}@example.com"
        token = None
    else:
        email = mail_data['address']
        token = mail_data['token']
    
    cc_num, cc_exp, cc_cvv = gen_fake_visa()
    
    print(f"{C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{C_RESET}")
    type_print(f"{C_BOLD}             TARJETA DE IDENTIDAD DE PRUEBA           {C_RESET}")
    print(f"{C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{C_RESET}")
    
    print(f"{C_CYAN} 👤 PERFIL PERSONAL{C_RESET}")
    print(f"  ├─ Nombre:     {C_BOLD}{identidad['nombre']}{C_RESET}")
    print(f"  ├─ Profesión:  {C_GRAY}{identidad['profesion']}{C_RESET}")
    print(f"  ├─ Teléfono:   {identidad['telefono']}")
    print(f"  └─ Ubicación:  {identidad['ciudad']}\n")
    
    print(f"{C_CYAN} 🔐 CREDENCIALES WEB (ENTORNO DE PRUEBA){C_RESET}")
    print(f"  ├─ Usuario:    {C_BOLD}{identidad['usuario']}{C_RESET}")
    print(f"  ├─ Password:   {C_BOLD}{C_YELLOW}{identidad['password']}{C_RESET}")
    print(f"  └─ Correo:     {C_BOLD}{C_GREEN}{email}{C_RESET}\n")
    
    print(f"{C_CYAN} 💳 FINANZAS (DUMMY - NO VALIDO PARA PAGOS){C_RESET}")
    print(f"  ├─ VISA:       {C_BOLD}{cc_num}{C_RESET}")
    print(f"  └─ CVV/EXP:    {cc_cvv} | {cc_exp}\n")
    
    print(f"{C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{C_RESET}")
    
    clip_text = f"Identidad: {identidad['nombre']}\nUser: {identidad['usuario']}\nPass: {identidad['password']}\nEmail: {email}\nCC: {cc_num}"
    try:
        subprocess.run("clip", text=True, input=clip_text, shell=True, stderr=subprocess.DEVNULL)
        type_print(f"{C_GREEN}[V] Datos maestros copiados al portapapeles.{C_RESET}")
    except: pass

    if not token:
        print(f"{C_RED}[!] Error: No se pudo crear el buzón real. Estás en modo Offline.{C_RESET}")
        return

    print(f"\n{C_MAGENTA}[*] Monitor de Buzón Activo en Vivo...{C_RESET}")
    print(f"{C_GRAY}    Esperando correos de verificación. Deja esta ventana abierta.{C_RESET}")
    
    seen_ids = set()
    spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    idx = 0
    
    try:
        while True:
            sys.stdout.write(f"\r{C_CYAN}{spinner[idx % len(spinner)]} Escuchando {email}...{C_RESET}")
            sys.stdout.flush()
            idx += 1
            if idx % 15 == 0:
                if check_messages(token, seen_ids):
                    sys.stdout.write("\r" + " " * 60 + "\r")
            time.sleep(0.4)
    except KeyboardInterrupt:
        print(f"\n\n{C_CYAN}[*] Desconexión de buzón finalizada.{C_RESET}")

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        import traceback
        with open("ERROR_LOG.txt", "w") as x:
            x.write("FATAL ERROR: " + str(e) + "\n" + traceback.format_exc())
            x.write("\nSys.argv: " + str(sys.argv))
        print("ERROR CRITICO. Revisa ERROR_LOG.txt")
        time.sleep(10)