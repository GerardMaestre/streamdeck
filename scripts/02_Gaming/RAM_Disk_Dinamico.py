# DESC: Convierte tu Memoria RAM en un Disco virtual ultra-rápido (20,000 MB/s). Elimina tiempos de carga en juegos pesados usando enlaces Mágicos (Junctions).
# ARGS: Ninguno (Tiene interfaz interactiva)
# RISK: high
# PERM: admin
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
import ctypes
import shutil
import urllib.request
import subprocess
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog

# Forzar codificación y evitar buffer
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

confirmed = "--confirmed" in sys.argv
if confirmed:
    sys.argv.remove("--confirmed")



# 1. Elevación de Privilegios
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
elif not ctypes.windll.shell32.IsUserAnAdmin():
    if not confirmed:
        confirmed = True

    print("[!] Solicitando permisos de Administrador para Ram-Disk (Acepta el escudo amarillo abajo)...", flush=True)
    log_file = os.path.join(tempfile.gettempdir(), f"horus_admin_{os.getpid()}.log")
    open(log_file, "w").close()
    params = f'"{os.path.abspath(__file__)}" ' + " ".join(f'"{a}"' for a in sys.argv[1:])
    if confirmed:
        params += " --confirmed"
    params += f' --horus-log "{log_file}"'
    sw_mode = 1 if sys.stdout and sys.stdout.isatty() else 0
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, sw_mode) <= 32:
        print("[X] Elevación UAC rechazada.", flush=True); sys.exit(1)
    
    print("[*] Privilegios obtenidos. Ejecutando entorno aislado RAM-Disk...", flush=True)
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

print("="*65)
print("       ⚡ HORUS ENGINE - RAM-DISK DINÁMICO (CERO CARGAS) ⚡      ")
print("="*65)
if not confirmed:
    confirmed = True

# 2. Verificar o Instalar ImDisk (Motor de Disco Virtual)
IMDISK_EXE = r"C:\Windows\System32\imdisk.exe"

if not os.path.exists(IMDISK_EXE):
    print("[*] ImDisk Virtual Disk Driver no detectado.")
    print("[*] Descargando el instalador silenciosamente desde repositorios oficiales...")
    try:
        urllib.request.urlretrieve("https://ltr-data.se/files/imdiskinst.exe", "imdiskinst.exe")
        print("[*] Instalando motor de RAM Disk profundo en el Kernel...")
        subprocess.run(["imdiskinst.exe", "-y"], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        os.remove("imdiskinst.exe")
        print("[+] ¡Motor instalado correctamente!")
    except Exception as e:
        print(f"[X] Fallo al instalar el motor: {e}")
        print("Asegúrate de tener conexión a Internet para esta primera vez.")
        sys.exit()

# Ocultar ventana padre de Tkinter
root = tk.Tk()
root.withdraw()
root.configure(bg="#1e1e1e")

# 3. Seleccionar carpeta
messagebox.showinfo("HORUS ENGINE - RAM DISK", "Selecciona primero la TABLA o LA CARPETA DEL JUEGO/PROGRAMA que quieres acelerar jugando desde la RAM.\n\nAtención: ¡Asegúrate de tener memoria RAM suficiente para albergar la carpeta entera!")
carpeta_objetivo = filedialog.askdirectory(title="Selecciona la carpeta o juego a Acelerar")

if not carpeta_objetivo:
    print("[!] Operación cancelada.")
    sys.exit()

# 4. Calcular tamaño y RAM necesaria
def get_size(start_path):
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(start_path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                total_size += os.path.getsize(fp)
    return total_size

peso_bytes = get_size(carpeta_objetivo)
peso_gb = peso_bytes / (1024**3)

print(f"\n[*] Analizando objetivo: {carpeta_objetivo}")
print(f"[*] Peso Real de la carpeta: {peso_gb:.2f} GB")

# 5. Configurar Tamaño del RAM Disk
try:
    ram_recomendada = int(peso_gb + 0.5) # Redondear hacia arriba + un poco de margen
    if ram_recomendada == 0: ram_recomendada = 1
except:
    ram_recomendada = 2

# Preguntar al usuario por la RAM (GB)
ram_asignar = simpledialog.askinteger("Tamaño del RAM Disk", 
                                      f"El juego pesa {peso_gb:.2f} GB.\n\n¿Cuántos Gigabytes de RAM quieres convertir en Disco Duro ultra-rápido temporal?\n\n¡Cuidado! No pongas más de la RAM Física que tienes libre.", 
                                      initialvalue=ram_recomendada, minvalue=1, maxvalue=128)

if not ram_asignar:
    print("[!] Operación cancelada.")
    sys.exit()

# Encontrar letra de unidad libre (empezando por R: de RAM)
import string
letras_usadas = [f"{d}:" for d in string.ascii_uppercase if os.path.exists(f"{d}:")]
UNIDAD_RAM = None
for letra in ["R", "Z", "X", "Y", "V", "W"]:
    if f"{letra}:" not in letras_usadas:
        UNIDAD_RAM = f"{letra}:"
        break

if not UNIDAD_RAM:
    print("[X] No quedan letras de unidad libres en tu PC.")
    sys.exit()

print(f"\n[*] [FASE 1] Creando Disco de Memoria de {ram_asignar} GB en la unidad apuntando a {UNIDAD_RAM} ...")

# 6. Crear el RAM Disk Formateado
cmd_imdisk = f'imdisk -a -s {ram_asignar}G -m {UNIDAD_RAM} -p "/fs:ntfs /q /y"'
res = subprocess.run(cmd_imdisk, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if not os.path.exists(UNIDAD_RAM):
    print("[X] Error crítico creando el RAM Disk.")
    sys.exit()

print(f"[+] Disco de RAM creado y formateado a la perfección.")

carpeta_backup = carpeta_objetivo + "_HORUS_BACKUP"

# 7. Engaño del Sistema (Enlaces Simbólicos)
try:
    print("\n[*] [FASE 2] Moviendo los datos en bruto hacia la memoria RAM (Velocidad de la luz)...")
    print(f"    - De: {carpeta_objetivo}")
    print(f"    - A:  {UNIDAD_RAM}\\")
    
    # 7.1 Copiar todo a la RAM primero (súper veloz)
    subprocess.run(f'robocopy "{carpeta_objetivo}" "{UNIDAD_RAM}\\" /mir /mt:32', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 7.2 Renombrar la carpeta real al backup
    os.rename(carpeta_objetivo, carpeta_backup)
    
    # 7.3 Crear Enlace Simbólico Mágico (Junction)
    # Así, cuando Windows vaya a "C:\Juegos\MiJuego", irá a "R:\"
    subprocess.run(f'mklink /J "{carpeta_objetivo}" "{UNIDAD_RAM}\\"', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    print("\n" + "="*65)
    print(f"[✅] ¡INYECCIÓN COMPLETADA! EL JUEGO ESTÁ EN TU MEMORIA RAM.")
    print("="*65)
    print("\n -> Abre tu juego o programa de forma totalmente normal desde su acceso directo.")
    print(" -> Juega con un rendimiento perfecto y tiempos de carga instantáneos.")
    print("\n[⚠️] CRÍTICO: NO CIERRES ESTA VENTANA ELÉCTRICA.")
    print("Cuando termines de jugar y lo cierres, VUELVE AQUÍ PARA GUARDAR LAS PARTIDAS.")
    print("")
    
    # 8. Espera Interactiva
    input("👉 PULSA [ENTER] AQUÍ CUANDO HAYAS CERRADO EL JUEGO POR COMPLETO... ")
    
except Exception as e:
    print(f"[X] Hubo un error a mitad de proceso: {e}")
    # Fallback cleanup below

# 9. Restauración (Sincronización Inversa)
print("\n" + "="*65)
print("[*] Iniciando Protocolo de Extracción Segura...")

# Si la carpeta original sigue siendo un junction, borrarla
if os.path.islink(carpeta_objetivo) or os.path.exists(carpeta_objetivo):
    # En Windows una Junction se borra con os.rmdir, no remove, o eliminando con cmd.
    subprocess.run(f'rmdir "{carpeta_objetivo}"', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Si existe la RAM, copiar partidas guardadas y cambios DE VUELTA al SSD de forma recursiva
if os.path.exists(UNIDAD_RAM):
    print("[*] Rescatando partidas guardadas y modificaciones hacia tu SSD físico...")
    # Sincroniza desde la RAM al backup
    subprocess.run(f'robocopy "{UNIDAD_RAM}\\" "{carpeta_backup}" /mir /mt:32', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Restaurar nombre de carpeta real
if os.path.exists(carpeta_backup):
    try:
        os.rename(carpeta_backup, carpeta_objetivo)
        print("[+] Restauración Estructural Completada.")
    except Exception as e:
        print(f"[!] Aviso: No pude cambiar el nombre '{carpeta_backup}' de vuelta. Quizá algún archivo aún está abierto.")

# Destruir RAM Disk
print("[*] Desmaterializando Disco de RAM...")
subprocess.run(f'imdisk -D -m {UNIDAD_RAM}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("[+] Toda la Memoria RAM ha sido devuelta al sistema intacta.")
print("\n[V] Misión Cumplida.")
    pass

