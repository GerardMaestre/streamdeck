# 🚀 Stream Deck Pro

**Stream Deck Pro** es una solución avanzada de centro de mando táctico diseñada para entusiastas de la productividad, gamers y streamers. Permite controlar tu PC, audio, Discord y domótica desde cualquier tablet o dispositivo móvil con una interfaz premium y ultra-rápida.

![Estado](https://img.shields.io/badge/Estado-Operativo-success?style=for-the-badge)
![Tecnología](https://img.shields.io/badge/Stack-Node.js%20%7C%20Electron%20%7C%20Socket.io-blue?style=for-the-badge)

## ✨ Características Principales

### 🎧 Integración Elite con Discord
*   **Mezclador de Voz:** Controla el volumen individual de cada usuario en tu canal.
*   **Indicadores Visuales:** Visualiza quién está hablando en tiempo real con anillos de iluminación.
*   **Controles Tácticos:** Botones gigantes para Mute y Deaf con fallback automático a macros si falla la conexión RPC.

### 🎚️ Mezclador de Audio Universal
*   Control total sobre el volumen maestro y de aplicaciones individuales (Spotify, Chrome, juegos, etc.).
*   Iconografía dinámica que detecta automáticamente la aplicación activa.
*   Sincronización bidireccional instantánea.

### 💡 Domótica (Tuya Smart)
*   Enciende/Apaga luces y dispositivos compatibles con Tuya desde la tablet.
*   Gestión de escenas y estados de dispositivos.

### 🖱️ AutoClicker & Automatización
*   AutoClicker integrado con limitación por monitor y configuración de velocidad.
*   Ejecución de scripts dinámicos (Python, Batch, PowerShell) categorizados por carpetas.
*   Macros complejas y lanzamiento de aplicaciones (YouTube, Spotify, etc.).

## 🛠️ Instalación y Configuración

### Requisitos Previos
*   [Node.js](https://nodejs.org/) (Versión 18 o superior recomendada).
*   [Python](https://www.python.org/) (Para scripts específicos de automatización).

### Pasos
1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/gerardmaestre/streamdeck.git
   cd streamdeck
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar Entorno:**
   Crea un archivo `.env` en la raíz (usa como base los valores proporcionados):
   ```env
   SECURITY_TOKEN=tu_token_seguro
   DISCORD_CLIENT_ID=tu_client_id
   TUYA_ACCESS_KEY=tu_key
   ...
   ```

4. **Configurar Botones:**
   Edita `config.json` para personalizar tus páginas y acciones (puedes usar `config.example.json` como guía).

## 🚀 Uso

### Desarrollo
```bash
npm run dev
```

### Iniciar Aplicación (Modo Bandeja)
```bash
npm start
```

### Empaquetar (EXE)
```bash
npm run build
```

## 🔒 Seguridad
La aplicación utiliza un sistema de **Security Token** para evitar accesos no autorizados desde tu red local. El token debe configurarse en el archivo `.env`.

---
Desarrollado por [Gerard Maestre](https://github.com/gerardmaestre)
