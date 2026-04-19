# DESC: Purga los datos ocultos (coordenadas GPS, fecha, modelo de cámara) de tus fotos para anonimato total.
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

# Forzar codificación y evitar buffer
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

try:
    import subprocess
    from PIL import Image
except ImportError:
    print("[*] Instalando motor de procesamiento de imágenes (Pillow)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "--quiet"])
    from PIL import Image

print("="*65)
print("     ⚡ HORUS ENGINE - DESTRUCTOR DE METADATOS (EXIF) ⚡     ")
print("="*65)

if len(sys.argv) < 2:
    print("[ERROR] Faltan parámetros.")
    print("En la caja de 'Parámetros Globales' pon la ruta de la carpeta con tus fotos.")
    print("Ejemplo: C:\\Users\\gerar\\Desktop\\Fotos_Privadas")
    sys.exit()

carpeta_objetivo = " ".join(sys.argv[1:]).strip('"').strip("'")

if not os.path.exists(carpeta_objetivo):
    print(f"[X] No se encontró la carpeta: {carpeta_objetivo}")
    sys.exit()

print(f"[*] Analizando zona de impacto: {carpeta_objetivo}")
print("[*] Iniciando purga quirúrgica de metadatos (GPS, EXIF, Fechas)...\n")

archivos_limpiados = 0
errores = 0

EXTENSIONES_VALIDAS = ('.jpg', '.jpeg', '.png', '.tiff', '.webp')

for root, dirs, files in os.walk(carpeta_objetivo):
    for filename in files:
        if filename.lower().endswith(EXTENSIONES_VALIDAS):
            filepath = os.path.join(root, filename)
            
            try:
                # 1. Abrimos la imagen
                with Image.open(filepath) as img:
                    formato = img.format if img.format else 'JPEG'
                    # Copiamos mágicamente solo los píxeles (ignora EXIF, XMP, IPTC, ICC y metadatos de IA)
                    # Forzamos conversión a RGB/RGBA descartando paletas ocultas
                    modo_seguro = 'RGBA' if img.mode in ('RGBA', 'LA', 'P') else 'RGB'
                    img_convertida = img.convert(modo_seguro)
                    
                    imagen_limpia = Image.new(modo_seguro, img_convertida.size)
                    imagen_limpia.paste(img_convertida)
                
                # 2. Borrado Forense: Eliminamos el archivo original para destruir 
                # los Alternate Data Streams de Windows (ej: Zone.Identifier) y registros del MFT
                os.remove(filepath)
                
                # 3. Guardamos la nueva imagen huérfana de metadatos desde cero
                try:
                    imagen_limpia.save(filepath, formato, quality=100, optimize=True)
                except:
                    imagen_limpia.save(filepath, formato)
                    
                # 4. Modificamos las fechas de creación/modificación del archivo a una fecha genérica (1 Enero 1980)
                # Esto rompe el análisis forense de la línea de tiempo del sistema de archivos
                os.utime(filepath, (315532800, 315532800))
                
                # Mostrar progreso truncando el nombre
                nombre_corto = filename[:35] + '...' if len(filename) > 35 else filename
                print(f" [>] {nombre_corto:<38} : PURGADO", flush=True)
                archivos_limpiados += 1
                
            except Exception as e:
                print(f" [X] Fallo al limpiar {filename}: {str(e)}")
                errores += 1

print("\n" + "-"*65)
print(f"[OK] OPERACIÓN FINALIZADA.")
print(f"[I] {archivos_limpiados} imágenes han sido totalmente anonimizadas.")
if errores > 0:
    print(f"[!] {errores} imágenes no se pudieron procesar.")
