const loudness = require('loudness');
const path = require('path');
const { getErrorMessage, runExecCommand } = require('./utils');

const nircmdPath = path.join(__dirname, '..', 'mis_scripts', '05_Audio', 'nircmd.exe');

const normalizeVolume = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error('Valor de volumen inválido');
    }

    return Math.max(0, Math.min(100, Math.round(parsed)));
};

const sanitizeAppName = (app) => {
    const value = String(app || '').trim().replace(/\.exe$/i, '');

    if (!value || !/^[a-zA-Z0-9._-]+$/.test(value)) {
        throw new Error(`Nombre de aplicación inválido: ${app}`);
    }

    return value;
};

const controlVolumen = async (accion) => {
    try {
        const volActual = await loudness.getVolume();
        if (accion === 'subir') await loudness.setVolume(Math.min(volActual + 10, 100));
        if (accion === 'bajar') await loudness.setVolume(Math.max(volActual - 10, 0));
        if (accion === 'mutear') {
            const isMuted = await loudness.getMuted();
            await loudness.setMuted(!isMuted); 
        }
        console.log(`🔊 Acción de volumen ejecutada: ${accion}`);
    } catch (error) {
        console.error('❌ Error controlando el volumen:', error);
    }
};

const controlVolumenAbsoluto = async ({ app, value }) => {
    try {
        const safeVolume = normalizeVolume(value);

        if (app === 'global') {
            await loudness.setVolume(safeVolume);
            await loudness.setMuted(safeVolume === 0);
            console.log(`🔊 Volumen global ajustado a: ${safeVolume}%`);
        } else {
            // NirCmd usa valores de 0 a 1 para el sonido de apps por proceso (ej. 0.5 es 50%)
            const safeApp = sanitizeAppName(app);
            const nircmdValue = safeVolume / 100;
            await runExecCommand(`"${nircmdPath}" setappvolume ${safeApp}.exe ${nircmdValue}`);
            console.log(`🔊 Volumen de ${safeApp} ajustado a: ${safeVolume}%`);
        }
    } catch (error) {
        console.error('❌ Error controlando volumen absoluto:', getErrorMessage(error));
        throw error;
    }
};

module.exports = {
    controlVolumen,
    controlVolumenAbsoluto
};
