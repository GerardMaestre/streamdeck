const fs = require('fs/promises');
const path = require('path');
const {
    getErrorMessage,
    isPathInsideBase,
    logControllerError,
    runSpawnCommand,
    safeSocketEmit
} = require('./utils');

const baseScriptsPath = path.join(__dirname, '..', 'mis_scripts');

const scripts = {
    purgar_ram: path.join(baseScriptsPath, '02_Optimizacion_Gaming', 'Purgar_ram.py'),
    limpiar_shaders: path.join(baseScriptsPath, '02_Optimizacion_Gaming', 'Purgador_Shaders.py'),
    modo_tryhard: path.join(baseScriptsPath, '02_Optimizacion_Gaming', 'Despertar_Nucleos.bat'),
    limpieza_global: path.join(baseScriptsPath, '04_Utilidades_Archivos', 'Limpieza_Extrema_Global.py')
};

const emitScriptLog = (socket, data) => {
    safeSocketEmit(socket, 'script_log', { data });
};

const emitScriptError = (socket, payload) => {
    safeSocketEmit(socket, 'script_error', payload);
};

const emitScriptSuccess = (socket) => {
    safeSocketEmit(socket, 'script_success');
};

const ensureFileExists = async (absolutePath) => {
    await fs.access(absolutePath);
};

const buildExecutionConfig = (absolutePath) => {
    const extension = path.extname(absolutePath).toLowerCase();

    if (extension === '.py') {
        return {
            bin: 'python',
            args: [absolutePath],
            options: {}
        };
    }

    if (extension === '.bat') {
        return {
            bin: 'cmd.exe',
            args: ['/c', absolutePath],
            options: { shell: true }
        };
    }

    throw new Error(`Extensión de archivo no soportada: ${path.basename(absolutePath)}`);
};

const runScript = async (scriptLabel, absolutePath, socket) => {
    const execution = buildExecutionConfig(absolutePath);

    console.log(`⏳ Ejecutando script [${scriptLabel}]...`);

    try {
        const { code } = await runSpawnCommand({
            bin: execution.bin,
            args: execution.args,
            options: execution.options,
            onStdout: (data) => {
                const text = data.toString();
                console.log(`[${scriptLabel} stdout]:`, text.trim());
                emitScriptLog(socket, text);
            },
            onStderr: (data) => {
                const text = data.toString();
                console.warn(`[${scriptLabel} stderr]:`, text.trim());
                emitScriptLog(socket, text);
            },
            onError: (error) => {
                logControllerError(`script:${scriptLabel}`, error);
            }
        });

        console.log(`✅ ${scriptLabel} terminó con código ${code}`);
        emitScriptSuccess(socket);
    } catch (error) {
        if (typeof error?.code === 'number') {
            console.error(`❌ ${scriptLabel} terminó con código ${error.code}`);
            emitScriptError(socket, { code: error.code });
            return;
        }

        const message = getErrorMessage(error);
        logControllerError(`script:${scriptLabel}`, error);
        emitScriptLog(socket, `${message}\n`);
        emitScriptError(socket, { message });
    }
};

const validateDynamicPayload = (payload = {}) => {
    const { carpeta, archivo } = payload;

    if (!carpeta || !archivo || typeof carpeta !== 'string' || typeof archivo !== 'string') {
        throw new Error('Payload inválido para script dinámico');
    }

    return { carpeta, archivo };
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
            const message = `Script no encontrado: ${scriptId}`;
            console.error(`❌ ${message}`);
            emitScriptLog(socket, `❌ ${message}\n`);
            emitScriptError(socket, { message });
            return;
        }

        await ensureFileExists(absolutePath);
        await runScript(scriptId, absolutePath, socket);
    } catch (error) {
        const message = getErrorMessage(error);
        logControllerError(`script:${scriptId}`, error);
        emitScriptLog(socket, `❌ ${message}\n`);
        emitScriptError(socket, { message });
    }
};

const ejecutarScriptDinamico = async (payload, socket) => {
    try {
        const { carpeta, archivo } = validateDynamicPayload(payload);
        const absolutePath = resolveSafeScriptPath(carpeta, archivo);

        await ensureFileExists(absolutePath);
        await runScript(`${carpeta}/${archivo}`, absolutePath, socket);
    } catch (error) {
        const message = getErrorMessage(error);
        logControllerError('script:dinamico', error);
        emitScriptLog(socket, `❌ ${message}\n`);
        emitScriptError(socket, { message });
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
                    path: path.join('mis_scripts', carpetaName),
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
