const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const {
    getErrorMessage,
    isPathInsideBase,
    logControllerError,
    getDataPath,
    parseShellArgs
} = require('../utils/utils');

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

const quoteForCmd = (value) => {
    if (typeof value !== 'string') return value;
    if (value === '') return '""';
    if (/\s/.test(value) && !/^".*"$/.test(value)) {
        return `"${value}"`;
    }
    return value;
};

const buildExecutionCommand = (absolutePath, args) => {
    const extension = path.extname(absolutePath).toLowerCase();
    const parsedArgs = Array.isArray(args) ? args : parseShellArgs(args);
    const quotedPath = quoteForCmd(absolutePath);
    const quotedArgs = parsedArgs.map(quoteForCmd);

    if (extension === '.py') {
        return {
            bin: 'cmd.exe',
            args: ['/c', 'start', '""', 'python', quotedPath, ...quotedArgs]
        };
    }

    if (extension === '.bat' || extension === '.cmd') {
        return {
            bin: 'cmd.exe',
            args: ['/c', 'start', '""', quotedPath, ...quotedArgs]
        };
    }

    if (extension === '.exe') {
        return {
            bin: 'cmd.exe',
            args: ['/c', 'start', '""', quotedPath, ...quotedArgs]
        };
    }

    throw new Error(`Extensión de archivo no soportada: ${path.basename(absolutePath)}`);
};

const readScriptDescription = async (absolutePath) => {
    try {
        const ext = path.extname(absolutePath).toLowerCase();
        const raw = await fs.readFile(absolutePath, 'utf8');
        const lines = raw.split(/\r?\n/).slice(0, 20);

        // Skip shebang
        while (lines.length && lines[0].trim().startsWith('#!')) lines.shift();

        const excerpt = lines.join('\n');

        // Try several common patterns: docstrings / block comments / line comments
        let desc = '';

        // Python triple-quoted docstring
        const pyDoc = excerpt.match(/^\s*(?:['"]{3})([\s\S]*?)(?:['"]{3})/);
        if (pyDoc) desc = pyDoc[1].trim();

        // JS/C-style block comment
        if (!desc) {
            const jsBlock = excerpt.match(/^\s*\/\*([\s\S]*?)\*\//);
            if (jsBlock) desc = jsBlock[1].replace(/^\s*\*+\s?/gm, '').trim();
        }

        // PowerShell block comment <# #>
        if (!desc) {
            const psBlock = excerpt.match(/^\s*<\#([\s\S]*?)#\>/);
            if (psBlock) desc = psBlock[1].trim();
        }

        // Line comments collection (contiguous at top)
        if (!desc) {
            let commentLineRegex;
            if (ext === '.py' || ext === '.sh' || ext === '.ps1') commentLineRegex = /^\s*#\s?/;
            else if (ext === '.js') commentLineRegex = /^\s*\/\/\s?/;
            else if (ext === '.bat' || ext === '.cmd') commentLineRegex = /^\s*(?:rem\s+|::\s?)/i;
            else commentLineRegex = /^\s*#\s?/;

            const commentLines = [];
            for (const l of lines) {
                if (commentLineRegex.test(l)) {
                    commentLines.push(l.replace(commentLineRegex, '').trim());
                } else if (l.trim() === '') {
                    if (commentLines.length > 0) break;
                    continue;
                } else {
                    if (commentLines.length > 0) break;
                    // stop if non-comment and we haven't collected any
                    break;
                }
            }

            if (commentLines.length) desc = commentLines.join(' ').trim();
        }

        if (!desc) return '';
        desc = desc.replace(/\s+/g, ' ').trim();
        if (desc.length > 240) desc = desc.slice(0, 237).trim() + '...';
        return desc;
    } catch (err) {
        return '';
    }
};

const runScriptExternally = async (scriptLabel, absolutePath, args) => {
    console.log(`[Script] Ejecutando externamente [${scriptLabel}] con args: ${args || 'ninguno'}`);

    try {
        const command = buildExecutionCommand(absolutePath, args);
        console.log(`Ejecutando: ${command.bin} ${command.args.join(' ')}`);

        const child = spawn(command.bin, command.args, {
            detached: true,
            windowsHide: false,
            stdio: 'ignore'
        });

        child.on('error', (error) => {
            logControllerError(`script:${scriptLabel}`, error);
        });

        child.unref();
        console.log(`[Script] ${scriptLabel} lanzado correctamente`);
    } catch (error) {
        logControllerError(`script:${scriptLabel}`, error);
    }
};

const validateDynamicPayload = (payload = {}) => {
    const { carpeta, archivo, args } = payload;

    if (!carpeta || !archivo || typeof carpeta !== 'string' || typeof archivo !== 'string') {
        throw new Error('Payload inválido para script dinámico');
    }

    const parsedArgs = parseShellArgs(args);
    return { carpeta, archivo, args: parsedArgs };
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
            console.error(`[Error] Script no encontrado: ${scriptId}`);
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

        const folderTasks = entries
            .filter(dirent => dirent.isDirectory())
            .map(async (dirent) => {
                const carpetaName = dirent.name;
                const folderPath = path.join(baseScriptsPath, carpetaName);

                let files = [];
                try {
                    files = await fs.readdir(folderPath, { withFileTypes: true });
                } catch (err) {
                    // Ignore unreadable folders
                    return null;
                }

                const archivos = await Promise.all(files.map(async (f) => {
                    if (!f.isFile()) return null;
                    const ext = path.extname(f.name).toLowerCase();
                    if (!['.py', '.bat', '.js', '.ps1', '.sh'].includes(ext)) return null;

                    const absoluteFilePath = path.join(folderPath, f.name);
                    let description = '';
                    try {
                        description = await readScriptDescription(absoluteFilePath);
                    } catch (err) {
                        description = '';
                    }

                    return {
                        archivo: f.name,
                        label: f.name.replace(/_/g, ' ').replace(/\.[^.]+$/, ''),
                        tipo: ext,
                        helpText: description || ''
                    };
                }));

                const validArchivos = archivos.filter(Boolean);
                return validArchivos.length > 0 ? [carpetaName, validArchivos] : null;
            });

        const folderResults = await Promise.all(folderTasks);
        for (const folderResult of folderResults) {
            if (!folderResult) continue;
            const [carpetaName, validArchivos] = folderResult;
            result[carpetaName] = {
                carpeta: carpetaName,
                archivos: validArchivos
            };
        }

        return result;
    } catch (error) {
        logControllerError('script:listar', error);
        throw error;
    }
}
