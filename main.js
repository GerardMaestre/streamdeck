const path = require('path');
const os = require('os');
const { app, Tray, Menu, shell, nativeImage, dialog, BrowserWindow, ipcMain } = require('electron');

// 1. Cargar variables de entorno según el entorno (Producción vs Desarrollo)
const dotenv = require('dotenv');
if (app.isPackaged) {
    dotenv.config({ path: path.join(process.resourcesPath, '.env'), quiet: true });
} else {
    dotenv.config({ quiet: true });
}

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
        const serverScript = path.join(__dirname, 'server.js');
        if (!require('fs').existsSync(serverScript)) {
            throw new Error(`No se encontró el archivo del servidor en: ${serverScript}`);
        }

        require('./server.js');
        
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
        icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
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
    const terminalWindows = new Map();
    let nextTerminalId = 1;

    global.showPCPrompt = (title) => {
        return new Promise((resolve) => {
            if (promptWindow) promptWindow.close();

            promptResolve = resolve;
            promptWindow = new BrowserWindow({
                width: 480,
                height: 320,
                frame: false,
                transparent: true,
                alwaysOnTop: true,
                skipTaskbar: true,
                center: true,
                resizable: false,
                webPreferences: {
                    preload: path.join(__dirname, 'frontend', 'preload_prompt.js'),
                    nodeIntegration: false,
                    contextIsolation: true,
                    enableRemoteModule: false
                }
            });

            promptWindow.loadFile(path.join(__dirname, 'frontend', 'prompt.html'));

            promptWindow.once('ready-to-show', () => {
                promptWindow.show();
            });

            promptWindow.webContents.once('did-finish-load', () => {
                promptWindow.webContents.send('setup-prompt', { title });
            });

            promptWindow.on('closed', () => {
                promptWindow = null;
                if (promptResolve) {
                    promptResolve(null); // Retornar null si se cierra sin enviar
                    promptResolve = null;
                }
            });
        });
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
                preload: path.join(__dirname, 'frontend', 'preload_terminal.js'),
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

        terminalWindow.loadFile(path.join(__dirname, 'frontend', 'terminal.html'));

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
            promptResolve(value);
            promptResolve = null;
        }
        if (promptWindow) promptWindow.close();
    });

    ipcMain.on('prompt-cancel', () => {
        if (promptResolve) {
            promptResolve(null);
            promptResolve = null;
        }
        if (promptWindow) promptWindow.close();
    });

    console.log(`[App Bandeja] Todo listo. IP para la tablet: http://${localIP}:${PORT}`);
});

// Evitar que la app se cierre si no hay ventanas abiertas (porque no hay ventanas, solo bandeja)
app.on('window-all-closed', (e) => {
    e.preventDefault();
});
