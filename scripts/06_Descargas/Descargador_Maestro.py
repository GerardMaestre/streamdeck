# DESC: Descarga video o MP3 de más de 1000 sitios. Añade 'mp3' al lado de la URL para bajarlo como audio.
# ARGS: URL [mp3/720p/1080p/4k]
# RISK: medium
# PERM: user
# MODE: internal

import os
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path
from urllib.error import URLError

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
    """Ejecuta comandos de forma consistente y reporta errores uniformes."""
    try:
        result = subprocess.run(cmd, check=True)
        return {"ok": True, "result": result, "return_code": result.returncode}
    except subprocess.CalledProcessError as exc:
        print(f"[X] Error ejecutando {context}.")
        print(f"    Comando: {' '.join(cmd)}")
        print(f"    Código de salida: {exc.returncode}")
        return {"ok": False, "error": exc, "return_code": exc.returncode}


def run():
    print("=== EXTRACTOR MULTI-MEDIA AVANZADO ===")

    if len(sys.argv) < 2:
        print("[!] ERROR: No ingresaste ninguna URL.")
        print("  -> Escribe la URL en la barra de 'Parámetros' (Ej: https://youtu.be/... mp3 o 4k)")
        return EXIT_USER_ERROR

    url = sys.argv[1]
    formato_deseado = sys.argv[2].lower() if len(sys.argv) > 2 else "video"

    downloads_path = str(Path.home() / "Downloads")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    yt_dlp_exe = os.path.join(script_dir, "yt-dlp.exe")
    ffmpeg_exe = os.path.join(script_dir, "ffmpeg.exe")

    if not os.path.exists(yt_dlp_exe):
        print("\n[*] Configurando el motor de extraccion (yt-dlp)...")
        print("    Descargando componentes necesarios desde GitHub...")
        download_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        tmp_yt_dlp_exe = f"{yt_dlp_exe}.tmp"
        try:
            import socket

            socket.setdefaulttimeout(30)
            urllib.request.urlretrieve(download_url, tmp_yt_dlp_exe)
            os.replace(tmp_yt_dlp_exe, yt_dlp_exe)
            print("[+] ¡Motor principal listo!")
        except URLError as err:
            print(f"[X] Fallo de red al instalar motor: {err}")
            return EXIT_NETWORK_ERROR
        except OSError as err:
            print(f"[X] Fallo de sistema al instalar motor: {err}")
            return EXIT_RUNTIME_ERROR
        finally:
            if os.path.exists(tmp_yt_dlp_exe):
                os.remove(tmp_yt_dlp_exe)

    ffmpeg_valido = False
    if os.path.exists(ffmpeg_exe):
        ffmpeg_check = run_command([ffmpeg_exe, "-version"], "la validación de FFmpeg")
        if ffmpeg_check["ok"]:
            ffmpeg_valido = True
        else:
            print("\n[*] Advertencia: La version actual de FFmpeg esta dañada o es incorrecta. Se procedera a reinstalarla.")
            try:
                os.remove(ffmpeg_exe)
            except OSError as err:
                print(f"[X] No se pudo eliminar FFmpeg inválido: {err}")
                return EXIT_RUNTIME_ERROR

    if not ffmpeg_valido:
        print("\n[*] FFmpeg es necesario para MP3 HQ o calidad 1080p/4K. Instalando versión correcta para Windows...")
        ffmpeg_url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        ffmpeg_zip = os.path.join(script_dir, "ffmpeg.zip")
        ffprobe_exe = os.path.join(script_dir, "ffprobe.exe")
        ffmpeg_zip_tmp = f"{ffmpeg_zip}.tmp"
        ffmpeg_tmp = f"{ffmpeg_exe}.tmp"
        ffprobe_tmp = f"{ffprobe_exe}.tmp"
        print("    Descargando ffmpeg (puede demorar un poco dependiendo de tu internet)...")

        try:
            urllib.request.urlretrieve(ffmpeg_url, ffmpeg_zip_tmp)
            os.replace(ffmpeg_zip_tmp, ffmpeg_zip)

            extracted = {"ffmpeg.exe": False, "ffprobe.exe": False}
            print("    Extrayendo ffmpeg.exe y ffprobe.exe...")
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
            print("[+] ¡Convertidor FFmpeg instalado correctamente!")
        except URLError as err:
            print(f"    [X] Aviso: Error de red al instalar FFmpeg automáticamente: {err}")
            return EXIT_NETWORK_ERROR
        except zipfile.BadZipFile as err:
            print(f"    [X] Aviso: ZIP de FFmpeg inválido o corrupto: {err}")
            return EXIT_DEPENDENCY_ERROR
        except OSError as err:
            print(f"    [X] Aviso: Error del sistema al instalar FFmpeg automáticamente: {err}")
            return EXIT_RUNTIME_ERROR
        finally:
            for temp_file in (ffmpeg_zip_tmp, ffmpeg_tmp, ffprobe_tmp):
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            if os.path.exists(ffmpeg_zip):
                os.remove(ffmpeg_zip)

    print(f"\n[*] Analizando enlace: {url}")
    print(f"[*] Destino: {downloads_path}")

    cmd = [yt_dlp_exe, "--no-playlist"]
    if os.path.exists(ffmpeg_exe):
        cmd.extend(["--ffmpeg-location", ffmpeg_exe])

    if "mp3" in formato_deseado or "audio" in formato_deseado:
        print("[*] Modo seleccionado: AUDIO (MP3 a Máxima Calidad - 320 kbps constantes)")
        cmd.extend([
            "-x", "--audio-format", "mp3", "--audio-quality", "320K", "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_Audio.%(ext)s", url,
        ])
    elif "4k" in formato_deseado or "2160" in formato_deseado:
        print("[*] Modo seleccionado: VIDEO (4K / 2160p)")
        cmd.extend([
            "-f", "bestvideo[height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best",
            "--merge-output-format", "mp4", "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_4K.%(ext)s", url,
        ])
    elif "1080" in formato_deseado:
        print("[*] Modo seleccionado: VIDEO (1080p)")
        cmd.extend([
            "-f", "bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best",
            "--merge-output-format", "mp4", "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_1080p.%(ext)s", url,
        ])
    elif "720" in formato_deseado:
        print("[*] Modo seleccionado: VIDEO (720p)")
        cmd.extend([
            "-f", "bestvideo[height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best",
            "--merge-output-format", "mp4", "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_720p.%(ext)s", url,
        ])
    else:
        print("[*] Modo seleccionado: VIDEO (Max. Calidad)")
        cmd.extend([
            "-f", "bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
            "--merge-output-format", "mp4", "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_Max.%(ext)s", url,
        ])

    print("[~] Procesando archivo... (El progreso se mostrará a continuación)\n")
    command_result = run_command(cmd, "la descarga del enlace")
    if not command_result["ok"]:
        print("\n[X] Hubo un error procesando el enlace.")
        print("    Revisa los mensajes de arriba de yt-dlp para ver por qué falló.")
        return EXIT_RUNTIME_ERROR

    print("\n[V] ¡DESCARGA COMPLETADA Y GUARDADA EN DESCARGAS!")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(run())
