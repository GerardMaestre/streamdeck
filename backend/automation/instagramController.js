/**
 * Instagram Multi-Profile Automation Controller
 * 
 * Arquitectura Híbrida: CLI (Chrome real) + Extensión Unpacked
 * - Lanza instancias reales de Chrome con --remote-debugging-port
 * - Carga una extensión unpacked que inyecta JS en instagram.com
 * - Coordina múltiples perfiles en paralelo con control de recursos
 * - CDP opcional para navegación y monitoreo
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Logger = require('../core/logger/logger');
const { getDataPath } = require('../utils/utils');

// ── Estado global ──
let globalIo = null;
const runningInstances = new Map(); // profileName → { process, port, status }
let orchestratorState = {
    running: false,
    profiles: [],
    results: {},
    startedAt: null,
    completedCount: 0,
    totalCount: 0,
    errors: []
};

// ── Configuración ──
const PROFILES_CONFIG_PATH = getDataPath('tools/ig-profiles.json');
const EXTENSION_PATH = getDataPath('tools/ig-extension');

const DEFAULT_CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
];

const CHROME_OPTIMIZATION_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-hang-monitor',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI',
    '--disable-sync',
    '--disable-client-side-phishing-detection',
    '--js-flags=--max-old-space-size=256',
    '--disable-ipc-flooding-protection'
];

// ── Helpers ──

function findChromePath() {
    const config = loadProfilesConfig();
    if (config.chromePath && fs.existsSync(config.chromePath)) {
        return config.chromePath;
    }
    for (const p of DEFAULT_CHROME_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function loadProfilesConfig() {
    try {
        if (fs.existsSync(PROFILES_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(PROFILES_CONFIG_PATH, 'utf8'));
        }
    } catch (err) {
        Logger.warn('[IG] Error leyendo ig-profiles.json', err.message);
    }
    return { chromePath: '', profiles: [], maxConcurrent: 3 };
}

function saveProfilesConfig(config) {
    try {
        const dir = path.dirname(PROFILES_CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PROFILES_CONFIG_PATH, JSON.stringify(config, null, 4), 'utf8');
    } catch (err) {
        Logger.error('[IG] Error guardando ig-profiles.json', err);
    }
}

function emitState() {
    if (globalIo) {
        globalIo.emit('ig_state', getPublicState());
    }
}

function getPublicState() {
    return {
        running: orchestratorState.running,
        profiles: orchestratorState.profiles.map(p => ({
            name: p.name,
            port: p.port,
            status: runningInstances.get(p.name)?.status || 'idle'
        })),
        completedCount: orchestratorState.completedCount,
        totalCount: orchestratorState.totalCount,
        errors: orchestratorState.errors.slice(-10),
        startedAt: orchestratorState.startedAt
    };
}

/**
 * Espera a que el puerto CDP esté listo
 */
function waitForCDP(port, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (Date.now() - start > timeoutMs) {
                return reject(new Error(`CDP timeout en puerto ${port}`));
            }
            const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        resolve(data);
                    } catch (e) {
                        setTimeout(check, 500);
                    }
                });
            });
            req.on('error', () => setTimeout(check, 500));
            req.setTimeout(2000, () => {
                req.destroy();
                setTimeout(check, 500);
            });
        };
        check();
    });
}

/**
 * Navega a una URL usando CDP directo (sin puppeteer/playwright)
 */
async function cdpNavigate(port, url) {
    return new Promise((resolve, reject) => {
        // Primero obtenemos las tabs disponibles
        http.get(`http://127.0.0.1:${port}/json`, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const tabs = JSON.parse(body);
                    const tab = tabs.find(t => t.type === 'page') || tabs[0];
                    if (!tab || !tab.webSocketDebuggerUrl) {
                        return reject(new Error('No hay tabs disponibles'));
                    }

                    // Conectar via WebSocket para navegar
                    const WebSocket = require('ws');
                    const ws = new WebSocket(tab.webSocketDebuggerUrl);

                    ws.on('open', () => {
                        // Habilitar notificaciones de página
                        ws.send(JSON.stringify({ id: 10, method: 'Page.enable' }));
                        
                        // Navegar
                        ws.send(JSON.stringify({
                            id: 1,
                            method: 'Page.navigate',
                            params: { url }
                        }));
                    });

                    ws.on('message', (data) => {
                        try {
                            const msg = JSON.parse(data.toString());
                            
                            // Cuando la página termina de cargar
                            if (msg.method === 'Page.loadEventFired' || (msg.id === 1 && msg.result)) {
                                // Esperamos 3 segundos extra para que React monte el DOM de Instagram
                                setTimeout(() => {
                                    const fs = require('fs');
                                    const path = require('path');
                                    const payloadPath = path.join(__dirname, '../../tools/ig-extension/payload.js');
                                    
                                    if (fs.existsSync(payloadPath)) {
                                        const scriptContent = fs.readFileSync(payloadPath, 'utf8');
                                        
                                        // Inyectamos el script como si lo pegaramos en la consola
                                        ws.send(JSON.stringify({
                                            id: 2,
                                            method: 'Runtime.evaluate',
                                            params: {
                                                expression: scriptContent,
                                                returnByValue: true
                                            }
                                        }));
                                        Logger.info(`[IG] Script inyectado vía CDP en el puerto ${port}`);
                                    }
                                    
                                    setTimeout(() => {
                                        ws.close();
                                        resolve({ navigated: true, injected: true });
                                    }, 2000);
                                }, 3000);
                            }
                        } catch (e) { /* ignore */ }
                    });

                    ws.on('error', (err) => {
                        ws.close();
                        reject(err);
                    });

                    setTimeout(() => {
                        ws.close();
                        resolve({ navigated: true });
                    }, 25000);

                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

/**
 * Lanza UNA instancia de Chrome con perfil específico
 */
function launchChromeProfile(profile, extensionPath) {
    return new Promise((resolve, reject) => {
        const chromePath = findChromePath();
        if (!chromePath) {
            return reject(new Error('Chrome no encontrado. Configura chromePath en ig-profiles.json'));
        }

        if (!profile.userDataDir || !fs.existsSync(profile.userDataDir)) {
            // Si no existe, lo creamos para que Chrome lo use como entorno aislado
            fs.mkdirSync(profile.userDataDir, { recursive: true });
        }

        const args = [
            `--user-data-dir=${profile.userDataDir}`,
            `--remote-debugging-port=${profile.port}`,
            `--load-extension=${extensionPath}`,
            ...CHROME_OPTIMIZATION_FLAGS
        ];

        Logger.info(`[IG] Lanzando Chrome: ${profile.name} (Dir: ${profile.userDataDir}, Puerto: ${profile.port})`);

        const child = spawn(chromePath, args, {
            detached: false,
            windowsHide: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const instance = {
            process: child,
            port: profile.port,
            status: 'launching',
            name: profile.name
        };
        runningInstances.set(profile.name, instance);

        child.on('error', (err) => {
            instance.status = 'error';
            Logger.error(`[IG] Error spawning Chrome para ${profile.name}`, err);
            reject(err);
        });

        child.on('exit', (code) => {
            // Chrome a menudo usa un proceso "wrapper" que lanza el verdadero Chrome y luego se cierra (código 0).
            // Por lo tanto, no eliminamos la instancia aquí de inmediato si el código es 0, confiamos en el CDP.
            if (code !== 0 && instance.status === 'launching') {
                instance.status = 'error';
                runningInstances.delete(profile.name);
                emitState();
            }
            Logger.info(`[IG] Proceso Chrome launcher para ${profile.name} cerrado (código ${code})`);
        });

        // Esperar a que CDP esté listo
        waitForCDP(profile.port)
            .then(() => {
                instance.status = 'ready';
                Logger.info(`[IG] Chrome ${profile.name} listo en puerto ${profile.port}`);
                resolve(instance);
            })
            .catch((err) => {
                instance.status = 'error';
                runningInstances.delete(profile.name);
                emitState();
                reject(err);
            });
    });
}

// ── API Principal ──

/**
 * Orquesta el lanzamiento paralelo de todos los perfiles
 */
async function startOrchestrator(socket) {
    if (orchestratorState.running) {
        socket?.emit('ig_error', { message: 'Ya hay una sesión en ejecución.' });
        return;
    }

    const config = loadProfilesConfig();
    if (!config.profiles || config.profiles.length === 0) {
        socket?.emit('ig_error', { message: 'No hay perfiles configurados. Edita tools/ig-profiles.json' });
        return;
    }

    if (!fs.existsSync(EXTENSION_PATH)) {
        socket?.emit('ig_error', { message: 'Extensión no encontrada en tools/ig-extension/' });
        return;
    }

    const chromePath = findChromePath();
    if (!chromePath) {
        socket?.emit('ig_error', { message: 'Chrome no encontrado. Configura chromePath en ig-profiles.json' });
        return;
    }

    orchestratorState = {
        running: true,
        profiles: config.profiles,
        results: {},
        startedAt: Date.now(),
        completedCount: 0,
        totalCount: config.profiles.length,
        errors: []
    };
    emitState();

    const maxConcurrent = config.maxConcurrent || 3;
    const batches = [];

    // Dividir en lotes
    for (let i = 0; i < config.profiles.length; i += maxConcurrent) {
        batches.push(config.profiles.slice(i, i + maxConcurrent));
    }

    Logger.info(`[IG] Iniciando orquestador: ${config.profiles.length} perfiles en lotes de ${maxConcurrent}`);

    try {
        for (const batch of batches) {
            if (!orchestratorState.running) break;

            // Lanzar lote en paralelo
            const launchPromises = batch.map(async (profile) => {
                try {
                    const instance = await launchChromeProfile(profile, EXTENSION_PATH);
                    instance.status = 'navigating';
                    emitState();

                    // Navegar a Instagram
                    await cdpNavigate(profile.port, 'https://www.instagram.com/');
                    instance.status = 'injected';
                    orchestratorState.completedCount++;
                    orchestratorState.results[profile.name] = 'ok';

                    Logger.info(`[IG] ✅ ${profile.name}: Script inyectado en Instagram`);
                    emitState();

                } catch (err) {
                    orchestratorState.errors.push(`${profile.name}: ${err.message}`);
                    orchestratorState.results[profile.name] = 'error';
                    Logger.error(`[IG] ❌ ${profile.name}: ${err.message}`);
                    emitState();
                }
            });

            await Promise.allSettled(launchPromises);

            // Pausa entre lotes para no saturar el sistema
            if (batches.indexOf(batch) < batches.length - 1) {
                Logger.info('[IG] Esperando 5s antes del siguiente lote...');
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    } catch (err) {
        Logger.error('[IG] Error en orquestador', err);
        orchestratorState.errors.push(err.message);
    }

    Logger.info(`[IG] Orquestación completada: ${orchestratorState.completedCount}/${orchestratorState.totalCount}`);
    emitState();
}

/**
 * Detiene todas las instancias
 */
function stopAll() {
    orchestratorState.running = false;

    for (const [name, instance] of runningInstances.entries()) {
        try {
            if (instance.process && !instance.process.killed) {
                instance.process.kill('SIGTERM');
            }
            // Fallback: intentar cerrar a través de la API si el proceso wrapper ya murió
            http.get(`http://127.0.0.1:${instance.port}/json`, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const tabs = JSON.parse(body);
                        tabs.forEach(tab => {
                            if (tab.type === 'page') {
                                http.get(`http://127.0.0.1:${instance.port}/json/close/${tab.id}`).on('error', ()=>{});
                            }
                        });
                    } catch (e) {}
                });
            }).on('error', () => {});

            instance.status = 'closed';
            Logger.info(`[IG] Solicitado cierre de Chrome: ${name}`);
        } catch (err) {
            Logger.warn(`[IG] Error cerrando ${name}`, err.message);
        }
    }
    setTimeout(() => {
        runningInstances.clear();
        emitState();
    }, 2000);
}

/**
 * Registra los socket handlers para el módulo Instagram
 */
function handleInstagramSocket(socket, io) {
    globalIo = io;

    socket.on('ig_get_state', () => {
        socket.emit('ig_state', getPublicState());
    });

    socket.on('ig_get_config', () => {
        const config = loadProfilesConfig();
        socket.emit('ig_config', config);
    });

    socket.on('ig_save_config', (config) => {
        if (!config || typeof config !== 'object') return;
        saveProfilesConfig(config);
        socket.emit('ig_config', loadProfilesConfig());
    });

    socket.on('ig_start', () => {
        startOrchestrator(socket);
    });

    socket.on('ig_stop', () => {
        stopAll();
        Logger.info('[IG] Orquestador detenido por el usuario.');
    });

    socket.on('ig_close_profile', (profileName) => {
        const instance = runningInstances.get(profileName);
        if (instance && instance.process && !instance.process.killed) {
            instance.process.kill('SIGTERM');
            runningInstances.delete(profileName);
            Logger.info(`[IG] Perfil ${profileName} cerrado manualmente.`);
            emitState();
        }
    });
}

function destroyInstagram() {
    stopAll();
}

module.exports = { handleInstagramSocket, destroyInstagram };
