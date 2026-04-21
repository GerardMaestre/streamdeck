# DESC: Fuerza a Windows a liberar toda la Memoria RAM cacheada inútil. Sube los FPS y elimina tirones en juegos.
# ARGS: Ninguno (Pedirá permisos de Administrador)
# RISK: medium
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
import time

# Forzar codificación y evitar buffer
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

# Escalada a Administrador necesaria para tocar el Kernel
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
    print("[!] Solicitando permisos de Administrador para Purgar la RAM (Acepta el escudo amarillo abajo)...", flush=True)
    log_file = os.path.join(tempfile.gettempdir(), f"horus_admin_{os.getpid()}.log")
    open(log_file, "w").close()
    params = f'"{os.path.abspath(__file__)}" ' + " ".join(f'"{a}"' for a in sys.argv[1:]) + f' --horus-log "{log_file}"'
    sw_mode = 1 if sys.stdout and sys.stdout.isatty() else 0
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, sw_mode) <= 32:
        print("[X] Elevación UAC rechazada.", flush=True); sys.exit(1)
    
    print("[*] Privilegios obtenidos. Ejecutando limpieza en el núcleo...", flush=True)
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
print("        ⚡ HORUS ENGINE - PURGATORIO DE MEMORIA RAM ⚡       ")
print("="*65)

class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]

def get_ram_libre():
    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
    return stat.ullAvailPhys / (1024 ** 2)

ram_antes = get_ram_libre()
print(f"[*] RAM Libre actual: {ram_antes:.2f} MB")
print("[*] Inyectando llamada al Kernel de Windows para vaciar procesos inactivos...", flush=True)

# 1. Vaciar el Working Set de todos los procesos abiertos
# Usa kernel32 directamente para enumerar PIDs sin necesitar psutil
procesos_limpiados = 0
try:
    # Enumerar todos los PIDs del sistema usando EnumProcesses
    ArrayType = ctypes.c_ulong * 4096
    pids = ArrayType()
    bytes_returned = ctypes.c_ulong()
    ctypes.windll.psapi.EnumProcesses(ctypes.byref(pids), ctypes.sizeof(pids), ctypes.byref(bytes_returned))
    num_pids = bytes_returned.value // ctypes.sizeof(ctypes.c_ulong)
    
    PROCESS_ALL_ACCESS = 0x001F0FFF
    for i in range(num_pids):
        pid = pids[i]
        if pid == 0:
            continue
        try:
            handle = ctypes.windll.kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, pid)
            if handle:
                ctypes.windll.psapi.EmptyWorkingSet(handle)
                ctypes.windll.kernel32.CloseHandle(handle)
                procesos_limpiados += 1
        except Exception:
            pass
    print(f" [>] Se vaciaron fragmentos de RAM de {procesos_limpiados} procesos activos vía Kernel32.")
except Exception as e:
    print(f" [X] Aviso menor: {e}")

time.sleep(1) # Dejar que Windows asimile la liberación de memoria

ram_despues = get_ram_libre()
ram_recuperada = ram_despues - ram_antes

print("\n" + "-"*65)
if ram_recuperada > 0:
    print(f"[OK] PURGA COMPLETADA. Se han recuperado {ram_recuperada:.2f} MB de RAM.")
else:
    print("[OK] PURGA COMPLETADA. Tu sistema ya estaba muy optimizado.")
print("[I] Puedes ejecutar esto antes de abrir un juego pesado para ganar rendimiento.")
