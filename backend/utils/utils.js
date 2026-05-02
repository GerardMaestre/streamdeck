const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Resuelve rutas de forma dinámica para que funcionen tanto en desarrollo
 * como en la aplicación empaquetada (Portable/Instalador).
 * Prioriza archivos externos en la carpeta 'resources' para permitir personalización del usuario,
 * y usa 'userData' para guardar cambios con permisos de escritura.
 */
const getDataPath = (relativePath) => {
    let app;
    try {
        const electron = require('electron');
        app = electron.app || (electron.remote ? electron.remote.app : null);
    } catch (e) {
        // Fallback si no estamos en entorno Electron
    }
    
    // Si no hay app (caso desarrollo Node puro o error), fallback a relativo
    if (!app) {
        return path.resolve(__dirname, '../../', relativePath);
    }

    const isPackaged = app.isPackaged;

    if (isPackaged) {
        // Carpeta que contiene el ejecutable (soporta portables de electron-builder)
        const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
        const externalPath = path.join(exeDir, relativePath);
        
        // Carpeta userData persistente (AppData/Roaming/mi-streamdeck)
        const userDataPath = path.join(app.getPath('userData'), relativePath);

        // Carpeta resources estándar de Electron
        const resourcesPath = path.join(process.resourcesPath, relativePath);

        const isExternalData = relativePath.startsWith('config.json') || 
                               relativePath.startsWith('scripts') || 
                               relativePath.startsWith('logs') ||
                               relativePath.startsWith('data') ||
                               relativePath.startsWith('frontend') ||
                               relativePath.startsWith('.env');

        if (isExternalData) {
            // Para directorios (como scripts/, logs/, data/, frontend/), evitamos copiar recursivamente
            try {
                if (fs.existsSync(resourcesPath)) {
                    const stats = fs.statSync(resourcesPath);
                    if (stats.isDirectory()) {
                        if (fs.existsSync(externalPath)) return externalPath;
                        if (fs.existsSync(userDataPath)) return userDataPath;
                        return resourcesPath;
                    }
                }
            } catch (err) {}

            // 1. Si existe junto al ejecutable (máxima prioridad para portables o personalización avanzada)
            if (fs.existsSync(externalPath)) {
                return externalPath;
            }
            // 2. Si existe en la carpeta userData persistente
            if (fs.existsSync(userDataPath)) {
                return userDataPath;
            }
            // 3. Fallback: Si existe en la carpeta resources, lo copiamos a userData para que tenga permisos de escritura
            if (fs.existsSync(resourcesPath)) {
                try {
                    const dir = path.dirname(userDataPath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.copyFileSync(resourcesPath, userDataPath);
                    return userDataPath;
                } catch (err) {
                    // Fallback a resourcesPath si algo falla
                    return resourcesPath;
                }
            }
            
            // Si el archivo no existe en absoluto, creamos su directorio padre en userData y lo devolvemos
            try {
                const dir = path.dirname(userDataPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            } catch (err) {}
            return userDataPath;
        }
    }

    // Archivos internos (como controllers, core, etc.) dentro de app.asar en producción
    if (isPackaged) {
        return path.join(app.getAppPath(), relativePath);
    }

    // Desarrollo
    return path.resolve(__dirname, '../../', relativePath);
};


const getErrorMessage = (error) => {
    if (!error) return 'Error desconocido';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return String(error);
};

const logControllerError = (scope, error) => {
    console.error(`[${scope}] ${getErrorMessage(error)}`, error);
};

const safeSocketEmit = (socket, eventName, payload) => {
    if (!socket || typeof socket.emit !== 'function') return;

    try {
        socket.emit(eventName, payload);
    } catch (error) {
        logControllerError(`socket:${eventName}`, error);
    }
};

const emitErrorToFrontend = (socket, context, error, eventName = 'server_error') => {
    const message = getErrorMessage(error);
    safeSocketEmit(socket, eventName, { context, message });
};

const runExecCommand = (command, options = {}) => {
    return new Promise((resolve, reject) => {
        exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            resolve({ stdout, stderr });
        });
    });
};

const runSpawnCommand = ({
    bin,
    args = [],
    options = {},
    onStdout,
    onStderr,
    onClose,
    onError
}) => {
    return new Promise((resolve, reject) => {
        let childProcess;

        try {
            childProcess = spawn(bin, args, options);
        } catch (spawnError) {
            if (typeof onError === 'function') onError(spawnError);
            reject(spawnError);
            return;
        }

        if (childProcess.stdout) {
            childProcess.stdout.on('data', (chunk) => {
                if (typeof onStdout === 'function') onStdout(chunk);
            });
        }

        if (childProcess.stderr) {
            childProcess.stderr.on('data', (chunk) => {
                if (typeof onStderr === 'function') onStderr(chunk);
            });
        }

        childProcess.once('error', (error) => {
            if (typeof onError === 'function') onError(error);
            reject(error);
        });

        childProcess.once('close', (code) => {
            if (typeof onClose === 'function') onClose(code);

            if (code === 0) {
                resolve({ code });
                return;
            }

            const closeError = new Error(`Proceso finalizo con codigo ${code}`);
            closeError.code = code;
            reject(closeError);
        });
    });
};

const isPathInsideBase = (basePath, targetPath) => {
    const normalizedBase = path.resolve(basePath);
    const normalizedTarget = path.resolve(targetPath);
    const relative = path.relative(normalizedBase, normalizedTarget);

    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? true
        : normalizedBase === normalizedTarget;
};

const createSafeSocketHandler = (socket, eventName, handler) => {
    return async (...args) => {
        const ackCandidate = args[args.length - 1];
        const ack = typeof ackCandidate === 'function' ? ackCandidate : null;

        try {
            await handler(...args);
        } catch (error) {
            logControllerError(`socket:${eventName}`, error);
            emitErrorToFrontend(socket, eventName, error);

            if (ack) {
                ack({ ok: false, message: getErrorMessage(error) });
            }
        }
    };
};

const sanitizeShellArgs = (args) => {
    if (typeof args !== 'string') return '';
    // Eliminar caracteres peligrosos para la shell
    return args.replace(/[&|;<>`$()!]/g, '').trim();
};

const parseShellArgs = (args) => {
    const raw = typeof args === 'string' ? args.trim() : '';
    if (!raw) return [];

    const result = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];

        if (quote) {
            if (char === quote) {
                quote = null;
                continue;
            }
            current += char;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                result.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (current) result.push(current);
    return result.map(arg => sanitizeShellArgs(arg)).filter(Boolean);
};

module.exports = {
    createSafeSocketHandler,
    emitErrorToFrontend,
    getErrorMessage,
    isPathInsideBase,
    logControllerError,
    runExecCommand,
    runSpawnCommand,
    safeSocketEmit,
    getDataPath,
    parseShellArgs
};
