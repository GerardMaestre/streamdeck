const fs = require('fs/promises');
const path = require('path');
const {
    getErrorMessage,
    isPathInsideBase,
    logControllerError,
    getDataPath,
    sanitizeShellArgs
} = require('../utils/utils');
const { exec } = require('child_process');

const baseScriptsPath = getDataPath('scripts');

const ensureFileExists = async (absolutePath) => {
    await fs.access(absolutePath);
};

const scripts = {
    purgar_ram: path.join(baseScriptsPath, '02_Gaming', 'Purgar_ram.py'),
    limpiar_shaders: path.join(baseScriptsPath, '02_Gaming', 'Purgador_Shaders.py'),
    modo_tryhard: path.join(baseScriptsPath, '02_Gaming', 'Despertar_Nucleos.bat'),
    limpieza_global: path.join(baseScriptsPath, '04_Archivos', 'Limpieza_Extrema_Global.py')
};

const buildExecutionCommand = (absolutePath, args) => {
    const extension = path.extname(absolutePath).toLowerCase();
    const sanitizedArgs = sanitizeShellArgs(args);
    const argsStr = sanitizedArgs ? ` ${sanitizedArgs}` : '';

    if (extension === '.py') {
        return `start "StreamDeck Script" cmd.exe /k "python "${absolutePath}"${argsStr}"`;
    }

    if (extension === '.bat' || extension === '.cmd' || extension === '.exe') {
        return `start "StreamDeck Script" cmd.exe /k ""${absolutePath}"${argsStr}"`;
    }

    throw new Error(`Extensión de archivo no soportada: ${path.basename(absolutePath)}`);
};

const runScriptExternally = async (scriptLabel, absolutePath, args) => {
    console.log(`⏳ Ejecutando script externamente [${scriptLabel}] con args: ${args || 'ninguno'}`);

    try {
        const commandStr = buildExecutionCommand(absolutePath, args);
        console.log(`Ejecutando: ${commandStr}`);
        
        exec(commandStr, (error) => {
            if (error) {
                logControllerError(`script:${scriptLabel}`, error);
            }
        });

        console.log(`✅ ${scriptLabel} lanzado correctamente`);
    } catch (error) {
        logControllerError(`script:${scriptLabel}`, error);
    }
};

const validateDynamicPayload = (payload = {}) => {
    const { carpeta, archivo, args } = payload;

    if (!carpeta || !archivo || typeof carpeta !== 'string' || typeof archivo !== 'string') {
        throw new Error('Payload inválido para script dinámico');
    }

    const sanitizedArgs = sanitizeShellArgs(args);
    return { carpeta, archivo, args: sanitizedArgs };
};

const resolveSafeScriptPath = (carpeta, archivo) => {
    const absolutePath = path.resolve(baseScriptsPath, carpeta, archivo);

    if (!isPathInsideBase(baseScriptsPath, absolutePath)) {
        throw new Error('Acceso denegado: intento de salir del directorio permitido');
    }

    return absolutePath;
};

const ejecutarScript = async (scriptId, socket) => {
    try {
        const absolutePath = scripts[scriptId];

        if (!absolutePath) {
            console.error(`❌ Script no encontrado: ${scriptId}`);
            return;
        }

        await ensureFileExists(absolutePath);
        await runScriptExternally(scriptId, absolutePath, '');
    } catch (error) {
        logControllerError(`script:${scriptId}`, error);
    }
};

const ejecutarScriptDinamico = async (payload, socket) => {
    try {
        const { carpeta, archivo, args } = validateDynamicPayload(payload);
        const absolutePath = resolveSafeScriptPath(carpeta, archivo);

        await ensureFileExists(absolutePath);
        await runScriptExternally(`${carpeta}/${archivo}`, absolutePath, args);
    } catch (error) {
        logControllerError('script:dinamico', error);
    }
};

module.exports = {
    ejecutarScript,
    ejecutarScriptDinamico,
    listarScripts
};

async function listarScripts() {
    try {
        const result = {};
        const entries = await fs.readdir(baseScriptsPath, { withFileTypes: true });

        for (const dirent of entries) {
            if (!dirent.isDirectory()) continue;
            const carpetaName = dirent.name;
            const folderPath = path.join(baseScriptsPath, carpetaName);

            let files = [];
            try {
                files = await fs.readdir(folderPath, { withFileTypes: true });
            } catch (err) {
                // Ignore unreadable folders
                continue;
            }

            const archivos = [];
            for (const f of files) {
                if (!f.isFile()) continue;
                const ext = path.extname(f.name).toLowerCase();
                if (!['.py', '.bat', '.js', '.ps1', '.sh'].includes(ext)) continue;

                archivos.push({
                    archivo: f.name,
                    label: f.name.replace(/_/g, ' ').replace(/\.[^.]+$/, ''),
                    tipo: ext
                });
            }

            if (archivos.length > 0) {
                result[carpetaName] = {
                    carpeta: carpetaName,
                    archivos
                };
            }
        }

        return result;
    } catch (error) {
        logControllerError('script:listar', error);
        throw error;
    }
}
