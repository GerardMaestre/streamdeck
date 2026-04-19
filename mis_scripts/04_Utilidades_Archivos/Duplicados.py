# DESC: Escanea tu carpeta de Descargas buscando clones exactos (verificando Hashes MD5) y los aísla.
# ARGS: <Ruta_Carpeta> <Ruta_Cuarentena>
# RISK: medium
# PERM: user
# MODE: external

import os
import hashlib
import shutil
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
from pathlib import Path

if (sys.stdout.encoding or '').lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Configuración
argumentos = [arg for arg in sys.argv[1:] if not arg.startswith("--")]


def _clean_path(raw):
    return str(raw or '').strip().strip('"').strip("'")


RUTA_ESCANEO = ''
RUTA_PAPELERA = ''

if len(argumentos) >= 2 and os.path.exists(_clean_path(argumentos[0])):
    RUTA_ESCANEO = _clean_path(argumentos[0])
    # Si vienen argumentos extra, se consideran parte de la ruta de cuarentena.
    RUTA_PAPELERA = _clean_path(" ".join(argumentos[1:]))
elif len(argumentos) >= 1:
    # Compatibilidad legacy: una sola ruta de escaneo (incluye casos con espacios sin comillas).
    RUTA_ESCANEO = _clean_path(" ".join(argumentos))
    if not os.path.exists(RUTA_ESCANEO):
        print(f"[X] ERROR: La ruta especificada no existe: {RUTA_ESCANEO}")
        sys.exit(1)
        
    # Bloqueo de seguridad: Evitar escanear carpetas del sistema
    ruta_abs = os.path.abspath(RUTA_ESCANEO).lower()
    rutas_prohibidas = [
        "c:\\windows", 
        "c:\\program files", 
        "c:\\program files (x86)", 
        "c:\\programdata"
    ]
    if ruta_abs == "c:\\" or any(ruta_abs.startswith(p) for p in rutas_prohibidas):
        print(f"\n[!] AVISO DE SEGURIDAD (HORUS ENGINE) [!]")
        print(f"[X] Está TERMINANTEMENTE PROHIBIDO escanear carpetas del sistema: {RUTA_ESCANEO}")
        print("[X] Windows utiliza miles de archivos duplicados (Librerías DLL) a propósito.")
        print("[X] Si el cazador de duplicados los aísla, romperás Windows o tus aplicaciones.")
        print("[X] Usa esta herramienta SÓLO en carpetas personales (Documentos, Fotos, Descargas, Discos Externos).\n")
        sys.exit(1)
else:
    RUTA_ESCANEO = os.path.join(Path.home(), "Downloads")

if not RUTA_PAPELERA:
    RUTA_PAPELERA = os.path.join(RUTA_ESCANEO, "DUPLICADOS_A_BORRAR")

def hash_archivo(ruta):
    """Crea una huella digital única (hash) del archivo para compararlo."""
    hasher = hashlib.md5()
    try:
        with open(ruta, 'rb') as f:
            buf = f.read(65536)
            while len(buf) > 0:
                hasher.update(buf)
                buf = f.read(65536)
        return hasher.hexdigest()
    except Exception:
        return None

print("="*65)
print("      ⚡ HORUS AUTOPILOT - CAZADOR DE DUPLICADOS ⚡      ")
print("="*65)
print(f"[*] Escaneando en profundidad: {RUTA_ESCANEO}\n")

simulacion = any(arg.lower() in ("--prueba", "--dry-run") for arg in sys.argv[1:])
if simulacion:
    print("[i] MODO PRUEBA activo: no se moverá ningun archivo.\n")
    pass

if not os.path.exists(RUTA_PAPELERA):
    os.makedirs(RUTA_PAPELERA)

# 1. Agrupar archivos por tamaño (Filtro ultrarrápido)
print("[~] Fase 1: Analizando estructura y tamaños...")
archivos_por_tamano = {}

for raiz, _, archivos in os.walk(RUTA_ESCANEO):
    if RUTA_PAPELERA in raiz: 
        continue
        
    for archivo in archivos:
        ruta = os.path.join(raiz, archivo)
        try:
            peso = os.path.getsize(ruta)
            if peso in archivos_por_tamano:
                archivos_por_tamano[peso].append(ruta)
            else:
                archivos_por_tamano[peso] = [ruta]
        except Exception:
            pass

# Quedarnos solo con agrupaciones de tamaño que tengan 2 o más archivos
posibles_duplicados = {peso: rutas for peso, rutas in archivos_por_tamano.items() if len(rutas) > 1}

# 2. Hashing profundo solo para los que pesan exactamente lo mismo
print("[~] Fase 2: Ejecutando criptografía en candidatos seleccionados...")
hashes_verificados = {}
duplicados = 0

for rutas in posibles_duplicados.values():
    for ruta in rutas:
        file_hash = hash_archivo(ruta)
        
        if file_hash:
            if file_hash in hashes_verificados:
                duplicados += 1
                archivo_nombre = os.path.basename(ruta)
                nueva_ruta = os.path.join(RUTA_PAPELERA, archivo_nombre)
                
                # Prevenir sobreescrituras en cuarentena
                contador = 1
                base, ext = os.path.splitext(archivo_nombre)
                while os.path.exists(nueva_ruta):
                    nueva_ruta = os.path.join(RUTA_PAPELERA, f"{base} ({contador}){ext}")
                    contador += 1

                visual = archivo_nombre[:40] + '...' if len(archivo_nombre) > 40 else archivo_nombre
                try:
                    if simulacion:
                        print(f" [Simulación] Se aislaria: {visual}")
                    else:
                        shutil.move(ruta, nueva_ruta)
                        print(f" [!] CLON AISLADO: {visual}")
                except Exception as e:
                    print(f" [X] ERROR aislando {visual}: {e}")
            else:
                hashes_verificados[file_hash] = ruta

print("\n" + "-" * 65)
if duplicados > 0:
    if simulacion:
        print(f"[OK] Simulacion completada: se aislarian {duplicados} archivos duplicados.")
    else:
        print(f"[OK] Se aislaron {duplicados} archivos duplicados en la carpeta 'DUPLICADOS_A_BORRAR'.")
        print("[I] Revisa la carpeta y elimínala manualmente cuando estés seguro.")
else:
    print("[OK] Sistema limpio. No se encontraron clones exactos.")
