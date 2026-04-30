# DESC: Descarga video o MP3 de más de 1000 sitios. Añade 'mp3' al lado de la URL para bajarlo como audio.
# ARGS: URL [mp3/720p/1080p/4k]
# RISK: medium
# PERM: user
# MODE: internal

import sys
try:
    if sys.stdout is None or getattr(sys.stdout, 'name', '').upper() == 'NUL':
        sys.stdout = open('CONOUT$', 'w', encoding='utf-8')
        sys.stderr = open('CONOUT$', 'w', encoding='utf-8')
        sys.stdin = open('CONIN$', 'r', encoding='utf-8')
except Exception: pass

if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    except Exception: pass
import os
import subprocess
import urllib.request
import zipfile
from pathlib import Path

def run():
    print("=== EXTRACTOR MULTI-MEDIA AVANZADO ===")
    
    if len(sys.argv) < 2:
        print("[!] ERROR: No ingresaste ninguna URL.")
        print("  -> Escribe la URL en la barra de 'Parámetros' (Ej: https://youtu.be/... mp3 o 4k)")
        return
        
    url = sys.argv[1]
    formato_deseado = sys.argv[2].lower() if len(sys.argv) > 2 else "video" # por defecto baja el mejor video
    
    # Averiguar carpeta de Descargas del sistema actual
    downloads_path = str(Path.home() / "Downloads")
    
    # Usar ejecutables locales (Deben estar incluidos en el paquete)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    yt_dlp_exe = os.path.join(script_dir, "yt-dlp.exe")
    ffmpeg_exe = os.path.join(script_dir, "ffmpeg.exe")
    
    if not os.path.exists(yt_dlp_exe):
        print("\n[!] ERROR: No se encuentra yt-dlp.exe.")
        print("    Asegúrate de que el ejecutable esté en la carpeta del script.")
        return
            
    # Comprobar si FFmpeg está disponible
    if not os.path.exists(ffmpeg_exe):
        print("\n[!] AVISO: ffmpeg.exe no encontrado.")
        print("    Las descargas de alta calidad y MP3 podrían fallar o ser de baja calidad.")
    
    print(f"\n[*] Analizando enlace: {url}")
    print(f"[*] Destino: {downloads_path}")
    
    cmd = [yt_dlp_exe, "--no-playlist"]
    
    if os.path.exists(ffmpeg_exe):
        cmd.extend(["--ffmpeg-location", ffmpeg_exe])
    
    # Configuración de formatos
    if "mp3" in formato_deseado or "audio" in formato_deseado:
        print("[*] Modo seleccionado: AUDIO (MP3 a Máxima Calidad - 320 kbps constantes)")
        cmd.extend([
            "-x", 
            "--audio-format", "mp3", 
            "--audio-quality", "320K", 
            # Eliminado --embed-thumbnail para evitar problemas con reproductores en Windows que lo tratan como video
            "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_Audio.%(ext)s",
            url
        ])
    elif "4k" in formato_deseado or "2160" in formato_deseado:
        print("[*] Modo seleccionado: VIDEO (4K / 2160p)")
        cmd.extend([
            "-f", "bestvideo[height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best",
            "--merge-output-format", "mp4",
            "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_4K.%(ext)s",
            url
        ])
    elif "1080" in formato_deseado:
        print("[*] Modo seleccionado: VIDEO (1080p)")
        cmd.extend([
            "-f", "bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best",
            "--merge-output-format", "mp4",
            "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_1080p.%(ext)s",
            url
        ])
    elif "720" in formato_deseado:
        print("[*] Modo seleccionado: VIDEO (720p)")
        cmd.extend([
            "-f", "bestvideo[height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best",
            "--merge-output-format", "mp4",
            "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_720p.%(ext)s",
            url
        ])
    else:
        print("[*] Modo seleccionado: VIDEO (Max. Calidad)")
        cmd.extend([
            "-f", "bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
            "--force-overwrites",
            "-o", f"{downloads_path}/%(title)s_Max.%(ext)s",
            url
        ])
    
    print("[~] Procesando archivo... (El progreso se mostrará a continuación)\n")
    try:
        # Se ejecuta sin capturar el output para que puedas ver el progreso y posibles errores en la consola
        subprocess.run(cmd, check=True)
        print("\n[V] ¡DESCARGA COMPLETADA Y GUARDADA EN DESCARGAS!")
    except subprocess.CalledProcessError as e:
        print("\n[X] Hubo un error procesando el enlace.")
        print("    Revisa los mensajes de arriba de yt-dlp para ver por qué falló.")

if __name__ == "__main__":
    run()