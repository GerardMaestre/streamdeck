/**
 * Discord Facade Controller
 * Refactorizado bajo la regla Single Responsibility y Zero-Crash
 */

const discordConnectionManager = require('./discordConnectionManager');
const discordVoiceService = require('./discordVoiceService');

const initDiscordRPC = (io) => {
    try {
        console.log('[Discord Facade] Inicializando servicios RPC...');
        discordVoiceService.init(discordConnectionManager, io);
    } catch (error) {
        console.error('[Discord Facade] Fallo inicializando subsistema Discord:', error.message);
    }
};

const discordToggleMute = async () => {
    return await discordVoiceService.toggleMute();
};

const discordToggleDeaf = async () => {
    return await discordVoiceService.toggleDeaf();
};

const discordSetUserVolume = async (userId, volume) => {
    return await discordVoiceService.setUserVolume(userId, volume);
};

const requestInitialDiscordState = async (socket) => {
    return await discordVoiceService.requestInitialState(socket);
};

module.exports = {
    initDiscordRPC,
    discordToggleMute,
    discordToggleDeaf,
    discordSetUserVolume,
    requestInitialDiscordState
};
