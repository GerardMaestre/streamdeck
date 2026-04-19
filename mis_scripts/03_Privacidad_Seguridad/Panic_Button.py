# DESC: Destruye huellas: Cierra navegadores, borra Temp, DNS y vacía la papelera.
# ARGS: Ninguno
# RISK: high
# PERM: admin
# MODE: external

import os
import shutil
import getpass
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

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)



def close_browsers():
    print("[*] Cerrando navegadores...")
    browsers = ['chrome.exe', 'msedge.exe', 'brave.exe']
    for b in browsers:
        os.system(f'taskkill /F /IM {b} /T >nul 2>&1')
    
    time.sleep(2)
    return len(browsers)

def clear_browser_history():
    print("[*] Borrando historiales...")
    user = getpass.getuser()
    removed = 0
    
    paths = {
        'Chrome': fr"C:\Users\{user}\AppData\Local\Google\Chrome\User Data\Default\History",
        'Edge': fr"C:\Users\{user}\AppData\Local\Microsoft\Edge\User Data\Default\History",
        'Brave': fr"C:\Users\{user}\AppData\Local\BraveSoftware\Brave-Browser\User Data\Default\History"
    }

    for name, path in paths.items():
        if os.path.exists(path):
            try:
                os.remove(path)
                removed += 1
                print(f"[+] Historial de {name} eliminado.")
            except:
                print(f"[-] No se pudo borrar historial de {name} (puede estar en uso)")
    return removed


def clear_temp_files():
    print("[*] Limpiando %TEMP%...")
    temp_path = os.getenv('TEMP')
    removed = 0
    if temp_path:
        for item in os.listdir(temp_path):
            item_path = os.path.join(temp_path, item)
            try:
                if os.path.isfile(item_path):
                    os.remove(item_path)
                    removed += 1
                elif os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                    removed += 1
            except:
                pass
    return removed

def run():
    print("=== INICIANDO PROTOCOLO DE PÁNICO ===")

    closed_browsers = close_browsers()
    removed_history = clear_browser_history()
    
    print("[*] Vaciando DNS...")
    dns_result = os.system('ipconfig /flushdns >nul')
    
    print("[*] Vaciando Papelera...")
    recycle_result = os.system('powershell.exe -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"')
    temp_removed = clear_temp_files()

    print('\n[V] PROTOCOLO COMPLETADO')
    print(f"[i] Navegadores cerrados: {closed_browsers}")
    print(f"[i] Historiales eliminados: {removed_history}")
    print(f"[i] Entradas limpiadas en TEMP: {temp_removed}")
    print(f"[i] Flush DNS: {'OK' if dns_result == 0 else 'Pendiente/No disponible'}")
    print(f"[i] Papelera: {'OK' if recycle_result == 0 else 'Pendiente/No disponible'}")

if __name__ == "__main__":
    run()