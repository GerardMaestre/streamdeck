# DESC: Extrae el audio de cualquier video en formato MP3 de máxima calidad (320kbps) con carátula y metadatos.
# ARGS: URL
# RISK: medium
# PERM: user
# MODE: internal
# Requisitos:
# - Python 3.10+
# - Permisos de usuario.
# - Comandos externos requeridos: ninguno.
# Compatibilidad:
# - Windows 10/11.

import platform
import shutil as _shutil_runtime
import sys
from pathlib import Path

def validate_runtime():
    if platform.system() != "Windows":
        print("[X] Este script solo es compatible con Windows 10/11.", file=sys.stderr)
        sys.exit(1)

import os
import subprocess
import urllib.request
import zipfile
from urllib.error import URLError

if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.console_io import configure_console_utf8
configure_console_utf8(line_buffering=True)

EXIT_OK = 0
EXIT_USER_ERROR = 1
EXIT_NETWORK_ERROR = 2
EXIT_DEPENDENCY_ERROR = 3
EXIT_RUNTIME_ERROR = 4

try:
    if sys.stdout is None or getattr(sys.stdout, "name", "").upper() == "NUL":
        sys.stdout = open("CONOUT$", "w", encoding="utf-8")
        sys.stderr = open("CONOUT$", "w", encoding="utf-8")
        sys.stdin = open("CONIN$", "r", encoding="utf-8")
except OSError:
    pass

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except OSError:
        pass


def run_command(cmd, context):
    try:
        result = subprocess.run(cmd, check=True)
        return {"ok": True, "result": result, "return_code": result.returncode}
    except subprocess.CalledProcessError as exc:
        print(f"[X] Error ejecutando {context}.")
        print(f"    Comando: {' '.join(cmd)}")
        print(f"    Código de salida: {exc.returncode}")
        return {"ok": False, "error": exc, "return_code": exc.returncode}


def run():
    print("==========================================================")
    print("        🎵 EXTRACTOR MAESTRO DE AUDIO MP3 (320kbps) 🎵")
    print("==========================================================")

    if len(sys.argv) < 2:
        print("[!] ERROR: No ingresaste ninguna URL.")
        print("  -> Por favor, introduce la URL del video en la casilla.")
        return EXIT_USER_ERROR

    url = sys.argv[1]
    music_path = str(Path.home() / "Music")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    yt_dlp_exe = os.path.join(script_dir, "yt-dlp.exe")
    ffmpeg_exe = os.path.join(script_dir, "ffmpeg.exe")

    # 1. Verificar o Instalar yt-dlp
    if not os.path.exists(yt_dlp_exe):
        print("\n[*] Configurando el motor de extracción (yt-dlp)...")
        print("    Descargando componentes necesarios desde GitHub...")
        download_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        tmp_yt_dlp_exe = f"{yt_dlp_exe}.tmp"
        try:
            import socket
            socket.setdefaulttimeout(30)
            urllib.request.urlretrieve(download_url, tmp_yt_dlp_exe)
            os.replace(tmp_yt_dlp_exe, yt_dlp_exe)
            print("[+] ¡Motor principal configurado correctamente!")
        except URLError as err:
            print(f"[X] Fallo de red al instalar motor: {err}")
            return EXIT_NETWORK_ERROR
        except OSError as err:
            print(f"[X] Fallo de sistema al instalar motor: {err}")
            return EXIT_RUNTIME_ERROR
        finally:
            if os.path.exists(tmp_yt_dlp_exe):
                os.remove(tmp_yt_dlp_exe)

    # 2. Verificar o Instalar FFmpeg (Requerido para convertir a MP3 HQ y meter carátulas)
    ffmpeg_valido = False
    if os.path.exists(ffmpeg_exe):
        ffmpeg_check = run_command([ffmpeg_exe, "-version"], "la validación de FFmpeg")
        if ffmpeg_check["ok"]:
            ffmpeg_valido = True
        else:
            print("\n[*] Advertencia: FFmpeg está dañado o incompleto. Reinstalando...")
            try:
                os.remove(ffmpeg_exe)
            except OSError as err:
                print(f"[X] No se pudo eliminar FFmpeg inválido: {err}")
                return EXIT_RUNTIME_ERROR

    if not ffmpeg_valido:
        print("\n[*] FFmpeg es necesario para conversión de alta fidelidad. Descargando...")
        ffmpeg_url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        ffmpeg_zip = os.path.join(script_dir, "ffmpeg.zip")
        ffprobe_exe = os.path.join(script_dir, "ffprobe.exe")
        ffmpeg_zip_tmp = f"{ffmpeg_zip}.tmp"
        ffmpeg_tmp = f"{ffmpeg_exe}.tmp"
        ffprobe_tmp = f"{ffprobe_exe}.tmp"

        try:
            urllib.request.urlretrieve(ffmpeg_url, ffmpeg_zip_tmp)
            os.replace(ffmpeg_zip_tmp, ffmpeg_zip)

            extracted = {"ffmpeg.exe": False, "ffprobe.exe": False}
            print("    Extrayendo convertidores multimedia...")
            with zipfile.ZipFile(ffmpeg_zip, "r") as zf:
                for file_info in zf.namelist():
                    if file_info.endswith("ffmpeg.exe"):
                        with zf.open(file_info) as source, open(ffmpeg_tmp, "wb") as target:
                            target.write(source.read())
                        extracted["ffmpeg.exe"] = True
                    elif file_info.endswith("ffprobe.exe"):
                        with zf.open(file_info) as source, open(ffprobe_tmp, "wb") as target:
                            target.write(source.read())
                        extracted["ffprobe.exe"] = True

            if not all(extracted.values()):
                missing = [name for name, ok in extracted.items() if not ok]
                raise OSError(f"Faltan binarios esperados tras extraer: {', '.join(missing)}")

            os.replace(ffmpeg_tmp, ffmpeg_exe)
            os.replace(ffprobe_tmp, ffprobe_exe)
            os.remove(ffmpeg_zip)
            print("[+] ¡Convertidores listos y configurados!")
        except URLError as err:
            print(f"    [X] Error de red instalando FFmpeg: {err}")
            return EXIT_NETWORK_ERROR
        except zipfile.BadZipFile as err:
            print(f"    [X] Archivo de FFmpeg corrupto: {err}")
            return EXIT_DEPENDENCY_ERROR
        except OSError as err:
            print(f"    [X] Error de sistema instalando FFmpeg: {err}")
            return EXIT_RUNTIME_ERROR
        finally:
            for temp_file in (ffmpeg_zip_tmp, ffmpeg_tmp, ffprobe_tmp):
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            if os.path.exists(ffmpeg_zip):
                os.remove(ffmpeg_zip)

    # 3. Descarga y conversión MP3 HQ + Metadatos + Miniatura
    print(f"\n[*] Extrayendo audio desde: {url}")
    print(f"[*] Carpeta de destino: {music_path}")
    print("[*] Formato: MP3 Estéreo de Alta Fidelidad (320kbps constantes)")
    print("[*] Opciones añadidas: Incrustar carátula de álbum e información multimedia.")
    print("\n[~] Iniciando proceso de descarga en segundo plano...\n")

    cmd = [
        yt_dlp_exe,
        "--no-playlist",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "320K",
        "--embed-metadata",
        "--embed-thumbnail",
        "--ffmpeg-location", ffmpeg_exe,
        "--force-overwrites",
        "-o", f"{music_path}/%(title)s.%(ext)s",
        url
    ]

    command_result = run_command(cmd, "la extracción multimedia")
    if not command_result["ok"]:
        print("\n[X] Hubo un error procesando el enlace.")
        print("    Verifica que la URL sea válida y tu conexión a internet sea estable.")
        return EXIT_RUNTIME_ERROR

    print("\n==========================================================")
    print("      🎉 ¡MÚSICA EXTRAÍDA CON ÉXITO A 320kbps MP3! 🎉")
    print("    Incrustados metadatos y carátula del álbum.")
    print(f"    Guardado en tu carpeta: {music_path}")
    print("==========================================================")
    return EXIT_OK


if __name__ == "__main__":
    validate_runtime()
    raise SystemExit(run())
