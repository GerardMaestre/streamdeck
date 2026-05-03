const path = require('path');
const os = require('os');
const { app, Tray, Menu, shell, nativeImage, dialog, BrowserWindow, ipcMain } = require('electron');
const { getDataPath } = require('./backend/utils/utils');

// 1. Cargar variables de entorno según el entorno (Producción vs Desarrollo)
const dotenv = require('dotenv');
const fs = require('fs');

const loadAllEnvs = () => {
    const getUserDataPath = () => {
        if (app && app.isPackaged) {
            if (process.env.APPDATA) {
                return path.join(process.env.APPDATA, 'mi-streamdeck');
            }
            try {
                return app.getPath('userData');
            } catch (e) {
                return path.join(os.homedir(), 'AppData', 'Roaming', 'mi-streamdeck');
            }
        }
        return __dirname;
    };

    const parseEnv = (fp) => {
        try {
            if (fs.existsSync(fp)) return dotenv.parse(fs.readFileSync(fp, 'utf8'));
        } catch (e) {}
        return {};
    };

    const applyConfigEnvFallback = (configPath) => {
        try {
            if (!fs.existsSync(configPath)) return;
            const configRaw = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configRaw);
            const integrations = config?.integrations || {};

            const fallbackMap = {
                TUYA_ACCESS_KEY: integrations?.tuya?.accessKey,
                TUYA_SECRET_KEY: integrations?.tuya?.secretKey,
                DISCORD_CLIENT_ID: integrations?.discord?.clientId,
                DISCORD_CLIENT_SECRET: integrations?.discord?.clientSecret,
                DISCORD_REDIRECT_URI: integrations?.discord?.redirectUri
            };

            for (const [key, value] of Object.entries(fallbackMap)) {
                if (!process.env[key] && typeof value === 'string' && value.trim()) {
                    process.env[key] = value.trim();
                }
            }
        } catch (error) {}
    };

    const userData = getUserDataPath();
    const logPath = path.join(userData, 'debug.log');

    if (app && app.isPackaged) {
        const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
        const externalEnv = path.join(exeDir, '.env');
        const userDataEnv = path.join(userData, '.env');
        const resourcesEnv = path.join(process.resourcesPath, '.env');
        const resourcesEnvExample = path.join(process.resourcesPath, '.env.example');

        // Parse all env files disponibles en empaquetado
        const resourcesObj = Object.assign({}, parseEnv(resourcesEnvExample), parseEnv(resourcesEnv));
        const userDataObj = parseEnv(userDataEnv);
        const externalObj = parseEnv(externalEnv);

        // Merge in correct priority: resources < userData < external
        const merged = Object.assign({}, resourcesObj, userDataObj, externalObj);
        for (const k of Object.keys(merged)) {
            process.env[k] = merged[k];
        }

        applyConfigEnvFallback(path.join(exeDir, 'config.json'));
        applyConfigEnvFallback(path.join(userData, 'config.json'));
        applyConfigEnvFallback(path.join(process.resourcesPath, 'config.json'));
        applyConfigEnvFallback(path.join(process.resourcesPath, 'config.example.json'));

        try {
            const logContent = `[${new Date().toISOString()}] PROD ENV LOADED (main):\n` +
                `- externalEnv: ${externalEnv} (exists: ${fs.existsSync(externalEnv)})\n` +
                `- userDataEnv: ${userDataEnv} (exists: ${fs.existsSync(userDataEnv)})\n` +
                `- resourcesEnv: ${resourcesEnv} (exists: ${fs.existsSync(resourcesEnv)})\n` +
                `- Variables Merged: ${Object.keys(merged).join(', ')}\n` +
                `- TUYA_ACCESS_KEY: ${process.env.TUYA_ACCESS_KEY ? 'Present' : 'Missing'}\n` +
                `- DISCORD_CLIENT_ID: ${process.env.DISCORD_CLIENT_ID ? 'Present' : 'Missing'}\n`;
            fs.appendFileSync(logPath, logContent);
        } catch (e) {}
    } else {
        const result = dotenv.config({ quiet: true });
        try {
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] DEV ENV LOADED (main): Parsed: ${JSON.stringify(result.parsed || {})}\n`);
        } catch (e) {}
    }
};
loadAllEnvs();

/**
 * Stream Deck Pro - Tray App Wrapper
...
 */

// Evitar que la app abra múltiples instancias
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('[App] Ya hay otra instancia ejecutándose. Cerrando esta instancia...');
    app.quit();
    process.exit(0);
} else {
    console.log('[App] Bloqueo de instancia única obtenido.');
}

let tray = null;

// Puerto por defecto (se actualizará con el real si cambia por colisión)
let PORT = 3000; 

// Función para obtener la IP local (para conectarse desde la tablet)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Filtrar IPv4 y descartar conexiones internas locales
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Icono por defecto en Base64 (un pequeño cuadrado azul) para que no crashee 
// si no tienes un archivo icon.png preparado.
const fallbackIconB64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABTSURBVDhPYxgFWAX+M/z/z0A8gGEwg7A2gGkYBoQagO6pUQNwGIQ1AIVBWAwYtYEBNgNgGEYPGBgNMMwGGGoDo2AwwOAAGNvEABsA0TAwGAAADK1rM1M2v+MAAAAASUVORK5CYII=';

const waitForServerPort = async (timeout = 3000, interval = 50) => {
    const start = Date.now();
    while (!global.__streamdeck_port && Date.now() - start < timeout) {
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return global.__streamdeck_port;
};

app.whenReady().then(async () => {
    // 1. Ocultar el icono del dock en macOS (si alguna vez lo usas ahí)
    if (app.dock) app.dock.hide();

    // 2. IMPORTAR TU SERVIDOR ORIGINAL
    // Esto ejecuta tu código backend de Node.js en segundo plano
    try {
        console.log('[App Bandeja] Iniciando motor del servidor...');
        
        // Verificación de integridad de archivos críticos antes de arrancar
        const serverScript = fs.existsSync(path.join(__dirname, 'server.js'))
            ? path.join(__dirname, 'server.js')
            : path.join(process.resourcesPath, 'app.asar', 'server.js');
        
        if (!fs.existsSync(serverScript)) {
            throw new Error(`No se encontró el archivo del servidor en: ${serverScript}`);
        }

        require(serverScript);
        
        // Esperar a que el servidor asigne el puerto (máximo 5 segundos)
        const portFromServer = await waitForServerPort(5000);
        if (portFromServer) {
            PORT = portFromServer;
            console.log(`[App Bandeja] Servidor detectado en puerto: ${PORT}`);
        } else {
            console.warn('[App Bandeja] El servidor no reportó puerto tras 5s. Usando puerto por defecto.');
        }
    } catch (error) {
        console.error('[App Bandeja] FALLO CRÍTICO AL INICIAR SERVIDOR:', error);
        dialog.showErrorBox(
            'Error al iniciar el Servidor',
            `No se pudo arrancar el motor de Stream Deck Pro.\n\nDetalles: ${error.message || error}`
        );
    }

    // 3. Configurar el icono de la bandeja
    let icon;
    try {
        // Intenta cargar un icono local si existe
        icon = nativeImage.createFromPath(getDataPath('icon.png'));
        if (icon.isEmpty()) throw new Error('Icono no encontrado');
    } catch (e) {
        // Fallback al icono en memoria
        icon = nativeImage.createFromBuffer(Buffer.from(fallbackIconB64, 'base64'));
    }

    tray = new Tray(icon);
    const localIP = getLocalIP();

    // 4. Crear el menú al hacer clic derecho
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Stream Deck Pro', enabled: false },
        { type: 'separator' },
        { 
            label: `📱 IP Tablet: http://${localIP}:${PORT}`, 
            enabled: false 
        },
        { 
            label: 'Abrir localmente en este PC', 
            click: () => shell.openExternal(`http://localhost:${PORT}`) 
        },
        { type: 'separator' },
        { 
            label: 'Iniciar con Windows', 
            type: 'checkbox', 
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => {
                app.setLoginItemSettings({
                    openAtLogin: item.checked,
                    path: app.getPath('exe')
                });
            }
        },
        { type: 'separator' },
        { 
            label: 'Reiniciar Servidor', 
            click: () => { 
                app.relaunch(); 
                app.exit(); 
            } 
        },
        { 
            label: 'Cerrar por completo', 
            click: () => { 
                app.quit(); 
            } 
        }
    ]);

    tray.setToolTip('Stream Deck Pro Backend');
    tray.setContextMenu(contextMenu);

    // --- LÓGICA DE PROMPT EN PC ---
    let promptWindow = null;
    let promptResolve = null;
    const promptQueue = [];
    let isProcessingPrompt = false;
    const terminalWindows = new Map();
    let nextTerminalId = 1;

    global.showPCPrompt = (promptConfig) => {
        return new Promise((resolve) => {
            promptQueue.push({ config: promptConfig, resolve });
            processNextPrompt();
        });
    };

    const processNextPrompt = async () => {
        if (isProcessingPrompt || promptQueue.length === 0) return;
        isProcessingPrompt = true;

        const { config: promptConfig, resolve } = promptQueue.shift();
        
        try {
            const config = typeof promptConfig === 'string' ? { title: promptConfig } : (promptConfig || {});
            const fieldsCount = Array.isArray(config.fields) ? config.fields.length : 1;
            
            // Más generoso con las dimensiones para evitar cortes
            const calculatedHeight = Math.min(750, 320 + (fieldsCount > 1 ? (fieldsCount - 1) * 100 : 0));
            const calculatedWidth = 520;

            promptResolve = resolve;
            promptWindow = new BrowserWindow({
                width: calculatedWidth,
                height: calculatedHeight,
                frame: false,
                transparent: true,
                alwaysOnTop: true,
                skipTaskbar: true,
                center: true,
                resizable: false,
                webPreferences: {
                    preload: getDataPath('frontend/preload_prompt.js'),
                    nodeIntegration: false,
                    contextIsolation: true,
                    enableRemoteModule: false
                }
            });

            promptWindow.loadFile(getDataPath('frontend/prompt.html'));

            promptWindow.once('ready-to-show', () => {
                if (promptWindow) promptWindow.show();
            });

            promptWindow.webContents.once('did-finish-load', () => {
                if (promptWindow) promptWindow.webContents.send('setup-prompt', config);
            });

            promptWindow.on('closed', () => {
                promptWindow = null;
                if (promptResolve) {
                    promptResolve(null);
                    promptResolve = null;
                }
                isProcessingPrompt = false;
                // Pequeño retardo para evitar que la siguiente ventana salga instantáneamente
                setTimeout(processNextPrompt, 300);
            });
        } catch (error) {
            console.error('[Prompt] Error al procesar prompt:', error);
            resolve(null);
            isProcessingPrompt = false;
            processNextPrompt();
        }
    };

    global.showTerminal = (title) => {
        const terminalId = `terminal-${nextTerminalId++}`;

        const terminalWindow = new BrowserWindow({
            width: 920,
            height: 700,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: false,
            center: true,
            resizable: true,
            movable: true,
            webPreferences: {
                preload: getDataPath('frontend/preload_terminal.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        const terminalState = {
            window: terminalWindow,
            ready: false,
            queue: []
        };

        terminalWindows.set(terminalId, terminalState);

        terminalWindow.loadFile(getDataPath('frontend/terminal.html'));

        terminalWindow.once('ready-to-show', () => {
            terminalState.ready = true;
            terminalWindow.show();
            terminalWindow.webContents.send('terminal-setup', { id: terminalId, title });
            terminalState.queue.forEach((text) => terminalWindow.webContents.send('terminal-log', text));
            terminalState.queue = [];
        });

        terminalWindow.on('closed', () => {
            terminalWindows.delete(terminalId);
        });

        return terminalId;
    };

    global.appendTerminalLog = (terminalId, text) => {
        if (!terminalId) return;
        const terminalState = terminalWindows.get(terminalId);
        if (!terminalState) return;

        if (terminalState.ready) {
            terminalState.window.webContents.send('terminal-log', text);
        } else {
            terminalState.queue.push(text);
        }
    };

    ipcMain.on('terminal-close', (event, terminalId) => {
        const terminalState = terminalWindows.get(terminalId);
        if (terminalState) terminalState.window.close();
    });

    ipcMain.on('terminal-minimize', (event, terminalId) => {
        const terminalState = terminalWindows.get(terminalId);
        if (terminalState) terminalState.window.minimize();
    });

    ipcMain.on('prompt-submit', (event, value) => {
        if (promptResolve) {
            const resolveRef = promptResolve;
            promptResolve = null; // Limpiar antes para evitar doble disparo
            resolveRef(value);
        }
        if (promptWindow) {
            promptWindow.removeAllListeners('closed');
            promptWindow.close();
            promptWindow = null;
        }
        isProcessingPrompt = false;
        setTimeout(processNextPrompt, 300);
    });

    ipcMain.on('prompt-cancel', () => {
        if (promptResolve) {
            const resolveRef = promptResolve;
            promptResolve = null;
            resolveRef(null);
        }
        if (promptWindow) {
            promptWindow.removeAllListeners('closed');
            promptWindow.close();
            promptWindow = null;
        }
        isProcessingPrompt = false;
        setTimeout(processNextPrompt, 300);
    });

    // --- POSITION PICKER (AutoClicker MULTI-MONITOR) ---
    let pickerWindows = [];
    let pickerResolve = null;

    global.showPositionPicker = () => {
        return new Promise((resolve) => {
            // Limpiar ventanas previas si las hubiera
            pickerWindows.forEach(w => { try { w.close(); } catch(_) {} });
            pickerWindows = [];

            pickerResolve = resolve;

            const { screen: electronScreen } = require('electron');
            const displays = electronScreen.getAllDisplays();

            displays.forEach((display) => {
                const { x, y, width, height } = display.bounds;

                const win = new BrowserWindow({
                    x, y, width, height,
                    frame: false,
                    transparent: true,
                    alwaysOnTop: true,
                    skipTaskbar: true,
                    resizable: false,
                    fullscreen: false,
                    hasShadow: false,
                    webPreferences: {
                        preload: getDataPath('frontend/preload_picker.js'),
                        nodeIntegration: false,
                        contextIsolation: true
                    }
                });

                win.setAlwaysOnTop(true, 'screen-saver');
                win.loadFile(getDataPath('frontend/picker.html'));

                win.once('ready-to-show', () => {
                    win.show();
                    // Solo enfocamos la primera para que acepte eventos de teclado (Esc)
                    if (pickerWindows.length === 1) win.focus();
                });

                win.on('closed', () => {
                    // Si una se cierra manualmente (poco probable), intentamos limpiar el resto
                    if (pickerWindows.length > 0 && pickerResolve) {
                        const idx = pickerWindows.indexOf(win);
                        if (idx > -1) pickerWindows.splice(idx, 1);
                        if (pickerWindows.length === 0) {
                            if (pickerResolve) pickerResolve(null);
                            pickerResolve = null;
                        }
                    }
                });

                pickerWindows.push(win);
            });
        });
    };

    const closeAllPickers = () => {
        const windowsToClose = [...pickerWindows];
        pickerWindows = [];
        windowsToClose.forEach(w => {
            try { w.removeAllListeners('closed'); w.close(); } catch(_) {}
        });
    };

    ipcMain.on('picker-select', (event, pos) => {
        if (pickerResolve) {
            const { screen: electronScreen } = require('electron');
            const displays = electronScreen.getAllDisplays();
            let monitorIndex = 0;
            
            // Buscar en qué monitor está el punto absoluto
            for (let i = 0; i < displays.length; i++) {
                const b = displays[i].bounds;
                if (pos.x >= b.x && pos.x < b.x + b.width &&
                    pos.y >= b.y && pos.y < b.y + b.height) {
                    monitorIndex = i;
                    break;
                }
            }
            
            pickerResolve({ x: pos.x, y: pos.y, monitorIndex });
            pickerResolve = null;
        }
        closeAllPickers();
    });

    ipcMain.on('picker-cancel', () => {
        if (pickerResolve) {
            pickerResolve(null);
            pickerResolve = null;
        }
        closeAllPickers();
    });

    console.log(`[App Bandeja] Todo listo. IP para la tablet: http://${localIP}:${PORT}`);
});

// Evitar que la app se cierre si no hay ventanas abiertas (porque no hay ventanas, solo bandeja)
app.on('window-all-closed', (e) => {
    e.preventDefault();
});
