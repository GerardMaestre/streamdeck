const fs = require('fs');
const path = require('path');
const { appStateStore } = require('../data/state-store');
const {
    createSafeSocketHandler,
    getDataPath,
    getErrorMessage,
    isPathInsideBase,
    logControllerError
} = require('../utils/utils');
const Logger = require('../core/logger/logger');

let audioHostWindow = null;
let knownDevices = [];
let currentSinkId = '';
let ipcHandlersRegistered = false;
let supportsSinkSelection = false;

const VALID_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.m4a']);

try {
    const persisted = appStateStore.get('persistedSoundboard') || {};
    currentSinkId = persisted.sinkId || '';
} catch (_) {}

const getSoundboardDir = () => getDataPath('data/soundboard');

function ensureSoundboardDir(dir = getSoundboardDir()) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function isValidSoundFileName(fileName) {
    if (typeof fileName !== 'string') return false;
    const trimmed = fileName.trim();
    if (!trimmed || trimmed.length > 255) return false;
    if (trimmed.includes('\0')) return false;
    if (trimmed !== path.basename(trimmed)) return false;
    return VALID_AUDIO_EXTENSIONS.has(path.extname(trimmed).toLowerCase());
}

function resolveSoundFilePath(fileName, dir = getSoundboardDir()) {
    if (!isValidSoundFileName(fileName)) {
        const error = new Error('Nombre de audio invalido');
        error.code = 'INVALID_SOUND_FILE';
        throw error;
    }

    const baseDir = path.resolve(dir);
    const filePath = path.resolve(baseDir, fileName);
    if (!isPathInsideBase(baseDir, filePath)) {
        const error = new Error('Ruta de audio fuera del directorio permitido');
        error.code = 'SOUND_PATH_ESCAPE';
        throw error;
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
        const error = new Error('El audio no es un archivo valido');
        error.code = 'SOUND_NOT_FILE';
        throw error;
    }

    return filePath;
}

function listAudioFiles(dir = getSoundboardDir()) {
    ensureSoundboardDir(dir);
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isValidSoundFileName(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function initAudioHost() {
    if (audioHostWindow) return true;

    try {
        const { BrowserWindow, ipcMain } = require('electron');
        const preloadPath = getDataPath('frontend/preload_audio.js');
        const htmlPath = getDataPath('frontend/audio_host.html');

        Logger.info('[Soundboard] Iniciando motor de audio invisible...');

        audioHostWindow = new BrowserWindow({
            show: false,
            width: 100,
            height: 100,
            webPreferences: {
                preload: preloadPath,
                nodeIntegration: false,
                contextIsolation: true,
                autoplayPolicy: 'no-user-gesture-required'
            }
        });

        audioHostWindow.loadFile(htmlPath);
        audioHostWindow.on('closed', () => {
            audioHostWindow = null;
        });

        if (!ipcHandlersRegistered) {
            ipcHandlersRegistered = true;
            ipcMain.on('audio-devices-reply', (_event, payload) => {
                const devices = Array.isArray(payload) ? payload : (payload?.devices || []);
                supportsSinkSelection = Boolean(payload?.supportsSinkSelection);
                knownDevices = devices
                    .filter((device) => device && typeof device.deviceId === 'string')
                    .map((device) => ({
                        deviceId: device.deviceId,
                        label: String(device.label || 'Dispositivo desconocido')
                    }));
                Logger.info(`[Soundboard] Dispositivos detectados: ${knownDevices.length}`);
            });
        }

        return true;
    } catch (error) {
        logControllerError('Soundboard:Init', error);
        return false;
    }
}

async function listarAudios() {
    try {
        return listAudioFiles(getSoundboardDir()).map((fileName) => ({
            id: Buffer.from(fileName).toString('base64url'),
            name: path.basename(fileName, path.extname(fileName)),
            fileName,
            url: `/audio/${encodeURIComponent(fileName)}`
        }));
    } catch (error) {
        logControllerError('Soundboard:List', error);
        return [];
    }
}

function triggerPlay(fileName) {
    if (!audioHostWindow) return { ok: false, error: 'Motor de audio no disponible' };

    const port = global.__streamdeck_port || 3000;
    const url = `http://localhost:${port}/audio/${encodeURIComponent(fileName)}`;
    Logger.info(`[Soundboard] Play -> ${fileName} (Sink: ${currentSinkId || 'Default'})`);

    audioHostWindow.webContents.send('play-sound', {
        url,
        sinkId: currentSinkId,
        volume: 1.0
    });

    return { ok: true };
}

function playSound(fileName) {
    try {
        resolveSoundFilePath(fileName);
    } catch (error) {
        Logger.warn(`[Soundboard] Play rechazado: ${getErrorMessage(error)}`);
        return { ok: false, error: getErrorMessage(error) };
    }

    if (!audioHostWindow) {
        if (!initAudioHost()) return { ok: false, error: 'Motor de audio no disponible' };
        setTimeout(() => triggerPlay(fileName), 1000);
        return { ok: true };
    }

    return triggerPlay(fileName);
}

function stopAll() {
    if (audioHostWindow) {
        audioHostWindow.webContents.send('stop-all-sounds');
    }
    return { ok: true };
}

function setOutputDevice(sinkId) {
    const normalizedSinkId = typeof sinkId === 'string' ? sinkId : '';
    const knownSink = !normalizedSinkId || knownDevices.some((device) => device.deviceId === normalizedSinkId);
    if (!knownSink) {
        return { ok: false, error: 'Dispositivo de salida no reconocido' };
    }

    currentSinkId = normalizedSinkId;
    appStateStore.set('persistedSoundboard', { sinkId: currentSinkId }).catch(() => {});
    Logger.info(`[Soundboard] Dispositivo de salida: ${currentSinkId || 'Default'}`);
    return { ok: true, currentSinkId };
}

function requestDeviceRefresh() {
    if (!audioHostWindow) initAudioHost();
    if (audioHostWindow) {
        audioHostWindow.webContents.send('refresh-audio-devices');
    }
}

function sendSoundboardAudio(req, res) {
    try {
        const filePath = resolveSoundFilePath(req.params.fileName);
        res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
        res.sendFile(filePath);
    } catch (error) {
        const status = error.code === 'INVALID_SOUND_FILE' || error.code === 'SOUND_PATH_ESCAPE' ? 400 : 404;
        res.status(status).json({ ok: false, error: getErrorMessage(error) });
    }
}

function registerSoundboardSocketHandlers(socket) {
    socket.on('soundboard_list', createSafeSocketHandler(socket, 'soundboard_list', async (_payload, ack) => {
        const sounds = await listarAudios();
        if (typeof ack === 'function') ack({ ok: true, sounds });
    }));

    socket.on('soundboard_play', createSafeSocketHandler(socket, 'soundboard_play', (payload, ack) => {
        const result = playSound(payload?.fileName);
        if (typeof ack === 'function') ack(result);
    }));

    socket.on('soundboard_stop', createSafeSocketHandler(socket, 'soundboard_stop', (_payload, ack) => {
        const result = stopAll();
        if (typeof ack === 'function') ack(result);
    }));

    socket.on('soundboard_get_status', createSafeSocketHandler(socket, 'soundboard_get_status', (_payload, ack) => {
        requestDeviceRefresh();
        if (typeof ack === 'function') {
            ack({
                ok: true,
                currentSinkId,
                devices: knownDevices,
                supportsSinkSelection
            });
        }
    }));

    socket.on('soundboard_set_device', createSafeSocketHandler(socket, 'soundboard_set_device', (payload, ack) => {
        const result = setOutputDevice(payload?.deviceId);
        if (typeof ack === 'function') ack(result);
    }));
}

module.exports = {
    initAudioHost,
    listarAudios,
    playSound,
    registerSoundboardSocketHandlers,
    sendSoundboardAudio,
    __test__: {
        getSoundboardDir,
        isValidSoundFileName,
        listAudioFiles,
        resolveSoundFilePath
    }
};
