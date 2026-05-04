const { emitErrorToFrontend, getErrorMessage, getDataPath } = require('./backend/utils/utils');
const fs = require('fs');
const path = require('path');
const { app: electronApp } = require('electron');
const { loadAllEnvs, validateEnvContract } = require('./backend/core/config/bootstrap');

loadAllEnvs({ electronApp, source: 'server' });
const envContract = validateEnvContract();
if (envContract.missingRequired.length) {
    console.warn('[Config] Variables obligatorias faltantes:', envContract.missingRequired.join(', '));
}
// 1. IMPORTS
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const compression = require('compression');
const { appStateStore } = require('./backend/data/state-store');
const Logger = require("./backend/core/logger/logger");
const { PluginManager } = require('./backend/core/plugins/pluginManager');
const { appendAdminAudit } = require('./backend/core/plugins/adminAudit');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const allowedCorsOrigins = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    process.env.LAN_FRONTEND_ORIGIN,
    process.env.FRONTEND_ORIGIN,
].filter(Boolean));

const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    return allowedCorsOrigins.has(origin);
};

const logRejectedOrigin = (context, origin) => {
    const serializedOrigin = origin || '(sin origin header)';
    Logger.warn(`[CORS] Origen rechazado en ${context}: ${serializedOrigin}`);
};

const resolveCorsOrigin = (origin, context) => {
    if (isAllowedOrigin(origin)) {
        return origin || null;
    }
    logRejectedOrigin(context, origin);
    return null;
};

app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    const requestOrigin = req.headers.origin;
    const allowedOrigin = resolveCorsOrigin(requestOrigin, `HTTP ${req.method} ${req.originalUrl || req.url}`);

    if (allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return allowedOrigin ? res.sendStatus(200) : res.sendStatus(403);
    }

    if (requestOrigin && !allowedOrigin) {
        return res.status(403).json({ error: 'Origen no permitido por política CORS.' });
    }

    next();
});
app.use(compression());
app.use(express.json({ limit: '1mb' }));


const requireAdminToken = (req, res, next) => {
    const configuredToken = process.env.SECURITY_TOKEN;
    if (!configuredToken) return next();

    const provided = req.headers['x-security-token'];
    if (provided !== configuredToken) {
        return res.status(401).json({ error: 'Token inválido para endpoint administrativo.' });
    }

    next();
};


const adminRateWindowMs = 60 * 1000;
const adminRateMax = 20;
const adminRateMap = new Map();

const adminRateLimit = (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = adminRateMap.get(ip) || { count: 0, startedAt: now };

    if (now - bucket.startedAt > adminRateWindowMs) {
        bucket.count = 0;
        bucket.startedAt = now;
    }

    bucket.count += 1;
    adminRateMap.set(ip, bucket);

    if (bucket.count > adminRateMax) {
        return res.status(429).json({ error: 'Demasiadas solicitudes administrativas. Intenta en 1 minuto.' });
    }

    next();
};

const pluginManager = new PluginManager({
    pluginsDir: getDataPath('plugins'),
    healthFilePath: getDataPath('plugins-health.json'),
});
pluginManager.loadAll();

const shutdownPluginSystem = () => {
    try {
        pluginManager.unloadAll();
    } catch (error) {
        Logger.warn('[Plugins] Error durante unloadAll', error.message);
    }
};

process.on('beforeExit', shutdownPluginSystem);
process.on('SIGINT', shutdownPluginSystem);
process.on('SIGTERM', shutdownPluginSystem);






app.post('/api/system/plugins/:pluginId/unblock', adminRateLimit, requireAdminToken, (req, res) => {
    const pluginId = req.params.pluginId;
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!pluginId) {
        appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'unblock', ip, ok: false, detail: 'missing pluginId' });
        return res.status(400).json({ error: 'pluginId es obligatorio' });
    }

    pluginManager.resetPluginState(pluginId);
    const loaded = pluginManager.loadAll();

    appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'unblock', ip, pluginId, ok: true });

    return res.json({
        ok: true,
        pluginId,
        loaded,
        summary: pluginManager.getSummary(),
    });
});

app.post('/api/system/plugins/reload', adminRateLimit, requireAdminToken, (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const loaded = pluginManager.reloadAll();
    appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'reload', ip, ok: true, detail: `loaded=${loaded}` });
    res.json({
        ok: true,
        loaded,
        summary: pluginManager.getSummary(),
    });
});

app.get('/api/system/plugins/health', (_req, res) => {
    res.json({
        apiVersion: 1,
        plugins: pluginManager.getHealthSnapshot(),
        summary: pluginManager.getSummary(),
        registry: pluginManager.getRegistrySnapshot(),
    });
});



// --- SISTEMA COMPLETO DE LOGS Y DEBUG ---
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
const { ejecutarScript, ejecutarScriptDinamico, listarScripts, stopAllRunningScripts } = require('./backend/scripts/scriptController');
const { initDiscordRPC, requestInitialDiscordState, discordToggleMute, discordToggleDeaf, discordSetUserVolume, forceDiscordReconnect } = require('./backend/discord/discordController');
const { sendTuyaCommand, controlMultipleDevices } = require('./backend/iot/smart_home');
const { minimizarTodo, cambiarResolucion, apagarPC, reiniciarPC } = require('./backend/system/systemController');
const { handleAutoClickerSocket } = require('./backend/automation/autoClickerController');

const ensurePackagedBootstrapFiles = () => {
    if (!(electronApp && electronApp.isPackaged)) return;

    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
    const userDataDir = electronApp.getPath('userData');

    const copyIfMissing = (fromPath, toPath) => {
        try {
            if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) return;
            fs.mkdirSync(path.dirname(toPath), { recursive: true });
            fs.copyFileSync(fromPath, toPath);
            Logger.info(`[Bootstrap] Archivo inicial creado: ${toPath}`);
        } catch (error) {
            Logger.warn(`[Bootstrap] No se pudo preparar ${toPath}`, error.message);
        }
    };

    copyIfMissing(path.join(process.resourcesPath, '.env.example'), path.join(userDataDir, '.env'));
    copyIfMissing(path.join(process.resourcesPath, '.env.example'), path.join(exeDir, '.env'));
    copyIfMissing(path.join(process.resourcesPath, 'config.example.json'), path.join(userDataDir, 'config.json'));
};

ensurePackagedBootstrapFiles();



// --- CACHE DE SISTEMA ---
let configCache = null;
let scriptsCache = null;
let lastScriptsUpdate = 0;
const SCRIPTS_CACHE_TTL = 120000; // 120 segundos (2 minutos)

// Watcher para config.json (Autoclean cache al editar en disco)
const CONFIG_PATH = getDataPath('config.json');

// INIT: Asegurar que config.json existe. Si no, copiar la plantilla empaquetada.
if (!fs.existsSync(CONFIG_PATH)) {
    try {
        const fallbackPath = getDataPath('backend/data/defaultConfig.json');
        if (fs.existsSync(fallbackPath)) {
            fs.copyFileSync(fallbackPath, CONFIG_PATH);
            Logger.info(`[Config] Plantilla defaultConfig.json restaurada en ${CONFIG_PATH}`);
        }
    } catch (e) {
        Logger.warn('[Config] No se pudo restaurar la plantilla defaultConfig.json', e);
    }
}

// Merge con la plantilla empaquetada para asegurar que no falten nuevos botones/páginas
try {
    const fallbackPath = getDataPath('backend/data/defaultConfig.json');
    if (fs.existsSync(fallbackPath) && fs.existsSync(CONFIG_PATH)) {
        const defaultConfig = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        const existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        let changed = false;

        if (existingConfig && existingConfig.pages) {
            for (const pageName of Object.keys(defaultConfig.pages)) {
                if (!existingConfig.pages[pageName]) {
                    existingConfig.pages[pageName] = defaultConfig.pages[pageName];
                    changed = true;
                } else {
                    const existingLabels = new Set(existingConfig.pages[pageName].map(b => b.label));
                    for (const defaultBtn of defaultConfig.pages[pageName]) {
                        if (!existingLabels.has(defaultBtn.label)) {
                            existingConfig.pages[pageName].push(defaultBtn);
                            changed = true;
                        }
                    }
                }
            }
            if (Array.isArray(defaultConfig.carouselPages)) {
                if (!Array.isArray(existingConfig.carouselPages)) {
                    existingConfig.carouselPages = defaultConfig.carouselPages;
                    changed = true;
                } else {
                    for (const cp of defaultConfig.carouselPages) {
                        if (!existingConfig.carouselPages.includes(cp)) {
                            existingConfig.carouselPages.push(cp);
                            changed = true;
                        }
                    }
                }
            }
        }
        if (changed) {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 4), 'utf8');
            Logger.info(`[Config] config.json se ha actualizado y combinado con las novedades de defaultConfig.json`);
        }
    }
} catch (err) {
    Logger.warn('[Config] Error al fusionar config.json con las novedades', err.message);
}

try {
    let configTimeout;

    fs.watch(CONFIG_PATH, { persistent: false }, () => {
        clearTimeout(configTimeout);
        configTimeout = setTimeout(() => {
            configCache = null;
        }, 300);
    });
} catch (e) {
    Logger.warn('No se pudo establecer watcher en config.json', e);
}

const badAuthAttempts = new Map();
const blockedIps = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const AUTH_BLOCK_THRESHOLD = 20;
const AUTH_BLOCK_DURATION_MS = 15 * 60 * 1000;

const cleanupIpData = () => {
    const now = Date.now();
    for (const [ip, data] of blockedIps.entries()) {
        if (now - data.blockedAt > AUTH_BLOCK_DURATION_MS) {
            blockedIps.delete(ip);
        }
    }
    for (const [ip, data] of badAuthAttempts.entries()) {
        if (now - data.lastAttempt > RATE_LIMIT_WINDOW_MS) {
            badAuthAttempts.delete(ip);
        }
    }
};
const cleanupTimer = setInterval(cleanupIpData, 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

const rateLimiter = (req, res, next) => {
    // Solo aplicamos el rate limit a rutas de API autenticadas.
    // La carga normal de HTML/CSS/JS/imagenes no debe disparar bloqueos
    // en tablet o en redes con más peticiones iniciales.
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (blockedIps.has(ip)) {
        return res.status(429).json({ error: 'Demasiadas peticiones. Intenta más tarde.' });
    }

    const now = Date.now();
    const entry = badAuthAttempts.get(ip) || { count: 0, firstRequest: now, lastAttempt: now };

    if (now - entry.firstRequest > RATE_LIMIT_WINDOW_MS) {
        entry.count = 0;
        entry.firstRequest = now;
    }

    entry.count += 1;
    entry.lastAttempt = now;
    badAuthAttempts.set(ip, entry);

    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
        blockedIps.set(ip, { blockedAt: now });
        return res.status(429).json({ error: 'Demasiadas peticiones. Intenta más tarde.' });
    }

    next();
};

app.use(rateLimiter);

let server;
const sslKeyPath = process.env.SSL_KEY_PATH || 'ssl/key.pem';
const sslCertPath = process.env.SSL_CERT_PATH || 'ssl/cert.pem';
let secureProtocol = false;

if (fs.existsSync(getDataPath(sslKeyPath)) && fs.existsSync(getDataPath(sslCertPath))) {
    try {
        const sslOptions = {
            key: fs.readFileSync(getDataPath(sslKeyPath), 'utf8'),
            cert: fs.readFileSync(getDataPath(sslCertPath), 'utf8')
        };
        server = https.createServer(sslOptions, app);
        secureProtocol = true;
        console.log('[Server] HTTPS/WSS habilitado usando certificados SSL.');
    } catch (err) {
        console.error('[Server] Error cargando certificados SSL:', err);
        server = http.createServer(app);
    }
} else {
    server = http.createServer(app);
}

const io = new Server(server, {
  transports: ['websocket'],
  perMessageDeflate: false,
  pingInterval: 25000,
  pingTimeout: 60000,
  cors: {
      origin: (origin, callback) => {
          const allowedOrigin = resolveCorsOrigin(origin, 'Socket.IO handshake');
          if (!origin || allowedOrigin) {
              return callback(null, allowedOrigin || true);
          }
          return callback(new Error('Origen no permitido por política CORS.'));
      },
      credentials: true,
  },
});

io.engine.maxHttpBufferSize = 1e6;

process.on('unhandledRejection', (reason) => {
    console.error('[Server] unhandledRejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Server] uncaughtException:', error);
});

// Init logger para Socket y Performance
const IS_DEV = process.env.NODE_ENV !== 'production';

// Siempre habilitar monitoreo en esta fase de depuración de producción
initSocketMonitoring(io);
startPerformanceMonitor();

const log = (...args) => {
    console.log(...args);
};

const errorLog = (...args) => {
    console.error(...args);
};

// --- SEGURIDAD: TOKEN DE ACCESO ---
const SECURITY_TOKEN_FILE = getDataPath('security-token.txt');

const loadTokenFromFile = () => {
    try {
        if (!fs.existsSync(SECURITY_TOKEN_FILE)) return '';
        return fs.readFileSync(SECURITY_TOKEN_FILE, 'utf8').trim();
    } catch (error) {
        Logger.warn('[Seguridad] No se pudo leer security-token.txt', error);
        return '';
    }
};

const saveTokenToFile = (token) => {
    try {
        fs.writeFileSync(SECURITY_TOKEN_FILE, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
        return true;
    } catch (error) {
        Logger.error('[Seguridad] No se pudo guardar security-token.txt', error);
        return false;
    }
};

const envSecurityToken = (process.env.SECURITY_TOKEN || '').trim();
const fileSecurityToken = loadTokenFromFile();
const masterFallbackToken = 'CasaGerard';

let ACTIVE_SECURITY_TOKEN = envSecurityToken || fileSecurityToken || masterFallbackToken;

if (envSecurityToken && fileSecurityToken && envSecurityToken !== fileSecurityToken) {
    Logger.warn('[Seguridad] SECURITY_TOKEN del entorno tiene prioridad sobre security-token.txt.');
}

if (!ACTIVE_SECURITY_TOKEN) {
    console.warn('[Seguridad] Token no configurado. Solo se aceptarán conexiones locales hasta crear uno.');
} else if (ACTIVE_SECURITY_TOKEN === masterFallbackToken && !envSecurityToken && !fileSecurityToken) {
    Logger.info('[Seguridad] Usando contraseña maestra preconfigurada (CasaGerard).');
}

const normalizeAuthToken = (rawToken) => {
    if (!rawToken) return '';
    return rawToken.toString().replace(/^Bearer\s+/i, '').trim();
};

const isLocalAddress = (address) => {
    return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
};

const registerBadAuthAttempt = (ip) => {
    if (!ip) return;
    const now = Date.now();
    const entry = badAuthAttempts.get(ip) || { count: 0, firstRequest: now, lastAttempt: now };
    entry.count += 1;
    entry.lastAttempt = now;
    badAuthAttempts.set(ip, entry);
    if (entry.count >= AUTH_BLOCK_THRESHOLD) {
        blockedIps.set(ip, { blockedAt: now });
    }
};

const getSocketToken = (socket) => normalizeAuthToken(socket.handshake.auth?.token);
const getRequestToken = (req) => normalizeAuthToken(req.headers.authorization);

const verifyAccess = (token, isLocal) => {
    if (isLocal) return true;
    
    const inputToken = (token || '').trim();
    if (!inputToken) return false;

    // 1. Verificación contra el token configurado (Env o Archivo)
    if (ACTIVE_SECURITY_TOKEN && inputToken === ACTIVE_SECURITY_TOKEN) return true;
    
    // 2. Verificación contra la Contraseña Maestra (Hardcoded)
    // Somos un poco más permisivos con la maestra (ignoramos mayúsculas/espacios) 
    // para evitar frustraciones en tablets, pero mantenemos la seguridad.
    const masterToken = 'CasaGerard';
    const normalizedInput = inputToken.toLowerCase().replace(/\s+/g, '');
    const normalizedMaster = masterToken.toLowerCase();

    if (normalizedInput === normalizedMaster) return true;

    if (IS_DEV) {
        console.log(`[Auth Debug] Token mismatch detectado. Recibido: "${inputToken}"`);
    }
    return false;
};

const ensureAuthorizedRequest = (req, res) => {
    const token = getRequestToken(req);
    const isLocal = isLocalAddress(req.ip);
    if (verifyAccess(token, isLocal)) return true;
    registerBadAuthAttempt(req.ip);
    Logger.warn(`[Auth] Acceso denegado en ${req.method} ${req.path} desde ${req.ip}`);
    res.setHeader('WWW-Authenticate', 'Bearer realm="StreamDeckPro"');
    res.status(403).json({ error: 'Acceso denegado' });
    return false;
};

// Middleware de Socket.io para verificar el token
io.use((socket, next) => {
    const token = getSocketToken(socket);
    const isLocal = isLocalAddress(socket.handshake.address);

    if (verifyAccess(token, isLocal)) {
        return next();
    }
    registerBadAuthAttempt(socket.handshake.address);
    console.warn(`[!] Intento de conexion rechazada desde ${socket.handshake.address} (Token invalido)`);
    return next(new Error('Acceso denegado: Token de seguridad invalido'));
});


app.get('/api/security/status', (req, res) => {
    const isLocal = isLocalAddress(req.ip);
    if (!isLocal) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    return res.json({
        tokenConfigured: Boolean(ACTIVE_SECURITY_TOKEN),
        source: envSecurityToken ? 'env' : (fileSecurityToken ? 'file' : 'none')
    });
});

app.post('/api/security/token', (req, res) => {
    const isLocal = isLocalAddress(req.ip);
    if (!isLocal) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    if (envSecurityToken) {
        return res.status(409).json({ error: 'SECURITY_TOKEN está fijado por entorno y no puede cambiarse desde API.' });
    }

    const token = normalizeAuthToken(req.body?.token);
    if (!token || token.length < 12) {
        return res.status(400).json({ error: 'El token debe tener al menos 12 caracteres.' });
    }

    if (!saveTokenToFile(token)) {
        return res.status(500).json({ error: 'No se pudo persistir el token.' });
    }

    ACTIVE_SECURITY_TOKEN = token;
    return res.json({ ok: true });
});

// Dynamic service worker route: inject build timestamp for cache busting
const SERVER_START_TS = Date.now().toString(36);
let cachedIndexContent = null;
let cachedSwContent = null;

const invalidateFrontendCache = () => {
    cachedIndexContent = null;
    cachedSwContent = null;
};

try {
    const frontendRoot = getDataPath('frontend');
    fs.watch(frontendRoot, { recursive: true, persistent: false }, () => {
        invalidateFrontendCache();
    });
} catch (e) {
    Logger.warn('No se pudo establecer watcher en frontend para invalidar cache', e);
}
// Dynamic index.html route for cache busting
app.get(['/', '/index.html'], async (req, res) => {
    const indexPath = getDataPath('frontend/index.html');
    try {
        if (!cachedIndexContent) {
            const raw = await fs.promises.readFile(indexPath, 'utf8');
            cachedIndexContent = raw
                .replace(/dist\/app\.bundle\.js(\?v=[^\s"']*)?/g, `dist/app.bundle.js?v=${SERVER_START_TS}`)
                .replace(/\.css(\?v=[^\s"']*)?/g, `.css?v=${SERVER_START_TS}`);
        }
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(cachedIndexContent);
    } catch (err) {
        res.status(500).send('Error loading index.html');
    }
});

app.get('/sw.js', async (req, res) => {
    const swPath = getDataPath('frontend/sw.js');
    try {
        if (!cachedSwContent) {
            const raw = await fs.promises.readFile(swPath, 'utf8');
            cachedSwContent = raw.replace('__BUILD_TS__', SERVER_START_TS);
        }
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.send(cachedSwContent);
    } catch (err) {
        res.status(500).send('// SW load error');
    }
});

app.use(express.static(getDataPath('frontend'), {
    etag: true,
    lastModified: true,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
            return;
        }
        if (/\.(?:js|css|png|svg|ico|webp|woff2?)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
        }
    }
}));

// Endpoint para entregar el JSON de configuracion de los botones
app.get('/api/config', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;

    try {
        if (configCache) {
            res.setHeader('Cache-Control', 'no-store');
            return res.json(configCache);
        }

        let config;
        try {
            const data = await fs.promises.readFile(CONFIG_PATH, 'utf8');
            config = JSON.parse(data);
        } catch (error) {
            Logger.warn('Error leyendo o parseando config.json, usando config por defecto', error.message);
            config = { pages: { main: [] }, carouselPages: ["main"] };
        }

        configCache = config;
        return res.json(configCache);
    } catch (err) {
        Logger.error('Error imprevisto en /api/config', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para guardar config reordenada (Modo Edicion Tablet)
app.post('/api/config', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;

    try {
        const newConfig = req.body;

        if (!newConfig || typeof newConfig !== 'object' || !Array.isArray(newConfig.pages)) {
            return res.status(400).json({ error: 'Payload invalido: "pages" debe ser un array.' });
        }

        if (newConfig.carouselPages !== undefined && !Array.isArray(newConfig.carouselPages)) {
            return res.status(400).json({ error: 'Payload invalido: "carouselPages" debe ser un array.' });
        }

        const configPath = getDataPath('config.json');

        await fs.promises.writeFile(
            configPath,
            JSON.stringify(newConfig, null, 4),
            'utf8'
        );

        configCache = newConfig;
        log('[Config] config.json actualizado desde la tablet');

        return res.json({ ok: true });
    } catch (err) {
        errorLog('Error guardando config.json', err);
        return res.status(500).json({ error: 'No se pudo guardar la configuracion.' });
    }
});

app.get('/api/app-state', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;

    try {
        return res.json(appStateStore.get() || {});
    } catch (err) {
        Logger.error('Error leyendo el estado persistido', err);
        return res.status(500).json({ error: 'No se pudo recuperar el estado' });
    }
});

app.post('/api/app-state', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;

    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object') {
            return res.status(400).json({ error: 'Payload invalido' });
        }

        if (payload.ui && typeof payload.ui === 'object') {
            appStateStore.merge('ui', payload.ui);
        }
        if (payload.persistedMixer && typeof payload.persistedMixer === 'object') {
            appStateStore.merge('persistedMixer', payload.persistedMixer);
        }
        appStateStore.set('updatedAt', Date.now());

        return res.json({ ok: true });
    } catch (err) {
        Logger.error('Error guardando el estado persistido', err);
        return res.status(500).json({ error: 'No se pudo guardar el estado' });
    }
});

// Inicializar audio-mixer con el io del servidor
initAudioMixer(io);
initDiscordRPC(io);

const handleSocketError = (socket, eventName, error, ack) => {
    errorLog(`[Error] Error en evento socket [${eventName}]:`, error);
    emitErrorToFrontend(socket, eventName, error);

    if (typeof ack === 'function') {
        ack({ ok: false, message: getErrorMessage(error) });
    }
};


const REQUIRED_TUYA_KEYS = ['TUYA_ACCESS_KEY', 'TUYA_SECRET_KEY'];
const REQUIRED_DISCORD_KEYS = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI'];

const getMissingEnvKeys = (keys = []) => {
    const missing = keys.filter((k) => !(process.env[k] || '').trim());
    if (missing.length > 0) {
        log(`[Auth] Claves faltantes: ${missing.join(', ')}`);
    }
    return missing;
};

const persistEnvValues = (values = {}) => {
    Logger.info(`[Auth] Intentando persistir ${Object.keys(values).length} claves en .env...`);
    const envPath = getDataPath('.env');
    const current = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath, 'utf8')) : {};
    const merged = { ...current };
    
    for (const [k, v] of Object.entries(values)) {
        if (typeof v === 'string' && v.trim()) {
            merged[k] = v.trim();
            process.env[k] = v.trim();
            Logger.info(`[Auth] Variable actualizada en memoria: ${k}`);
        }
    }
    
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    try {
        fs.mkdirSync(path.dirname(envPath), { recursive: true });
        fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
        Logger.info(`[Auth] Archivo .env guardado con éxito en: ${envPath}`);
    } catch (error) {
        Logger.error(`[Auth] Error crítico guardando .env: ${error.message}`);
    }
};

const ensureIntegrationCredentials = async (type) => {
    const required = type === 'tuya' ? REQUIRED_TUYA_KEYS : REQUIRED_DISCORD_KEYS;
    const missing = getMissingEnvKeys(required);
    if (!missing.length) return { ok: true };

    if (!global.showPCPrompt) {
        return { ok: false, message: `Faltan credenciales ${missing.join(', ')}.` };
    }

    const fields = missing.map(key => ({
        key,
        label: key.replace(/_/g, ' ').replace('TUYA ', '').replace('DISCORD ', ''),
        placeholder: key === 'DISCORD_REDIRECT_URI' ? 'http://localhost' : key,
        isSecret: key.includes('SECRET'),
        defaultValue: key === 'DISCORD_REDIRECT_URI' ? (process.env.DISCORD_REDIRECT_URI || 'http://localhost') : ''
    }));

    const result = await global.showPCPrompt({
        title: `Configuración ${type.toUpperCase()}`,
        description: `Introduce las credenciales de ${type === 'tuya' ? 'Tuya' : 'Discord'}. Pulsa cancelar para omitir.`,
        fields
    });

    if (result === null) {
        return { ok: false, message: 'Cancelado' };
    }

    persistEnvValues(result);
    
    // Pequeño retardo para asegurar que el sistema de archivos y process.env están sincronizados
    await new Promise(r => setTimeout(r, 100));

    // Re-verificar después de persistir
    const missingAfter = getMissingEnvKeys(required);
    if (missingAfter.length > 0) {
        log(`[Auth] CRÍTICO: Claves siguen faltando tras guardado: ${missingAfter.join(', ')}`);
        for (const key of missingAfter) {
            if (result[key]) {
                process.env[key] = result[key];
            }
        }
    }

    if (type === 'discord') try { await forceDiscordReconnect(); } catch (e) {}
    return { ok: true };
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
    log('[Socket] Centro de mando conectado');
    const throttle = (fn, delay) => {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last > delay) {
      last = now;
      fn(...args);
    }
  };
};

    // Emitir versión actual para sincronización de clientes (cache bust)
    socket.emit('server_version', { version: SERVER_START_TS });

    // Routing de Eventos -> Controladores
    socket.on('mixer_initial_state', async (ack) => {
        await runSafely(socket, 'mixer_initial_state', () => sendInitialState(socket), ack);
    });

    socket.on('mixer_bind_commands', async (ack) => {
        await runSafely(socket, 'mixer_bind_commands', () => handleSocketCommands(socket), ack);
    });

    socket.on('discord_initial_state', async (ack) => {
        const missing = getMissingEnvKeys(REQUIRED_DISCORD_KEYS);
        if (missing.length > 0) {
            // No molestamos al inicio si no está configurado.
            // Solo se pedirá cuando el usuario pulse un botón de Discord.
            if (typeof ack === 'function') ack({ ok: false, message: 'Discord no configurado' });
            return;
        }
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


    socket.on('ejecutar_script_dinamico', async (payload, ack) => {
        // Si el script requiere parametros pero no han llegado en el payload, los pedimos en el PC
        if (payload.requiresParams && (payload.args === undefined || payload.args === null)) {
            const scriptLabel = payload.archivo ? payload.archivo.replace(/_/g, ' ').replace(/\.[^.]+$/, '') : 'Script';
            
            // Llamamos a la función global de Electron si existe
            if (global.showPCPrompt) {
                log(`[Server] Solicitando parametros en PC para: ${scriptLabel}`);
                const pcArgs = await global.showPCPrompt(scriptLabel);
                
                if (pcArgs === null) {
                    log('[Server] Prompt cancelado en PC');
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
        const ready = await ensureIntegrationCredentials('discord');
        if (!ready.ok) {
            if (typeof ack === 'function') ack(ready);
            return;
        }
        const result = await runSafely(socket, 'discord_toggle_mute', () => discordToggleMute(), ack);
        if (typeof ack === 'function' && result !== null) ack(result);
    });


    socket.on('discord_toggle_deaf', async (ack) => {
        const ready = await ensureIntegrationCredentials('discord');
        if (!ready.ok) {
            if (typeof ack === 'function') ack(ready);
            return;
        }
        const result = await runSafely(socket, 'discord_toggle_deaf', () => discordToggleDeaf(), ack);
        if (typeof ack === 'function' && result !== null) ack(result);
    });

    socket.on(
      'discord_set_user_volume',
      throttle(async ({ userId, volume }, ack) => {
        const result = await runSafely(
            socket,
            'discord_set_user_volume',
            () => discordSetUserVolume(userId, volume),
            ack
        );

        if (typeof ack === 'function' && result !== null) ack(result);
      }, 100)
    );

    // --- TUYA LIGHT CONTROL ---
    socket.on('tuya_light_toggle', async (payload, ack) => {
        const ready = await ensureIntegrationCredentials('tuya');
        if (!ready.ok) {
            if (typeof ack === 'function') ack(ready);
            return;
        }
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
        const ready = await ensureIntegrationCredentials('tuya');
        if (!ready.ok) {
            if (typeof ack === 'function') ack(ready);
            return;
        }
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
        const ready = await ensureIntegrationCredentials('tuya');
        if (!ready.ok) {
            if (typeof ack === 'function') ack(ready);
            return;
        }
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
        log('[Socket] Centro de mando desconectado');
    });

    // Registrar AutoClicker
    handleAutoClickerSocket(socket, io);
});

let PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
global.__streamdeck_port = PORT;
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
            global.__streamdeck_port = PORT;
            setTimeout(() => {
                try {
                    server.listen(PORT);
                    promptWindow = new BrowserWindow({
                        width: calculatedWidth,
                        height: calculatedHeight,
                        frame: false,
                        transparent: true,
                        alwaysOnTop: true,
                        skipTaskbar: true,
                        center: true,
                        resizable: false,
                        hasShadow: false, // Quitar sombra para evitar bordes feos en Windows
                        thickFrame: false,
                        webPreferences: {
                            preload: getDataPath('frontend/preload_prompt.js'),
                            nodeIntegration: false,
                            contextIsolation: true,
                            enableRemoteModule: false
                        }
                    });

                    // Forzar fondo transparente
                    promptWindow.setBackgroundColor('#00000000');
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
    const protocol = secureProtocol ? 'https' : 'http';

    console.log(`
    ---------------------------------------------------
    >>  STREAM DECK PRO -- BACKEND OPERATIVO
    >>  Local:  ${protocol}://localhost:${PORT}
    >>  Red:    ${protocol}://0.0.0.0:${PORT}
    ---------------------------------------------------
    `);
});

// Endpoint para listar scripts disponibles en el directorio `scripts`
app.get('/api/scripts', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;

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

const gracefulShutdown = () => {
    try {
        stopAllRunningScripts();
    } catch (error) {
        Logger.error('Error during script shutdown', error);
    }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
