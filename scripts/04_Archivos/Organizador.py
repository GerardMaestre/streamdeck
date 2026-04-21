# DESC: Escanea tu carpeta de Descargas y mueve automáticamente todos los archivos a carpetas categorizadas limpiando el caos.
# ARGS: <Ruta_Carpeta>
# RISK: medium
# PERM: user
# MODE: external

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
import shutil
from pathlib import Path

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Configuración
argumentos = [arg for arg in sys.argv[1:] if not arg.startswith("--")]

if len(argumentos) >= 1:
    RUTA_DESCARGAS = " ".join(argumentos).strip('"').strip("'")
    if not os.path.exists(RUTA_DESCARGAS):
        print(f"[X] ERROR: La ruta especificada no existe: {RUTA_DESCARGAS}")
        sys.exit(1)
        
    # Bloqueo de seguridad: Evitar escanear carpetas del sistema
    ruta_abs = os.path.abspath(RUTA_DESCARGAS).lower()
    rutas_prohibidas = [
        "c:\\windows", 
        "c:\\program files", 
        "c:\\program files (x86)", 
        "c:\\programdata"
    ]
    if ruta_abs == "c:\\" or any(ruta_abs.startswith(p) for p in rutas_prohibidas):
        print(f"\n[!] AVISO DE SEGURIDAD (HORUS ENGINE) [!]")
        print(f"[X] Está TERMINANTEMENTE PROHIBIDO organizar carpetas del sistema: {RUTA_DESCARGAS}")
        print("[X] Si se mueven las librerías o dependencias de Windows a subcarpetas, destruirás el sistema operativo.")
        print("[X] Usa esta herramienta SÓLO en carpetas personales (Descargas, Escritorio, Documentos).\n")
        sys.exit(1)
else:
    RUTA_DESCARGAS = os.path.join(Path.home(), "Downloads")

# =====================================================================
# MEGA-DICCIONARIO DE EXTENSIONES (Nivel Omni)
# =====================================================================
CATEGORIAS = {
    "IMAGENES": ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.heic', '.raw', '.cr2', '.nef', '.orf', '.ico'],
    "VECTORES": ['.svg', '.ai', '.eps', '.cdr'],
    "VIDEOS": ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m4v', '.3gp'],
    "AUDIO": ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.midi', '.m3u'],
    "DOCUMENTOS": ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.md'],
    "HOJAS_CALCULO": ['.xls', '.xlsx', '.csv', '.ods'],
    "PRESENTACIONES": ['.ppt', '.pptx', '.odp'],
    "COMPRIMIDOS": ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz'],
    "INSTALADORES": ['.exe', '.msi', '.apk', '.appimage', '.run', '.deb', '.rpm', '.dmg', '.pkg'],
    "CODIGO_Y_SCRIPTS": ['.py', '.js', '.html', '.css', '.c', '.cpp', '.java', '.cs', '.php', '.json', '.xml', '.sh', '.bat', '.ps1', '.sql', '.yaml', '.yml'],
    "MODELOS_3D_Y_CAD": ['.obj', '.fbx', '.blend', '.stl', '.step', '.iges', '.dwg', '.dxf'],
    "FUENTES": ['.ttf', '.otf', '.woff', '.woff2'],
    "IMAGENES_DISCO": ['.iso', '.img', '.vdi', '.vmdk']
}

# Invertir el diccionario para búsquedas en O(1) (Ultra rápido)
MAPA_EXT = {}
for categoria, extensiones in CATEGORIAS.items():
    for ext in extensiones:
        MAPA_EXT[ext] = categoria

print("="*65)
print("       ⚡ HORUS ENGINE - ORGANIZADOR OMNISCIENTE ⚡      ")
print("="*65)
print(f"[*] Analizando zona de impacto: {RUTA_DESCARGAS}\n")

# Sistema de prueba rápida (Dry Run)
simulacion = any("--prueba" in arg.lower() for arg in sys.argv[1:])
if simulacion:
    print("[!] MODO PRUEBA (DRY-RUN) ACTIVO: No se moverá ningún archivo realmente.\n")
    pass

archivos_movidos = 0
archivos_ignorados = 0

def resolver_colision(ruta_destino, nombre_archivo):
    """Si el archivo ya existe en el destino, le añade un número al final."""
    base, ext = os.path.splitext(nombre_archivo)
    contador = 1
    nueva_ruta = os.path.join(ruta_destino, nombre_archivo)
    while os.path.exists(nueva_ruta):
        nueva_ruta = os.path.join(ruta_destino, f"{base} ({contador}){ext}")
        contador += 1
    return nueva_ruta

if not os.path.exists(RUTA_DESCARGAS):
    print("[X] Error: No se encuentra la carpeta de descargas.")
else:
    for entrada in os.scandir(RUTA_DESCARGAS):
        if entrada.is_file():
            archivo = entrada
            # Ignorar archivos ocultos o de sistema
            if not archivo.name.startswith('.') and not archivo.name.endswith('.ini'):
                extension = os.path.splitext(archivo.name)[1].lower()
                
                # Asignar categoría (Si no la conoce, la manda a MISCELANEA)
                categoria_destino = MAPA_EXT.get(extension, "MISCELANEA")
                
                ruta_carpeta_destino = os.path.join(RUTA_DESCARGAS, categoria_destino)
                
                # Crear la carpeta si no existe
                if not os.path.exists(ruta_carpeta_destino):
                    os.makedirs(ruta_carpeta_destino)
                
                # Obtener una ruta segura que no borre archivos existentes
                ruta_final = resolver_colision(ruta_carpeta_destino, archivo.name)
                
                # Ejecutar el movimiento
                try:
                    nombre_visual = archivo.name[:35] + '...' if len(archivo.name) > 35 else archivo.name
                    if simulacion:
                        print(f" [Simulación] Se movería: {nombre_visual:<24} --> /{categoria_destino}")
                        archivos_movidos += 1
                    else:
                        shutil.move(archivo.path, ruta_final)
                        print(f" [M] {nombre_visual:<38} --> /{categoria_destino}")
                        archivos_movidos += 1
                except Exception as e:
                    print(f" [X] Error crítico moviendo {archivo.name}: {e}")
                    archivos_ignorados += 1

print("\n" + "-" * 65)
if simulacion:
    print(f"[OK] Prueba Finalizada. Se habrían movido {archivos_movidos} archivos (cero cambios reales).")
elif archivos_movidos > 0:
    print(f"[OK] Misión Cumplida. {archivos_movidos} archivos catalogados a la perfección.")
else:
    print("[I] Todo estaba ya limpio y organizado.")
