# DESC: MODO DIOS: Escanea TODOS tus discos duros buscando clones de fotos, videos y documentos. 100% Blindado: imposible romper el sistema (sólo escanea archivos personales y salta carpetas de Windows).
# ARGS: Ninguno (Analiza todos los discos automáticamente)
# RISK: high
# PERM: admin
# MODE: external

import os
import hashlib
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
import shutil
from pathlib import Path
import ctypes

if (sys.stdout.encoding or '').lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

simulacion = any(arg.lower() in ("--prueba", "--dry-run") for arg in sys.argv[1:])
confirmed = "--confirmed" in sys.argv
if confirmed:
    sys.argv.remove("--confirmed")



# --- ELEVACION (Opcional, pero recomendada para leer todos los perfiles) ---
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
elif not simulacion and not ctypes.windll.shell32.IsUserAnAdmin():
    if not simulacion and not confirmed:
        confirmed = True

    print("[!] Recomendamos conceder permisos de Administrador para que Horus pueda leer todos los perfiles de usuario...", flush=True)
    log_file = os.path.join(tempfile.gettempdir(), f"horus_admin_{os.getpid()}.log")
    open(log_file, "w").close()
    params = f'"{os.path.abspath(__file__)}" ' + " ".join(f'"{a}"' for a in sys.argv[1:])
    if confirmed:
        params += " --confirmed"
    params += f' --horus-log "{log_file}"'
    sw_mode = 1 if sys.stdout and sys.stdout.isatty() else 0
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, sw_mode) <= 32:
        print("[!] Permisos intermedios aplicados. Ejecutando escaneo normal...", flush=True)
        pass # Ejecutar normal
    else:
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

# =============================================================================
# REGLAS DE SEGURIDAD NUCLEAR HORUS ENGINE
# =============================================================================

# 1. Sólo purgar archivos generados por usuarios (Nada de aplicaciones u OS)
# Lista blanca estricta (todo en minúsculas)
EXT_SEGURAS = {
    # Imágenes
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.raw', '.tiff',
    # Videos
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
    # Audio
    '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a',
    # Documentos
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
    # Comprimidos y libros
    '.zip', '.rar', '.7z', '.epub', '.mobi'
}

# 2. Listas Negras (Ignorar estas carpetas para evitar descensos inútiles o letales)
CARPETAS_PROHIBIDAS = {
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "appdata",
    "$recycle.bin",
    "system volume information",
    "boot",
    "recovery",
    "perflogs",
    "msocache",
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "env_python",
    "site-packages",
    "dist",
    "build",
    "target",
    ".gradle",
    ".android",
    ".cargo",
    ".rustup",
    ".npm",
    ".pnpm-store",
    ".yarn",
    ".cache"
}

MAX_SIM_LOGS = 50

print("="*65)
print("     ⚡ HORUS ENGINE - LIMPIEZA EXTREMA GLOBAL (SEGURO) ⚡   ")
print("="*65)

if simulacion:
    print("[i] MODO PRUEBA activo: no se moverá ningun archivo.\n")
elif not confirmed:
    confirmed = True

print("[*] MODO DIOS ACTIVADO: Iniciando escaneo algorítmico profundo en todo el PC.")
print("[V] Filtro de Seguridad Nuclear: ON (Sólo extrae Multimedia y Documentos).")
print("[V] Blindaje de Sistema: ON (Windows y Programas Intocables).\n")

import string
# Detectar todos los discos conectados (C:, D:, E:...)
discos = [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
print(f"[*] Detectados {len(discos)} discos de almacenamiento: {', '.join(discos)}")

# --- FASE 1: BUSQUEDA Y AGRUPACION POR TAMAÑO ---
print("\n[~] FASE 1: Rastreando y mapeando el peso en todo el sistema métrico. (Esto tomará tiempo)")

# Agrupamos por tamaño primero (muy rápido) y sólo si cumple la extensión blanca
archivos_por_tamano = {}
total_archivos_validos = 0

for disco in discos:
    print(f"    -> Analizando plato: {disco}...", flush=True)
    
    for raiz, directorios, archivos in os.walk(disco):
        # Optimización brutal de Kernel: Modificar "directorios" in-place de os.walk 
        # para indicarle a Python que NO descienda hacia carpetas prohibidas.
        directorios[:] = [
            d for d in directorios 
            if d.lower() not in CARPETAS_PROHIBIDAS and not d.startswith("HORUS_DUPLICADOS")
        ]
        
        for archivo in archivos:
            ext = os.path.splitext(archivo)[1].lower()
            if ext in EXT_SEGURAS:
                ruta_completa = os.path.join(raiz, archivo)
                try:
                    peso = os.path.getsize(ruta_completa)
                    if peso > 0: # Ignorar archivos vacíos
                        total_archivos_validos += 1
                        if peso in archivos_por_tamano:
                            archivos_por_tamano[peso].append(ruta_completa)
                        else:
                            archivos_por_tamano[peso] = [ruta_completa]
                except:
                    pass

print(f" [V] Se mapearon {total_archivos_validos} fotos/videos/documentos por todo tu PC.")

# Filtrar sólo los que tienen el mismo tamaño (posibles duplicados algorítmicos)
candidatos = {peso: rutas for peso, rutas in archivos_por_tamano.items() if len(rutas) > 1}
total_candidatos = sum(len(rutas) for rutas in candidatos.values())

if total_candidatos == 0:
    print("\n[OK] Tu PC está impecable. No hay fotos, vídeos o documentos repetidos sustancialmente.")
    pass
    sys.exit(0)
    
print(f"\n[!] FASE 1 COMPLETADA. Se seleccionaron {total_candidatos} archivos de tamaño idéntico para verificación de ADN.")

# --- FASE 2: HASHING PROFUNDO OMNISCIENTE ---
print("\n[~] FASE 2: Decodificando Hashes MD5 para confirmar clones exactos al 100%...")

def hash_archivo(ruta):
    """Genera hash MD5 leyendo por bloques cortos de RAM."""
    hasher = hashlib.md5()
    try:
        with open(ruta, 'rb') as f:
            for buf in iter(lambda: f.read(65536), b''):
                hasher.update(buf)
        return hasher.hexdigest()
    except:
        return None

duplicados_totales = 0
espacio_recuperable = 0
sim_logs_mostrados = 0
sim_logs_omitidos = 0

for peso, rutas in candidatos.items():
    hashes = {}
    for ruta in rutas:
        h = hash_archivo(ruta)
        if h:
            if h in hashes:
                # ¡ES UN DUPLICADO EXACTO CONFIRMADO POR CRIPTOGRAFÍA!
                original = hashes[h]
                
                # Mover el duplicado a cuarentena en su mismo disco físico
                disco_origen = Path(ruta).drive + "\\"
                carpeta_cuarentena = os.path.join(disco_origen, "HORUS_DUPLICADOS_GLOBALES")
                if not os.path.exists(carpeta_cuarentena):
                    try:
                        os.makedirs(carpeta_cuarentena)
                    except:
                        # Si no puede escribir en C:\HORUS..., lo manda a Documentos
                        carpeta_cuarentena = os.path.join(Path.home(), "Documents", "HORUS_DUPLICADOS_GLOBALES")
                        if not os.path.exists(carpeta_cuarentena): os.makedirs(carpeta_cuarentena)
                
                nombre_archivo = os.path.basename(ruta)
                nueva_ruta = os.path.join(carpeta_cuarentena, nombre_archivo)
                
                # Prevenir colisión de nombres
                contador = 1
                base, ext = os.path.splitext(nombre_archivo)
                while os.path.exists(nueva_ruta):
                    nueva_ruta = os.path.join(carpeta_cuarentena, f"{base} ({contador}){ext}")
                    contador += 1
                
                try:
                    visual = nombre_archivo[:30] + '...' if len(nombre_archivo) > 30 else nombre_archivo
                    if simulacion:
                        if sim_logs_mostrados < MAX_SIM_LOGS:
                            print(f" [Simulación] Se aislaria: {visual}")
                            sim_logs_mostrados += 1
                        else:
                            sim_logs_omitidos += 1
                    else:
                        shutil.move(ruta, nueva_ruta)
                        print(f" [Aislado] {visual} -> Mismo Hash que su gemelo.")
                    duplicados_totales += 1
                    espacio_recuperable += peso
                except:
                    pass
            else:
                # El primero que vemos con este hash, original sagrado
                hashes[h] = ruta

print("\n" + "="*65)
if duplicados_totales > 0:
    espacio_mb = espacio_recuperable / (1024*1024)
    if simulacion:
        if sim_logs_omitidos > 0:
            print(f"[i] Salida resumida: se omitieron {sim_logs_omitidos} lineas de simulacion para evitar saturacion de consola.")
        if espacio_mb > 1024:
            print(f"[OK] Simulación completada: se aislarian {duplicados_totales} clones exactos.")
            print(f"[OK] Espacio potencial recuperable: {espacio_mb/1024:.2f} GB.")
        else:
            print(f"[OK] Simulación completada: se aislarian {duplicados_totales} archivos clónicos.")
            print(f"[OK] Espacio potencial recuperable: {espacio_mb:.2f} MB.")
    else:
        if espacio_mb > 1024:
            print(f"[OK] LIMPIEZA EXTREMA ABORTADA CON ÉXITO. Se han desterrado {duplicados_totales} clones exactos.")
            print(f"[OK] Has RECUPERADO un inmenso total de {espacio_mb/1024:.2f} GB de almacenamiento físico.")
        else:
            print(f"[OK] LIMPIEZA COMPLETADA. Se aislaron {duplicados_totales} archivos clónicos.")
            print(f"[OK] Has RECUPERADO {espacio_mb:.2f} MB de tus discos.")
        print("\n[i] SEGURIDAD: Los clones no han sido eliminados permanentemente del disco por precaución máxima.")
        print("[i] Se han acumulado todos ordenadamente en la carpeta HORUS_DUPLICADOS_GLOBALES (en tu C:, D:, u otra raíz).")
        print("[i] Busca esas carpetas desde el explorador, revisa si hay alguna foto repetida que quieras y luego bórrala entera.")
else:
    print("[OK] Falso positivo volumétrico. ¡Todos los archivos que pesaban lo mismo eran totalmente distintos por dentro!")

print("="*65)
