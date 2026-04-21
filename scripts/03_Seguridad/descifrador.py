# DESC: Descifra archivos cifrados con el sistema de Bóveda Segura (AES-256 CTR).
# ARGS: <Archivo_Cifrado> <Contraseña>
# RISK: medium
# PERM: user
# MODE: internal

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
import zipfile
import subprocess

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cryptography", "--quiet"])
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

if len(sys.argv) < 3:
    print("[X] Faltan parámetros. Usa: descifrador.py <Archivo> <Contraseña>")
    sys.exit()

archivo_cifrado = sys.argv[1]
password_raw = sys.argv[2]

print(f"[*] Abriendo la bóveda: {os.path.basename(archivo_cifrado)}")

try:
    # Formamos el nombre del zip temporal
    if archivo_cifrado.endswith('.png'):
        archivo_zip = archivo_cifrado.replace('.png', '.zip')
    else:
        archivo_zip = archivo_cifrado + '.zip'
        
    archivo_zip = archivo_zip.replace(' (Sello)', '')
        
    with open(archivo_cifrado, 'rb') as f_in:
        # Buscar firma mágica en los primeros 1MB para no saturar RAM
        cabecera = f_in.read(1024 * 1024)
        idx = cabecera.find(b'---HORUS-VAULT---')
        
        if idx == -1:
            # Compatibilidad con bóvedas viejas (.horus clásico)
            if archivo_cifrado.endswith('.horus'):
                f_in.seek(0)
            else:
                raise ValueError("Archivo no contiene bóveda criptográfica.")
        else:
            # Colocarnos justo después de la firma
            f_in.seek(idx + len(b'---HORUS-VAULT---'))
            
        # Leer metadatos
        salt = f_in.read(16)
        nonce = f_in.read(16)
        
        if len(salt) < 16 or len(nonce) < 16:
            raise ValueError("Formato de bóveda corrupto.")
            
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=600000)
        key = kdf.derive(password_raw.encode())

        cipher = Cipher(algorithms.AES(key), modes.CTR(nonce), backend=default_backend())
        decryptor = cipher.decryptor()
        
        # El peso total restante
        peso_total = os.path.getsize(archivo_cifrado) - f_in.tell()
        
        chunck_size = 64 * 1024
        bytes_procesados = 0
        ultimo_porcentaje = -10
        
        with open(archivo_zip, 'wb') as f_out:
            while True:
                chunk = f_in.read(chunck_size)
                if len(chunk) == 0:
                    break
                
                datos_descifrados = decryptor.update(chunk)
                f_out.write(datos_descifrados)
                bytes_procesados += len(chunk)
                
                # Actualizar consola sin saturar
                if peso_total > 0:
                    porcentaje_actual = int((bytes_procesados / peso_total) * 100)
                    if porcentaje_actual >= ultimo_porcentaje + 10:
                        print(f"[~] Reconstruyendo archivos... ({porcentaje_actual}%)")
                        ultimo_porcentaje = porcentaje_actual
                    
            f_out.write(decryptor.finalize())

    print("\n[*] Desempaquetando estructura de carpetas...")
        
    carpeta_destino = archivo_zip.replace('.zip', '')
    with zipfile.ZipFile(archivo_zip, 'r') as zip_ref:
        zip_ref.extractall(carpeta_destino)
        
    os.remove(archivo_zip)
    print("\n[V] BÓVEDA ABIERTA EXITOSAMENTE.")
    print("    Tus datos han sido restaurados correctamente.")

except Exception as e:
    if os.path.exists(archivo_zip):
        try:
            os.remove(archivo_zip) # Limpiar zip corrupto en caso de fallo
        except Exception:
            pass
    print("\n[X] ACCESO DENEGADO: Contraseña incorrecta o archivo de bóveda dañado/incompatible.")
    sys.exit(1)
