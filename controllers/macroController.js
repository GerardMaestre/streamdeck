const os = require('os');
const { getErrorMessage, runExecCommand } = require('./utils');

const isWindows = () => os.platform() === 'win32';

const DISCORD_SHORTCUTS = {
    mutear_discord: {
        keyCodes: [17, 16, 77],
        successMessage: '🎙️ Micrófono de Discord alternado (Ctrl+Shift+M)'
    },
    ensordecer_discord: {
        keyCodes: [17, 16, 68],
        successMessage: '🎧 Auriculares de Discord alternados (Ctrl+Shift+D)'
    }
};

const MULTIMEDIA_KEY_CODES = {
    play_pause: 179,
    siguiente: 176,
    anterior: 177
};

const buildKeypressPowerShell = (keyCodes) => {
    const keyDown = keyCodes.map((code) => `$kb::keybd_event(${code}, 0, 0, 0);`).join(' ');
    const keyUp = [...keyCodes]
        .reverse()
        .map((code) => `$kb::keybd_event(${code}, 0, 2, 0);`)
        .join(' ');

    return `powershell -WindowStyle Hidden -Command "$code = '[DllImport(\\"user32.dll\\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);'; $kb = Add-Type -MemberDefinition $code -Name 'Keyboard' -PassThru; ${keyDown} ${keyUp}"`;
};

const executeWindowsKeypress = async (keyCodes, successMessage, errorScope) => {
    if (!isWindows()) {
        console.log('⚠️ Macro no soportada en este SO.');
        return;
    }

    try {
        const command = buildKeypressPowerShell(keyCodes);
        await runExecCommand(command);
        console.log(successMessage);
    } catch (error) {
        console.error(`❌ Error ${errorScope}:`, getErrorMessage(error));
        throw error;
    }
};

const ejecutarMacro = async (tipo) => {
    try {
        const shortcut = DISCORD_SHORTCUTS[tipo];

        if (!shortcut) {
            console.warn(`⚠️ Macro desconocida: ${tipo}`);
            return;
        }

        await executeWindowsKeypress(shortcut.keyCodes, shortcut.successMessage, tipo);
    } catch (error) {
        console.error(`❌ Error ejecutando la macro ${tipo}:`, error);
        throw error;
    }
};

const controlMultimedia = async (accion) => {
    try {
        const keyCode = MULTIMEDIA_KEY_CODES[accion];

        if (!keyCode) {
            console.warn(`⚠️ Acción multimedia no reconocida: ${accion}`);
            return;
        }

        if (!isWindows()) {
            console.log('⚠️ El control multimedia de Windows no está soportado en este SO.');
            return;
        }

        await executeWindowsKeypress([keyCode], `🎵 Comando multimedia ejecutado: ${accion}`, 'multimedia');
    } catch (error) {
        console.error(`❌ Error intentando ejecutar el control multimedia ${accion}:`, error);
        throw error;
    }
};

module.exports = {
    ejecutarMacro,
    controlMultimedia
};
