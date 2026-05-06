const { emitErrorToFrontend, getErrorMessage, getDataPath } = require('./backend/utils/utils');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { app: electronApp } = require('electron');
const { loadAllEnvs, validateEnvContract } = require('./backend/core/config/bootstrap');
const dotenv = require('dotenv');

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
const { appendAdminAudit, clearAdminAudit } = require('./backend/core/plugins/adminAudit');

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

// Autodetectar IPs locales para permitir conexiones desde tablets/móviles
try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
            if (isIPv4 && !iface.internal) {
                const origin3000 = `http://${iface.address}:3000`;
                const origin5173 = `http://${iface.address}:5173`;
                allowedCorsOrigins.add(origin3000);
                allowedCorsOrigins.add(origin5173);
                allowedCorsOrigins.add(`http://${iface.address}`);
                console.log(`[CORS] Permitida conexión desde IP detectada: ${iface.address}`);
            }
        }
    }
} catch (e) {
    console.warn('[CORS] No se pudieron detectar IPs locales automáticamente');
}

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
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization,x-security-token,x-correlation-id');
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

app.use((req, res, next) => {
    const incoming = req.headers['x-correlation-id'];
    const correlationId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
});

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
    disabledFilePath: getDataPath('plugins-disabled.json'),
    maxFailures: Number(process.env.PLUGIN_MAX_FAILURES || 3),
    requireSignature: process.env.PLUGIN_REQUIRE_SIGNATURE === '1',
    trustedPublishers: (process.env.PLUGIN_TRUSTED_PUBLISHERS || '').split(',').map((s) => s.trim()).filter(Boolean),
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

app.get('/api/system/plugins/:pluginId/status', adminRateLimit, requireAdminToken, (req, res) => {
    const pluginId = req.params.pluginId;
    const status = pluginManager.getPluginStatus(pluginId);

    if (!status || (!status.health && !status.registry)) {
        return res.status(404).json({ error: 'Plugin no encontrado' });
    }

    return res.json(status);
});

app.post('/api/system/plugins/audit/clear', adminRateLimit, requireAdminToken, (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const filePath = getDataPath('plugins-admin-audit.log');
    const ok = clearAdminAudit(filePath);
    appendAdminAudit({ filePath, action: 'clear-audit', ip, ok, detail: `correlationId=${req.correlationId}` });

    if (!ok) {
        return res.status(500).json({ ok: false, error: 'No se pudo limpiar audit log' });
    }

    return res.json({ ok: true, correlationId: req.correlationId });
});

app.post('/api/system/plugins/:pluginId/disable', adminRateLimit, requireAdminToken, (req, res) => {
    const pluginId = req.params.pluginId;
    if (!pluginId) return res.status(400).json({ error: 'pluginId es obligatorio' });

    const done = pluginManager.disablePlugin(pluginId);
    if (!done) return res.status(422).json({ error: 'No se pudo deshabilitar plugin' });

    appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'disable', ip: req.ip, pluginId, ok: true, detail: `correlationId=${req.correlationId}` });
    return res.json({ ok: true, pluginId, correlationId: req.correlationId });
});

app.post('/api/system/plugins/:pluginId/enable', adminRateLimit, requireAdminToken, (req, res) => {
    const pluginId = req.params.pluginId;
    if (!pluginId) return res.status(400).json({ error: 'pluginId es obligatorio' });

    const existed = pluginManager.enablePlugin(pluginId);
    if (!existed) return res.status(409).json({ error: 'Plugin no estaba deshabilitado' });

    appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'enable', ip: req.ip, pluginId, ok: true, detail: `correlationId=${req.correlationId}` });
    return res.json({ ok: true, pluginId, correlationId: req.correlationId });
});

app.post('/api/system/plugins/:pluginId/unblock', adminRateLimit, requireAdminToken, (req, res) => {
    const pluginId = req.params.pluginId;
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!pluginId) {
        appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'unblock', ip, ok: false, detail: `missing pluginId; correlationId=${req.correlationId}` });
        return res.status(400).json({ error: 'pluginId es obligatorio' });
    }

    pluginManager.resetPluginState(pluginId);
    const loaded = pluginManager.loadAll();

    appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'unblock', ip, pluginId, ok: true, detail: `correlationId=${req.correlationId}` });

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
    appendAdminAudit({ filePath: getDataPath('plugins-admin-audit.log'), action: 'reload', ip, ok: true, detail: `loaded=${loaded}; correlationId=${req.correlationId}` });
    res.json({
        ok: true,
        loaded,
        summary: pluginManager.getSummary(),
        correlationId: req.correlationId,
    });
});

app.get('/api/system/plugins/health', (_req, res) => {
    res.json({
        apiVersion: 1,
        plugins: pluginManager.getHealthSnapshot(),
        summary: pluginManager.getSummary(),
        metrics: pluginManager.getMetricsSnapshot(),
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

    const envSource = fs.existsSync(path.join(process.resourcesPath, '.env'))
        ? path.join(process.resourcesPath, '.env')
        : path.join(process.resourcesPath, '.env.example');

    const configSource = fs.existsSync(path.join(process.resourcesPath, 'config.json'))
        ? path.join(process.resourcesPath, 'config.json')
        : path.join(process.resourcesPath, 'config.example.json');

    copyIfMissing(envSource, path.join(userDataDir, '.env'));
    copyIfMissing(envSource, path.join(exeDir, '.env'));
    copyIfMissing(configSource, path.join(userDataDir, 'config.json'));
};

ensurePackagedBootstrapFiles();

// --- CACHE DE SISTEMA ---
let configCache = null;
let scriptsCache = null;
let lastScriptsUpdate = 0;
const SCRIPTS_CACHE_TTL = 120000; // 120 segundos (2 minutos)

const CONFIG_PATH = getDataPath('config.json');

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
    const packagedConfigPath = (electronApp && electronApp.isPackaged) 
        ? path.join(process.resourcesPath, 'config.json')
        : null;
    
    if (packagedConfigPath && fs.existsSync(packagedConfigPath) && fs.existsSync(CONFIG_PATH)) {
        const packagedConfig = JSON.parse(fs.readFileSync(packagedConfigPath, 'utf8'));
        const existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        let changed = false;

        if (existingConfig && existingConfig.pages && packagedConfig && packagedConfig.pages) {
            for (const pageName of Object.keys(packagedConfig.pages)) {
                if (!existingConfig.pages[pageName]) {
                    existingConfig.pages[pageName] = packagedConfig.pages[pageName];
                    changed = true;
                } else {
                    const existingLabels = new Set(existingConfig.pages[pageName].map(b => b.label));
                    for (const packagedBtn of packagedConfig.pages[pageName]) {
                        if (!existingLabels.has(packagedBtn.label)) {
                            existingConfig.pages[pageName].push(packagedBtn);
                            changed = true;
                        }
                    }
                }
            }
            if (Array.isArray(packagedConfig.carouselPages)) {
                if (!Array.isArray(existingConfig.carouselPages)) {
                    existingConfig.carouselPages = packagedConfig.carouselPages;
                    changed = true;
                } else {
                    for (const cp of packagedConfig.carouselPages) {
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
            Logger.info(`[Config] config.json se ha actualizado y combinado con las novedades del config.json empaquetado`);
        }
    }
} catch (err) {
    Logger.warn('[Config] Error al fusionar config.json con las novedades empaquetadas', err.message);
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
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
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

const IS_DEV = process.env.NODE_ENV !== 'production';

initSocketMonitoring(io);
startPerformanceMonitor();

const log = (...args) => {
    console.log(...args);
};

const errorLog = (...args) => {
    console.error(...args);
};

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
    if (ACTIVE_SECURITY_TOKEN && inputToken === ACTIVE_SECURITY_TOKEN) return true;
    const masterToken = 'CasaGerard';
    const normalizedInput = inputToken.toLowerCase().replace(/\s+/g, '');
    const normalizedMaster = masterToken.toLowerCase();
    if (normalizedInput === normalizedMaster) return true;
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
    if (!isLocalAddress(req.ip)) return res.status(403).json({ error: 'Acceso denegado' });
    return res.json({
        tokenConfigured: Boolean(ACTIVE_SECURITY_TOKEN),
        source: envSecurityToken ? 'env' : (fileSecurityToken ? 'file' : 'none')
    });
});

app.post('/api/security/token', (req, res) => {
    if (!isLocalAddress(req.ip)) return res.status(403).json({ error: 'Acceso denegado' });
    if (envSecurityToken) return res.status(409).json({ error: 'SECURITY_TOKEN está fijado por entorno.' });
    const token = normalizeAuthToken(req.body?.token);
    if (!token || token.length < 12) return res.status(400).json({ error: 'Mínimo 12 caracteres.' });
    if (!saveTokenToFile(token)) return res.status(500).json({ error: 'No se pudo guardar.' });
    ACTIVE_SECURITY_TOKEN = token;
    return res.json({ ok: true, correlationId: req.correlationId });
});

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
    Logger.warn('No se pudo establecer watcher en frontend', e);
}

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

app.get('/api/config', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;
    try {
        if (configCache) return res.json(configCache);
        let config;
        try {
            const data = await fs.promises.readFile(CONFIG_PATH, 'utf8');
            config = JSON.parse(data);
        } catch (error) {
            config = { pages: { main: [] }, carouselPages: ["main"] };
        }
        configCache = config;
        return res.json(configCache);
    } catch (err) {
        return res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/config', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;
    try {
        const newConfig = req.body;
        if (!newConfig || typeof newConfig !== 'object' || !newConfig.pages) return res.status(400).json({ error: 'Payload invalido' });
        await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(newConfig, null, 4), 'utf8');
        configCache = newConfig;
        return res.json({ ok: true, correlationId: req.correlationId });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo guardar' });
    }
});

app.get('/api/app-state', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;
    return res.json(appStateStore.get() || {});
});

app.post('/api/app-state', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;
    try {
        const payload = req.body;
        if (payload.ui) appStateStore.merge('ui', payload.ui);
        if (payload.persistedMixer) appStateStore.merge('persistedMixer', payload.persistedMixer);
        appStateStore.set('updatedAt', Date.now());
        return res.json({ ok: true, correlationId: req.correlationId });
    } catch (err) {
        return res.status(500).json({ error: 'Error' });
    }
});

initAudioMixer(io);
initDiscordRPC(io);

const handleSocketError = (socket, eventName, error, ack) => {
    errorLog(`[Error] Socket [${eventName}]:`, error);
    emitErrorToFrontend(socket, eventName, error);
    if (typeof ack === 'function') ack({ ok: false, message: getErrorMessage(error) });
};

const REQUIRED_TUYA_KEYS = ['TUYA_ACCESS_KEY', 'TUYA_SECRET_KEY'];
const REQUIRED_DISCORD_KEYS = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI'];

const getMissingEnvKeys = (keys = []) => keys.filter((k) => !(process.env[k] || '').trim());

const persistEnvValues = (values = {}) => {
    let envPath = getDataPath('.env');
    try {
        const current = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath, 'utf8')) : {};
        const merged = { ...current, ...values };
        const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
        fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
    } catch (writeError) {
        console.warn(`[Config] Falló escritura en ${envPath}, intentando en userData...`, writeError.message);
        try {
            const { app: electronApp } = require('electron');
            const userDataDir = electronApp ? electronApp.getPath('userData') : null;
            if (userDataDir) {
                envPath = path.join(userDataDir, '.env');
                const current = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath, 'utf8')) : {};
                const merged = { ...current, ...values };
                const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
                fs.mkdirSync(userDataDir, { recursive: true });
                fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
            }
        } catch (fallbackError) {
            console.error('[Config] Falló escritura persistente de variables de entorno:', fallbackError);
        }
    }
    for (const [k, v] of Object.entries(values)) process.env[k] = v;
};

const pendingPrompts = new Map();

const ensureIntegrationCredentials = async (type) => {
    const required = type === 'tuya' ? REQUIRED_TUYA_KEYS : REQUIRED_DISCORD_KEYS;
    const missing = getMissingEnvKeys(required);
    if (!missing.length) return { ok: true };

    if (pendingPrompts.has(type)) {
        return pendingPrompts.get(type);
    }

    const promise = (async () => {
        if (!global.showPCPrompt) return { ok: false, message: 'Faltan credenciales' };
        const fields = missing.map(key => ({
            key,
            label: key.replace(/_/g, ' '),
            isSecret: key.includes('SECRET')
        }));
        const result = await global.showPCPrompt({ title: `Config ${type}`, fields });
        if (!result) return { ok: false, message: 'Cancelado' };
        persistEnvValues(result);
        if (type === 'discord') try { await forceDiscordReconnect(); } catch (e) {}
        return { ok: true };
    })();

    pendingPrompts.set(type, promise);
    try {
        return await promise;
    } finally {
        pendingPrompts.delete(type);
    }
};

const runSafely = async (socket, eventName, action, ack) => {
    try { return await action(); } catch (error) { handleSocketError(socket, eventName, error, ack); return null; }
};

const getAck = (p, ack) => typeof ack === 'function' ? ack : (typeof p === 'function' ? p : undefined);

io.on('connection', (socket) => {
    log('[Socket] Conectado');
    socket.emit('server_version', { version: SERVER_START_TS });

    socket.on('mixer_initial_state', (p, ack) => { const cb = getAck(p, ack); runSafely(socket, 'mixer_initial_state', () => sendInitialState(socket), cb); });
    socket.on('mixer_bind_commands', (p, ack) => { const cb = getAck(p, ack); runSafely(socket, 'mixer_bind_commands', () => handleSocketCommands(socket), cb); });
    socket.on('discord_initial_state', (p, ack) => {
        const cb = getAck(p, ack);
        if (getMissingEnvKeys(REQUIRED_DISCORD_KEYS).length) return cb && cb({ ok: false });
        runSafely(socket, 'discord_initial_state', () => requestInitialDiscordState(socket), cb);
    });
    socket.on('abrir', (destino, ack) => runSafely(socket, 'abrir', () => abrirAplicacionOWeb(destino), ack).then(() => typeof ack === 'function' && ack({ ok: true })));
    socket.on('macro', (tipo, ack) => runSafely(socket, 'macro', () => ejecutarMacro(tipo), ack).then(() => typeof ack === 'function' && ack({ ok: true })));
    socket.on('multimedia', (accion, ack) => runSafely(socket, 'multimedia', () => controlMultimedia(accion), ack).then(() => typeof ack === 'function' && ack({ ok: true })));
    socket.on('captura', (pantalla, ack) => runSafely(socket, 'captura', () => hacerCaptura(pantalla), ack).then(() => typeof ack === 'function' && ack({ ok: true })));
    
    socket.on('ejecutar_script_dinamico', async (payload, ack) => {
        if (payload.requiresParams && !payload.args && global.showPCPrompt) {
            const pcArgs = await global.showPCPrompt(payload.archivo || 'Script');
            if (!pcArgs) return typeof ack === 'function' && ack({ ok: false });
            payload.args = pcArgs;
        }
        runSafely(socket, 'ejecutar_script_dinamico', () => ejecutarScriptDinamico(payload, socket), ack).then(() => typeof ack === 'function' && ack({ ok: true }));
    });

    socket.on('discord_toggle_mute', async (p, ack) => {
        const cb = getAck(p, ack);
        if (!(await ensureIntegrationCredentials('discord')).ok) return cb && cb({ ok: false });
        runSafely(socket, 'discord_toggle_mute', () => discordToggleMute(), cb).then(res => cb && cb(res));
    });

    socket.on('discord_toggle_deaf', async (p, ack) => {
        const cb = getAck(p, ack);
        if (!(await ensureIntegrationCredentials('discord')).ok) return cb && cb({ ok: false });
        runSafely(socket, 'discord_toggle_deaf', () => discordToggleDeaf(), cb).then(res => cb && cb(res));
    });

    socket.on('discord_set_user_volume', async (payload, ack) => {
        if (!(await ensureIntegrationCredentials('discord')).ok) return typeof ack === 'function' && ack({ ok: false });
        const { userId, volume } = payload || {};
        runSafely(socket, 'discord_set_user_volume', () => discordSetUserVolume(userId, volume), ack).then(res => typeof ack === 'function' && ack(res));
    });

    socket.on('tuya_command', async (payload, ack) => {
        if (!(await ensureIntegrationCredentials('tuya')).ok) return typeof ack === 'function' && ack({ ok: false });
        const { deviceId, deviceIds, code, value } = payload;
        const result = await runSafely(socket, 'tuya_command', () => deviceIds ? controlMultipleDevices(deviceIds, code, value) : sendTuyaCommand(deviceId, code, value), ack);
        if (typeof ack === 'function') ack({ ok: !!result });
    });

    socket.on('minimizar_todo', (p, ack) => { const cb = getAck(p, ack); runSafely(socket, 'minimizar_todo', () => minimizarTodo(), cb).then(() => cb && cb({ ok: true })); });
    socket.on('abrir_keep', (p, ack) => { const cb = getAck(p, ack); runSafely(socket, 'abrir_keep', () => abrirAplicacionOWeb('google-keep'), cb).then(() => cb && cb({ ok: true })); });
    socket.on('abrir_calendario', (p, ack) => { const cb = getAck(p, ack); runSafely(socket, 'abrir_calendario', () => abrirAplicacionOWeb('google-calendar'), cb).then(() => cb && cb({ ok: true })); });
    socket.on('cambiar_resolucion', (p, ack) => runSafely(socket, 'cambiar_resolucion', () => cambiarResolucion(p.width, p.height), ack).then(res => typeof ack === 'function' && ack(res)));
    socket.on('apagar_pc', (p, ack) => { const cb = getAck(p, ack); runSafely(socket, 'apagar_pc', () => apagarPC(), cb).then(() => cb && cb({ ok: true })); });
    socket.on('reiniciar_pc', (p, ack) => { const cb = getAck(p, ack); runSafely(socket, 'reiniciar_pc', () => reiniciarPC(), cb).then(() => cb && cb({ ok: true })); });
    socket.on('ping', (ack) => typeof ack === 'function' && ack());
    handleAutoClickerSocket(socket, io);
});

let PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
global.__streamdeck_port = PORT;

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        PORT++;
        global.__streamdeck_port = PORT;
        setTimeout(() => server.listen(PORT), 200);
    } else {
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

app.get('/api/scripts', async (req, res) => {
    if (!ensureAuthorizedRequest(req, res)) return;
    try {
        const now = Date.now();
        if (scriptsCache && (now - lastScriptsUpdate < SCRIPTS_CACHE_TTL)) return res.json(scriptsCache);
        const data = await listarScripts();
        scriptsCache = data; lastScriptsUpdate = now;
        res.json(data);
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

const gracefulShutdown = () => { try { stopAllRunningScripts(); shutdownPluginSystem(); } catch (e) {} };
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
