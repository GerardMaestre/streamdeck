const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Resuelve rutas de forma dinamica para que funcionen tanto en desarrollo
 * como en la aplicación empaquetada (Portable/Instalador).
 * Prioriza archivos al lado del ejecutable para permitir edición del usuario.
 */
const getDataPath = (relativePath) => {
    const { app } = require('electron');
    let resolvedPath;

    // Caso 1: Archivos externos (config.json, scripts) que el usuario puede editar
    // Estos suelen estar en 'resources' al lado del EXE o en el root en dev.
    if (app && app.isPackaged) {
        // En producción, buscamos en la carpeta 'resources' del sistema
        const extraPath = path.join(process.resourcesPath, relativePath);
        if (fs.existsSync(extraPath)) resolvedPath = extraPath;
    }

    // Caso 2: Archivos internos del núcleo (public, controllers)
    // Estos SIEMPRE están dentro del paquete (ASAR)
    if (!resolvedPath && app) {
        const internalPath = path.join(app.getAppPath(), relativePath);
        if (fs.existsSync(internalPath)) resolvedPath = internalPath;
    }

    // Caso 3: Fallback para desarrollo o si lo anterior falla
    if (!resolvedPath) {
        resolvedPath = path.resolve(__dirname, '../../', relativePath);
    }

    return resolvedPath;
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
    sanitizeShellArgs
};
