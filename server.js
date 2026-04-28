const { emitErrorToFrontend, getErrorMessage, getDataPath } = require('./backend/utils/utils');
require('dotenv').config({ path: getDataPath('.env'), quiet: true });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

// --- SISTEMA COMPLETO DE LOGS Y DEBUG ---
const Logger = require("./backend/core/logger/logger");
const initErrorTracking = require("./backend/core/logger/error-tracker");
const startPerformanceMonitor = require("./backend/core/logger/performance");
const initSocketMonitoring = require("./backend/core/logger/socket-monitor");

// INIT SYSTEM
console.log('[Server] Inicializando sistema de logs y seguimiento...');
initErrorTracking();
Logger.system("Server starting...");
console.log('[Server] Sistema de logs listo.');

// Importar controladores (Logica modularizada)
const { initAudioMixer, sendInitialState, handleSocketCommands } = require('./backend/audio/audioMixerController');
const { abrirAplicacionOWeb } = require('./backend/launcher/appController');
const { ejecutarMacro, controlMultimedia } = require('./backend/automation/macroController');
const { hacerCaptura } = require('./backend/system/captureController');
const { ejecutarScript, ejecutarScriptDinamico, listarScripts } = require('./backend/scripts/scriptController');
const { initDiscordRPC, requestInitialDiscordState, discordToggleMute, discordToggleDeaf, discordSetUserVolume } = require('./backend/discord/discordController');
const { sendTuyaCommand, controlMultipleDevices } = require('./backend/iot/smart_home');
const { minimizarTodo, cambiarResolucion, apagarPC, reiniciarPC } = require('./backend/system/systemController');

// --- CACHE DE SISTEMA ---
let configCache = null;
let scriptsCache = null;
let lastScriptsUpdate = 0;
const SCRIPTS_CACHE_TTL = 30000; // 30 segundos

// Watcher para config.json (Autoclean cache al editar en disco)
const CONFIG_PATH = getDataPath('config.json');
try {
    fs.watch(CONFIG_PATH, (eventType) => {
        if (eventType === 'change') {
            Logger.info('Configuracion detectada en disco, invalidando cache...');
            configCache = null;
        }
    });
} catch (e) {
    Logger.warn('No se pudo establecer watcher en config.json', e);
}

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server);

process.on('unhandledRejection', (reason) => {
    console.error('[Server] unhandledRejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Server] uncaughtException:', error);
});

// Init logger para Socket y Performance
initSocketMonitoring(io);
startPerformanceMonitor();

// --- SEGURIDAD: TOKEN DE ACCESO ---
const SECURITY_TOKEN = process.env.SECURITY_TOKEN;

if (!SECURITY_TOKEN) {
    console.warn('[Seguridad] SECURITY_TOKEN no definido. El servidor aceptará solo conexiones locales. Define SECURITY_TOKEN en .env o en el entorno para habilitar acceso remoto seguro.');
}

const normalizeAuthToken = (rawToken) => {
    if (!rawToken) return '';
    return rawToken.toString().replace(/^Bearer\s+/i, '').trim();
};

const isLocalAddress = (address) => {
    return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
};

const getSocketToken = (socket) => normalizeAuthToken(socket.handshake.auth?.token);
const getRequestToken = (req) => normalizeAuthToken(req.headers.authorization);

const verifyAccess = (token, isLocal) => {
    if (isLocal) return true;
    if (!SECURITY_TOKEN) return false;
    return token === SECURITY_TOKEN;
};

// Middleware de Socket.io para verificar el token
io.use((socket, next) => {
    const token = getSocketToken(socket);
    const isLocal = isLocalAddress(socket.handshake.address);

    if (verifyAccess(token, isLocal)) {
        return next();
    }
    console.warn(`[!] Intento de conexion rechazada desde ${socket.handshake.address} (Token invalido)`);
    return next(new Error('Acceso denegado: Token de seguridad invalido'));
});

app.use(express.static(getDataPath('frontend')));


// Endpoint para entregar el JSON de configuracion de los botones
app.get('/api/config', (req, res) => {
    // Verificacion de seguridad para la API
    const token = getRequestToken(req);
    const isLocal = isLocalAddress(req.ip);

    if (!verifyAccess(token, isLocal)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
        if (configCache) return res.json(configCache);
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        configCache = JSON.parse(data);
        return res.json(configCache);
    } catch (error) {
        Logger.error('Error leyendo config.json', error);
        return res.status(500).json({ error: 'Error al cargar la configuracion' });
    }
});

// Endpoint para guardar config reordenada (Modo Edicion Tablet)
app.use(express.json({ limit: '1mb' }));
app.post('/api/config', (req, res) => {
    // Verificacion de seguridad para la API
    const token = getRequestToken(req);
    const isLocal = isLocalAddress(req.ip);
    if (!verifyAccess(token, isLocal)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
        const newConfig = req.body;
        if (!newConfig || typeof newConfig !== 'object' || !Array.isArray(newConfig.pages)) {
            return res.status(400).json({ error: 'Payload invalido: "pages" debe ser un array.' });
        }
        if (newConfig.carouselPages !== undefined && !Array.isArray(newConfig.carouselPages)) {
            return res.status(400).json({ error: 'Payload invalido: "carouselPages" debe ser un array.' });
        }

        const configPath = getDataPath('config.json');
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 4), 'utf8');
        configCache = newConfig; // Actualizar cache en memoria
        console.log('[Config] config.json actualizado desde la tablet');
        res.json({ ok: true });
    } catch(err) {
        console.error('Error guardando config.json', err);
        res.status(500).json({ error: 'No se pudo guardar la configuracion.' });
    }
});

// Inicializar audio-mixer con el io del servidor
initAudioMixer(io);
initDiscordRPC(io);

const handleSocketError = (socket, eventName, error, ack) => {
    console.error(`[Error] Error en evento socket [${eventName}]:`, error);
    emitErrorToFrontend(socket, eventName, error);

    if (typeof ack === 'function') {
        ack({ ok: false, message: getErrorMessage(error) });
    }
};

const runSafely = async (socket, eventName, action, ack) => {
    try {
        return await action();
    } catch (error) {
        handleSocketError(socket, eventName, error, ack);
        return null;
    }
};

io.on('connection', (socket) => {
    console.log('[Socket] Centro de mando conectado');
    let aiRequestInFlight = false;

    // Routing de Eventos -> Controladores
    socket.on('mixer_initial_state', async (ack) => {
        await runSafely(socket, 'mixer_initial_state', () => sendInitialState(socket), ack);
    });

    socket.on('mixer_bind_commands', async (ack) => {
        await runSafely(socket, 'mixer_bind_commands', () => handleSocketCommands(socket), ack);
    });

    socket.on('discord_initial_state', async (ack) => {
        await runSafely(socket, 'discord_initial_state', () => requestInitialDiscordState(socket), ack);
    });

    socket.on('abrir', async (destino, ack) => {
        const result = await runSafely(socket, 'abrir', () => abrirAplicacionOWeb(destino), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('macro', async (tipo, ack) => {
        const result = await runSafely(socket, 'macro', () => ejecutarMacro(tipo), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('multimedia', async (accion, ack) => {
        const result = await runSafely(socket, 'multimedia', () => controlMultimedia(accion), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('captura', async (pantalla, ack) => {
        const result = await runSafely(socket, 'captura', () => hacerCaptura(pantalla), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('ejecutar_script', async (scriptId, ack) => {
        const result = await runSafely(socket, 'ejecutar_script', () => ejecutarScript(scriptId, socket), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('ejecutar_script_dinamico', async (payload, ack) => {
        // Si el script requiere parametros pero no han llegado en el payload, los pedimos en el PC
        if (payload.requiresParams && (payload.args === undefined || payload.args === null)) {
            const scriptLabel = payload.archivo ? payload.archivo.replace(/_/g, ' ').replace(/\.[^.]+$/, '') : 'Script';
            
            // Llamamos a la función global de Electron si existe
            if (global.showPCPrompt) {
                console.log(`[Server] Solicitando parametros en PC para: ${scriptLabel}`);
                const pcArgs = await global.showPCPrompt(scriptLabel);
                
                if (pcArgs === null) {
                    console.log('[Server] Prompt cancelado en PC');
                    if (typeof ack === 'function') ack({ ok: false, message: 'Cancelado' });
                    return;
                }
                
                payload.args = pcArgs;
            }
        }

        const result = await runSafely(socket, 'ejecutar_script_dinamico', () => ejecutarScriptDinamico(payload, socket), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    // Discord Sockets
    socket.on('discord_toggle_mute', async (ack) => {
        const result = await runSafely(socket, 'discord_toggle_mute', () => discordToggleMute(), ack);
        if (typeof ack === 'function' && result !== null) ack(result);
    });


    socket.on('discord_toggle_deaf', async (ack) => {
        const result = await runSafely(socket, 'discord_toggle_deaf', () => discordToggleDeaf(), ack);
        if (typeof ack === 'function' && result !== null) ack(result);
    });

    socket.on('discord_set_user_volume', async ({ userId, volume }, ack) => {
        const result = await runSafely(
            socket,
            'discord_set_user_volume',
            () => discordSetUserVolume(userId, volume),
            ack
        );

        if (typeof ack === 'function' && result !== null) ack(result);
    });

    // --- TUYA LIGHT CONTROL ---
    socket.on('tuya_light_toggle', async (payload, ack) => {
        const { deviceId, status } = payload;
        const result = await runSafely(
            socket, 
            'tuya_light_toggle', 
            () => sendTuyaCommand(deviceId, 'switch_led', status),
            ack
        );
        
        if (typeof ack === 'function' && result !== null) {
            ack({ ok: result });
        }
    });

    socket.on('tuya_scene_toggle', async (payload, ack) => {
        const { deviceIds, status } = payload;
        const result = await runSafely(
            socket, 
            'tuya_scene_toggle', 
            () => controlMultipleDevices(deviceIds, 'switch_led', status),
            ack
        );
        
        if (typeof ack === 'function' && result !== null) {
            ack({ ok: result });
        }
    });

    // Nueva ruta para comandos genericos (Ej: Cambiar de escena o brillo)
    socket.on('tuya_command', async (payload, ack) => {
        const { deviceId, deviceIds, code, value } = payload;
        
        const action = async () => {
            if (deviceIds && Array.isArray(deviceIds)) {
                return await controlMultipleDevices(deviceIds, code, value);
            } else {
                return await sendTuyaCommand(deviceId, code, value);
            }
        };

        const result = await runSafely(socket, 'tuya_command', action, ack);
        if (typeof ack === 'function' && result !== null) {
            ack({ ok: result });
        }
    });

    socket.on('minimizar_todo', async (ack) => {
        const result = await runSafely(socket, 'minimizar_todo', () => minimizarTodo(), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('cambiar_resolucion', async (payload, ack) => {
        const { width, height } = payload;
        const result = await runSafely(socket, 'cambiar_resolucion', () => cambiarResolucion(width, height), ack);
        if (typeof ack === 'function') ack(result);
    });

    socket.on('abrir_keep', async (ack) => {
        const result = await runSafely(socket, 'abrir_keep', () => abrirAplicacionOWeb('google-keep'), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('abrir_calendario', async (ack) => {
        const result = await runSafely(socket, 'abrir_calendario', () => abrirAplicacionOWeb('google-calendar'), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('apagar_pc', async (ack) => {
        const result = await runSafely(socket, 'apagar_pc', () => apagarPC(), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('reiniciar_pc', async (ack) => {
        const result = await runSafely(socket, 'reiniciar_pc', () => reiniciarPC(), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('ping', (ack) => {
        if (typeof ack === 'function') ack();
    });

    socket.on('disconnect', () => {
        console.log('[Socket] Centro de mando desconectado');
    });
});

let PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const MAX_PORT_RETRIES = 5;
let portRetries = 0;

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.warn(`[!] Puerto ${PORT} en uso. Intentando puerto ${PORT + 1}...`);
        portRetries += 1;
        if (portRetries > MAX_PORT_RETRIES) {
            console.error(`[Error] No se pudo iniciar el servidor: puerto ${PORT} en uso y se agotaron ${MAX_PORT_RETRIES} reintentos.`);
            process.exit(1);
        } else {
            PORT = PORT + 1;
            setTimeout(() => {
                try {
                    server.listen(PORT);
                } catch (e) {
                    console.error('[Error] Error al reintentar server.listen:', e);
                    process.exit(1);
                }
            }, 200);
        }
        return;
    }
    console.error('[Error] Error en el servidor:', err);
    process.exit(1);
});

server.listen(PORT, () => {
    // Exportar puerto real para que main.js (tray) lo lea
    global.__streamdeck_port = PORT;

    console.log(`
    ---------------------------------------------------
    >>  STREAM DECK PRO -- BACKEND OPERATIVO
    >>  Local:  http://localhost:${PORT}
    >>  Red:    http://0.0.0.0:${PORT}
    ---------------------------------------------------
    `);
});

// Endpoint para listar scripts disponibles en el directorio `scripts`
app.get('/api/scripts', async (req, res) => {
    // Verificacion de seguridad para la API
    const token = getRequestToken(req);
    const isLocal = isLocalAddress(req.ip);

    if (!verifyAccess(token, isLocal)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
        const now = Date.now();
        if (scriptsCache && (now - lastScriptsUpdate < SCRIPTS_CACHE_TTL)) {
            return res.json(scriptsCache);
        }

        const data = await listarScripts();
        scriptsCache = data;
        lastScriptsUpdate = now;
        res.json(data);
    } catch (err) {
        console.error('Error listando scripts', err);
        res.status(500).json({ error: 'No se pudieron listar los scripts.' });
    }
});