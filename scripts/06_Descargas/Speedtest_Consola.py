import os
import sys
import time
import socket
import urllib.request
import urllib.error

# Configurar path para importar utilidades comunes
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from common.console_io import configure_console_utf8
from common.console_ui import info, success, error, step

def draw_progress_bar(percent, speed_mbps, prefix='Descarga'):
    """Dibuja una barra de progreso limpia con Mbps en tiempo real."""
    bar_width = 25
    filled_len = int(bar_width * percent // 100)
    bar = '█' * filled_len + '░' * (bar_width - filled_len)
    sys.stdout.write(f"\r[~] {prefix:<8}: [{bar}] {percent:3d}% | {speed_mbps:6.1f} Mbps")
    sys.stdout.flush()

def test_latency():
    """Mide la latencia de red (Ping) conectando a DNS público de Cloudflare."""
    step("Midiendo latencia (Ping)...")
    host = "1.1.1.1"
    port = 53
    times = []
    
    for _ in range(5):
        try:
            start_time = time.perf_counter()
            s = socket.create_connection((host, port), timeout=2.0)
            end_time = time.perf_counter()
            s.close()
            times.append((end_time - start_time) * 1000)
        except Exception:
            pass
        time.sleep(0.05)
        
    if not times:
        return None
    return sum(times) / len(times)

def test_download():
    """Realiza un test de descarga contra Cloudflare."""
    step("Iniciando test de descarga...")
    url = "https://speed.cloudflare.com/__down?bytes=15000000" # 15MB
    chunk_size = 131072 # 128KB chunks
    
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        start_time = time.perf_counter()
        with urllib.request.urlopen(req, timeout=10.0) as response:
            total_bytes = int(response.headers.get('Content-Length', 15000000))
            bytes_read = 0
            
            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                bytes_read += len(chunk)
                current_time = time.perf_counter()
                elapsed = current_time - start_time
                if elapsed > 0:
                    speed_bps = (bytes_read * 8) / elapsed
                    speed_mbps = speed_bps / 1_000_000
                    percent = int((bytes_read / total_bytes) * 100)
                    draw_progress_bar(percent, speed_mbps, 'Descarga')
            
            end_time = time.perf_counter()
            print() # Nueva línea al acabar la barra
            
            elapsed = end_time - start_time
            if elapsed > 0:
                final_speed = (bytes_read * 8) / elapsed / 1_000_000
                return final_speed
    except Exception as e:
        print()
        error(f"Error en descarga: {e}")
    return 0.0

def test_upload():
    """Realiza un test de subida contra Cloudflare."""
    step("Iniciando test de subida...")
    url = "https://speed.cloudflare.com/__up"
    data_size = 4000000 # 4MB data
    dummy_data = b'x' * data_size
    
    try:
        start_time = time.perf_counter()
        
        # Mapeamos la subida leyendo trozos ficticios
        req = urllib.request.Request(
            url,
            data=dummy_data,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Content-Type': 'application/octet-stream'
            },
            method='POST'
        )
        
        # Simulamos barra de progreso de subida rápida
        for p in range(0, 101, 10):
            draw_progress_bar(p, 0.0, 'Subida')
            time.sleep(0.04)
            
        with urllib.request.urlopen(req, timeout=10.0) as response:
            response.read() # Consumir respuesta
            
        end_time = time.perf_counter()
        print() # Nueva línea al acabar la barra
        
        elapsed = end_time - start_time
        if elapsed > 0:
            final_speed = (data_size * 8) / elapsed / 1_000_000
            return final_speed
    except Exception as e:
        print()
        error(f"Error en subida: {e}")
    return 0.0

def main():
    configure_console_utf8(line_buffering=True)
    
    print("=" * 60)
    print("⚡  STREAM DECK SPEEDTEST — TEST DE VELOCIDAD DE INTERNET  ⚡")
    print("=" * 60)
    
    # 1. Latencia (Ping)
    latency = test_latency()
    if latency is not None:
        success(f"Latencia media (Ping): {latency:.1f} ms")
    else:
        error("No se pudo medir la latencia.")
        latency = 0.0
        
    print()
    
    # 2. Descarga
    download_speed = test_download()
    if download_speed > 0:
        success(f"Velocidad de descarga final: {download_speed:.2f} Mbps")
    else:
        error("No se pudo completar el test de descarga.")
        
    print()
    
    # 3. Subida
    upload_speed = test_upload()
    if upload_speed > 0:
        success(f"Velocidad de subida final: {upload_speed:.2f} Mbps")
    else:
        error("No se pudo completar el test de subida.")
        
    print()
    
    # 4. Resumen Visual Premium
    print("=" * 60)
    print("📊  RESULTADOS DE TU CONEXIÓN:")
    print("=" * 60)
    
    # Latencia calificada
    lat_quality = "Excelente" if latency < 20 else "Buena" if latency < 50 else "Regular" if latency < 100 else "Mala"
    print(f"🌐 Latencia:  {latency:.1f} ms ({lat_quality})")
    
    # Barras de velocidad (escala de 1 bloque = 15 Mbps, máx 35 bloques = 525 Mbps)
    scale = 15
    max_blocks = 35
    
    down_blocks = min(max_blocks, int(download_speed / scale))
    down_bar = '█' * down_blocks + '░' * (max_blocks - down_blocks)
    print(f"📥 Descarga:  {download_speed:.2f} Mbps")
    print(f"              [{down_bar}]")
    
    up_blocks = min(max_blocks, int(upload_speed / scale))
    up_bar = '█' * up_blocks + '░' * (max_blocks - up_blocks)
    print(f"📤 Subida:    {upload_speed:.2f} Mbps")
    print(f"              [{up_bar}]")
    
    print("=" * 60)
    print("[V] Test de velocidad completado exitosamente.")
    time.sleep(2)

if __name__ == "__main__":
    main()
