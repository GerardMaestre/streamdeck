# Scripts 06_Descargas

## SO soportado
- Windows 10/11.

## Dependencias externas
- `yt-dlp.exe` (descarga automática en `Descargador_Maestro.py`).
- `ffmpeg.exe` (requerido para salida MP3 / algunos formatos).
- `qrcode`/`Pillow` (auto-instalables en `Servidor_Descargar.py`).

## Ejemplo de uso
```bash
python Descargador_Maestro.py "https://youtu.be/xxxx" mp3
python Servidor_Descargar.py "C:\Users\TuUsuario\Downloads" --port 8080
```

## Parámetros
- `Descargador_Maestro.py <url> [mp3|720p|1080p|4k]`.
- `Servidor_Descargar.py <ruta_carpeta> [--port|-p <puerto>]`.
