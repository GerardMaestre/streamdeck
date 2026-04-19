# DESC: Escanea e instala actualizaciones disponibles usando winget de forma automatizada.
# ARGS: Ninguno
# RISK: medium
# PERM: admin
# MODE: external

import os
import sys
import subprocess
import ctypes
import tempfile
import time
import re
import atexit

# Forzar codificación utf-8 a la salida
try:
    if sys.stdout is None or getattr(sys.stdout, 'name', '').upper() == 'NUL':
        sys.stdout = open('CONOUT$', 'w', encoding='utf-8')
        sys.stderr = open('CONOUT$', 'w', encoding='utf-8')
        sys.stdin = open('CONIN$', 'r', encoding='utf-8')
except Exception: pass

if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    except Exception: pass

# Colores ANSI para terminal integrada
C_CYAN = "\033[96m"
C_MAGENTA = "\033[95m"
C_YELLOW = "\033[93m"
C_GREEN = "\033[92m"
C_RED = "\033[91m"
C_GRAY = "\033[90m"
C_WHITE = "\033[97m"
C_RESET = "\033[0m"

# Constantes de Diseño (Renderizado Minimalista & Pro) sin colores ANSI que se borran
BOX_TL = "╭"
BOX_TR = "╮"
BOX_BL = "╰"
BOX_BR = "╯"
BOX_H  = "─"
BOX_V  = "│"
BULLET = "◈"
CHECK  = "✓"
CROSS  = "✗"
WARN   = "⚠"

def _horus_cleanup():
    if "HORUS_LOG_FILE" in os.environ:
        try: open(os.environ["HORUS_LOG_FILE"] + ".done", "w").close()
        except: pass

atexit.register(_horus_cleanup)

def print_header():
    print("\n")
    print(f"  {BOX_TL}{BOX_H * 50}{BOX_TR}")
    print(f"  {BOX_V}   ❖ HORUS ENGINE: WINGET CORE V3.0 ACTIVADO    {BOX_V}")
    print(f"  {BOX_BL}{BOX_H * 50}{BOX_BR}")
    print("\n   [ Inicializando telemetría de paquetes del sistema ]\n")
    time.sleep(1)

def get_updates():
    print(f"   {BULLET} {C_CYAN}Sincronizando con el Nexo de Microsoft...{C_RESET}")
    
    cmd = ["winget", "upgrade", "--accept-source-agreements"]
    with tempfile.TemporaryFile(mode='w+', encoding='utf-8', errors='replace') as temp_out:
        proc = subprocess.Popen(cmd, stdout=temp_out, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', creationflags=subprocess.CREATE_NO_WINDOW)
        
        while proc.poll() is None:
            time.sleep(0.5)
            
        temp_out.seek(0)
        output = temp_out.read()
    
    packages_to_update = []
    parsing_started = False
    
    for line in output.split('\n'):
        if "---" in line or "â€¦" in line or "..." in line or "===" in line: 
            parsing_started = True
            continue
            
        if parsing_started and line.strip():
            parts = line.strip().split()
            # Estructura: [Nombre...] [ID] [Version] [Disponible] [Origen]
            if len(parts) >= 4:
                # Comprobamos si el último es un origen conocido o si hay ID con punto
                source = parts[-1] if len(parts) >= 5 else "winget"
                pkg_id = parts[-4]
                name = " ".join(parts[:-4])
                
                if any(x in line.lower() for x in ["actualizaciones", "updates", "paquete", "package", "disponible"]):
                    continue
                
                if "." not in pkg_id and len(parts) >= 5: # ID suele tener puntos
                    pkg_id = parts[-3]
                    name = " ".join(parts[:-3])

                packages_to_update.append({"name": name, "id": pkg_id, "source": source})

    return packages_to_update

def update_package(pkg, index, total):
    name = pkg['name']
    pkg_id = pkg['id']
    pkg_source = pkg.get('source', 'winget')
    
    print(f"  {C_MAGENTA}┌─ TAREA {index}/{total} ─────────────────────────────────┐{C_RESET}")
    print(f"  {C_MAGENTA}│{C_RESET}  {C_WHITE}OBJETIVO :{C_RESET} {C_YELLOW}{name}{C_RESET}")
    print(f"  {C_MAGENTA}│{C_RESET}  {C_WHITE}FIRMADO  :{C_RESET} {C_GRAY}{pkg_id}{C_RESET} ({pkg_source})")
    print(f"  {C_MAGENTA}│{C_RESET}")
    print(f"  {C_MAGENTA}│{C_RESET}  {C_CYAN}📥 Descargando e Inyectando Parche...{C_RESET}", end="", flush=True)
    
    # Comandos mas especificos para evitar "Doble coincidencia"
    cmd = [
        "winget", "upgrade", "--id", pkg_id, 
        "--exact", "--source", pkg_source,
        "--accept-package-agreements", "--accept-source-agreements", 
        "--disable-interactivity", "--force"
    ]
    
    with tempfile.TemporaryFile(mode='w+', encoding='utf-8', errors='replace') as temp_out:
        proc = subprocess.Popen(cmd, stdout=temp_out, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', creationflags=subprocess.CREATE_NO_WINDOW)
        
        start_t = time.time()
        while proc.poll() is None:
            time.sleep(1)
            # Pequeño feedback visual de tiempo para que no parezca muerto
            elapsed = int(time.time() - start_t)
            # Solo pintamos si tarda mucho
            if elapsed > 0 and elapsed % 10 == 0:
                print(".", end="", flush=True)
            
        temp_out.seek(0)
        out_err = temp_out.read()
        
        # Saltamos linea despues de los puntos
        print("")

        if proc.returncode == 0 or "successfully installed" in out_err.lower() or "éxito" in out_err.lower():
            print(f"  {C_MAGENTA}│{C_RESET}  {C_GREEN}{CHECK} Sincronización Exitosa. 100%{C_RESET}")
            print(f"  {C_MAGENTA}└──────────────────────────────────────────────────┘{C_RESET}\n")
            return True
        else:
            err_msg = ""
            if any(x in out_err.lower() for x in ["bloqueado", "locked", "in use", "2316632107"]): 
                err_msg = "Aplicación en uso / Bloqueada por el sistema"
            elif any(x in out_err.lower() for x in ["encontrado", "found", "match"]): 
                err_msg = "Error de Identidad (ID ambigua)"
            elif "not support" in out_err.lower() or "no admite" in out_err.lower():
                err_msg = "El desarrollador bloqueó el parcheo silencioso"
            else: 
                err_msg = f"Fallo de protocolo Windows ({proc.returncode})"
                
            print(f"  {C_MAGENTA}│{C_RESET}  {C_RED}{CROSS} CONFLICTO: {err_msg}{C_RESET}")
            print(f"  {C_MAGENTA}│{C_RESET}  {C_YELLOW}{WARN} Saltando para mantener estabilidad del núcleo.{C_RESET}")
            print(f"  {C_MAGENTA}└──────────────────────────────────────────────────┘{C_RESET}\n")
            return False

def run():
    print_header()
    updates = get_updates()
    
    if not updates:
        print(f"   {C_GREEN}{CHECK} Tu sistema es una fortaleza blindada. Software en versión máxima.{C_RESET}\n")
        return

    print(f"   {C_YELLOW}{WARN} Se ha detectado una fisura. Existen {len(updates)} firmas obsoletas.{C_RESET}\n")
    time.sleep(1.5)
    
    success_count = 0
    failed_apps = []
    
    for idx, pkg in enumerate(updates, 1):
        if update_package(pkg, idx, len(updates)):
            success_count += 1
        else:
            failed_apps.append(pkg)
            
    # Reporte Final Consolidado
    print(f"   {C_MAGENTA}{BOX_TL}{BOX_H * 50}{BOX_TR}{C_RESET}")
    print(f"   {C_MAGENTA}{BOX_V}{C_RESET} {C_WHITE}MANTENIMIENTO GLOBAL CONCLUIDO                  {C_MAGENTA}{BOX_V}{C_RESET}")
    print(f"   {C_MAGENTA}{BOX_V}{C_RESET} {C_GREEN}Exitosos   :{C_RESET} {str(success_count).zfill(2)}                                  {C_MAGENTA}{BOX_V}{C_RESET}")
    print(f"   {C_MAGENTA}{BOX_V}{C_RESET} {C_RED}Pendientes :{C_RESET} {str(len(failed_apps)).zfill(2)}                                  {C_MAGENTA}{BOX_V}{C_RESET}")
    print(f"   {C_MAGENTA}{BOX_BL}{BOX_H * 50}{BOX_BR}{C_RESET}\n")

    if failed_apps:
        print(f"   {C_YELLOW}╔═════════ REPORTE DE ACCIONES PENDIENTES ═════════╗{C_RESET}")
        for app in failed_apps:
            reason = "Bloqueo / App Abierta" if "Edge" in app['name'] or "Chrome" in app['name'] else "Restricción de Origen"
            print(f"   {C_YELLOW}║{C_RESET} {C_WHITE}• {app['name']}{C_RESET}")
            print(f"   {C_YELLOW}║{C_RESET}   {C_GRAY}↳ Motivo probable: {reason}{C_RESET}")
        print(f"   {C_YELLOW}╚──────────────────────────────────────────────────╝{C_RESET}")
        print(f"\n   {C_CYAN}{BULLET} TIP: Cierra las aplicaciones marcadas y re-intenta{C_RESET}")
        print(f"   {C_CYAN}       la operación para sellar las fisuras.{C_RESET}\n")


if __name__ == "__main__":
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
                return self.stream.isatty()
                
        sys.stdout = Tee(log_file, sys.stdout)
        sys.stderr = sys.stdout
        del sys.argv[idx:idx+2]
        os.environ["HORUS_LOG_FILE"] = log_file
    elif not ctypes.windll.shell32.IsUserAnAdmin():
        # Detección dinámica TTY (evita el fallo invisible en External)
        print("[!] Solicitando permisos de Administrador (Aprueba el escudo de Windows)...", flush=True)
        sw_mode = 1 if sys.stdout and sys.stdout.isatty() else 0
        log_file = os.path.join(tempfile.gettempdir(), f"horus_admin_{os.getpid()}.log")
        open(log_file, "w").close()
        
        params = f'"{os.path.abspath(__file__)}" ' + " ".join(f'"{a}"' for a in sys.argv[1:])
        params += f' --horus-log "{log_file}"'
        
        if ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, sw_mode) <= 32:
            sys.exit(1)
            
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

    try:
        run()
    except Exception as e:
        print(f"\n {CROSS} Error catastrófico: {str(e)}")
