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


## 🌍 Acceso remoto seguro (sin instalar nada en el dispositivo cliente)

Si quieres entrar desde **cualquier dispositivo** (móvil, tablet, portátil) sin instalar app, la forma recomendada es:

1. **Servidor en tu PC (empaquetado)**
   * Ejecuta tu EXE de Stream Deck Pro en el PC que controlará todo.
   * No necesitas tener VS Code/Visual Studio abiertos: solo la app empaquetada.

2. **Clave privada (token) fuera de GitHub**
   * Define `SECURITY_TOKEN` en `.env` (o en variable de entorno del sistema).
   * `.env` ya está ignorado por Git (`.gitignore`), así que no se sube al repo.
   * Usa un token largo y aleatorio (mínimo 32 caracteres).

3. **Publicar de forma segura (HTTPS + túnel)**
   * No abras puertos “a pelo” en el router.
   * Usa un túnel seguro tipo **Cloudflare Tunnel** o **Tailscale Funnel** para exponer tu `http://localhost:3000` con HTTPS y autenticación adicional.

4. **Login en navegador**
   * Desde cualquier dispositivo, abres la URL HTTPS del túnel.
   * La UI pedirá el token de seguridad al entrar.

### Ejemplo de token seguro
```txt
SECURITY_TOKEN=8Vw!r9vK2mQ#xL1zP4tN7aD@fH3sJ6uB
```

### Buenas prácticas anti-filtración
* Nunca subas `.env` ni pegues tokens en commits, issues o capturas.
* Rota el token si sospechas filtración.
* Mantén firewall activo y limita quién puede acceder al túnel.
* Si vas a exponer por Internet, activa además una capa extra (SSO/IP allowlist) en el proveedor del túnel.

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


## Sistema de Plugins (experimental)

Ahora el backend carga plugins automáticamente desde `plugins/*` al iniciar.

### Estructura mínima

```text
plugins/
  mi-plugin/
    manifest.json
    index.js
```

`manifest.json` requiere:

- `id`
- `apiVersion` (actual: `1`)
- `entry` (archivo JS del plugin)

Además, se expone un endpoint para telemetría básica:

- `GET /api/system/plugins/health`
- `POST /api/system/plugins/reload`


### Validación de plugins (pre-flight)

Antes de arrancar o empaquetar, puedes validar manifests y entrypoints:

```bash
npm run plugin:validate
```


### Quality Gates recomendados (CI)

Pipeline mínimo recomendado para plugins:

1. `npm run plugin:validate`
2. `npm test`
3. `npm run check`

Este flujo está automatizado en `.github/workflows/plugin-quality.yml`.


### Scaffolding de nuevos plugins

Para crear un plugin base listo para editar:

```bash
npm run plugin:create -- mi-nuevo-plugin
```

Luego valida y prueba:

```bash
npm run plugin:validate
npm test
```


### Capabilities permitidas

Para endurecer seguridad, los plugins solo pueden declarar capacidades de esta allowlist:

- `logging`
- `http`
- `iot`
- `audio`
- `discord`
- `automation`


### Política anti-fallos repetidos

El runtime marca plugins con estado `failed` cuando fallan, y tras superar el umbral (`maxFailures`, por defecto `3`) pasan a estado `blocked` para evitar bucles de fallo continuos en cada arranque.
