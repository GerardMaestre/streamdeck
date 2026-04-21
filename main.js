require('dotenv').config();
/**
 * Stream Deck Pro - Tray App Wrapper
 * Este archivo usa Electron para ejecutar tu servidor en segundo plano
 * y añade un icono en la bandeja del sistema de Windows.
 */

const { app, Tray, Menu, shell, nativeImage, dialog, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');

// Evitar que la app abra múltiples instancias
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

let tray = null;

// Puerto en el que corre tu servidor Express/Socket.io (ajusta si es necesario)
const PORT = 3000; 

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

app.whenReady().then(() => {
    // 1. Ocultar el icono del dock en macOS (si alguna vez lo usas ahí)
    if (app.dock) app.dock.hide();

    // 2. IMPORTAR TU SERVIDOR ORIGINAL
    // Esto ejecuta tu código backend de Node.js en segundo plano
    try {
        console.log('[App Bandeja] Iniciando servidor Node.js...');
        require('./server.js'); 
    } catch (error) {
        console.error('[App Bandeja] Error al iniciar el servidor:', error);
        dialog.showErrorBox(
            'Error al iniciar el Servidor',
            `No se pudo arrancar el motor de Stream Deck Pro.\n\nDetalles: ${error.message}`
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
                process.exit(0); 
            } 
        }
    ]);

    tray.setToolTip('Stream Deck Pro Backend');
    tray.setContextMenu(contextMenu);

    // --- LÓGICA DE PROMPT EN PC ---
    let promptWindow = null;
    let promptResolve = null;

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
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });

            promptWindow.loadFile(path.join(__dirname, 'frontend', 'prompt.html'));

            promptWindow.once('ready-to-show', () => {
                promptWindow.show();
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
