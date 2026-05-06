# Scripts 03_Seguridad

## SO soportado
- Windows 10/11.

## Dependencias externas
- `arp` y `ping` para descubrimiento de red (`Cazador_Intrusos.py`).
- `cryptography` (auto-instalable en cifrador/descifrador).
- `pillow` (auto-instalable en `Destructor_metadatos.py`).

## Ejemplo de uso
```bash
python Cazador_Intrusos.py
python Revisor_Puertos_Abiertos.py
python Cifrador_De_Carpetas.py "C:\Ruta\Carpeta" "MiClave"
python descifrador.py "C:\Ruta\archivo.png" "MiClave"
```

## Parámetros
- `Panic_Button.py`: sin parámetros.
- `MAC_Spoofer.py`: sin parámetros.
- `Revisor_Puertos_Abiertos.py`: sin parámetros.
- `Cazador_Intrusos.py`: sin parámetros.
- `Identidad_Falsa.py`: sin parámetros.
- `Destructor_metadatos.py <ruta_carpeta>`.
- `Cifrador_De_Carpetas.py <ruta_carpeta> <contraseña>`.
- `descifrador.py <archivo_cifrado> <contraseña>`.
