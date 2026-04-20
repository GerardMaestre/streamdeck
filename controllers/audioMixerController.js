const { default: AudioMixer, DeviceType } = require('native-sound-mixer');
const path = require('path');

// Instancia global del dispositivo de salida
let defaultDevice;
let mixerPollInterval = null;
let mixerInitialized = false;
let currentDeviceListeners = null;
let localMasterMute = false;
const activeSessions = new Map();

// Constantes de configuración
const POLL_INTERVAL_MS = 600;
const DEBOUNCE_MS = 1500; 

function getAppLabel(session) {
    let rawName = session.appName || session.name;
    if (!rawName) return null;

    rawName = rawName.replace(/[^\x20-\x7E]/g, '').trim();
    if (!rawName) return null;

    if (rawName.toLowerCase().includes('audiosrv') || rawName.toLowerCase() === 'system sounds') {
        return 'Sonidos del sistema';
    }

    if (rawName.startsWith('@')) return null;

    let safeName = rawName.split('%b')[0].split(',-')[0];
    let baseName = path.basename(safeName);
    let lower = baseName.toLowerCase();
    let cleanLower = lower.replace(/\.exe$/i, '').trim();

    // Filtro avanzado: Eliminar ruido hexadecimal (sesiones fantasma como '0d', '1a', 'ff')
    if (/^[0-9a-f]{1,4}$/i.test(cleanLower)) return null;

    const diccionario = {
        'spotify': 'Spotify',
        'chrome': 'Google Chrome',
        'msedge': 'Microsoft Edge',
        'discord': 'Discord',
        'steam': 'Steam',
        'obs64': 'OBS Studio',
        'obs32': 'OBS Studio',
        'audiodg': 'Sonidos del sistema',
        'systemsounds': 'Sonidos del sistema',
        'firefox': 'Firefox',
        'brave': 'Brave',
        'vlc': 'VLC Player',
        'sunshine': 'Sunshine',
        'powertoys': 'PowerToys',
        'wallpaper64': 'Wallpaper Engine',
        'wallpaper32': 'Wallpaper Engine',
        'qemu-system': 'QEMU Emulator',
        'telegram': 'Telegram',
        'whatsapp': 'WhatsApp',
        'league of legends': 'League of Legends',
        'valorant': 'Valorant',
        'devicedriver': 'Device Driver',
        'update': 'Update'
    };

    for (const key in diccionario) {
        if (cleanLower.includes(key)) {
            return diccionario[key];
        }
    }

    // Lista negra quirúrgica (Oculta solo basura real del sistema)
    const blacklist = [
        'searchhost', 'shellexperiencehost', 'svchost', 'startmenuexperiencehost',
        'widgets', 'applicationframehost', 'backgroundtaskhost', 'searchapp', 'explorer', 'taskhostw', 
        'cmd', 'conhost', 'systemsettings', 'lockapp', 'textinputhost', 'idle', 
        'system', 'registry', 'smss', 'csrss', 'lsass', 'services', 'spoolsv',
        'audioclientrpc', 'esday', 'rundll32', 'dllhost', 'runtimebroker', 'sihost',
        'fontdrvhost', 'dwm', 'ctfmon', 'nvcontainer', 'nvdisplay', 'amdow', 
        'amdrsserv', 'wusa', 'wmiprvse', 'dashost', 'host32', 'host64', 'wsappx',
        'mousoftwareworker', 'usocoreworker', 'compattelrunner', 'vmmem', 'userinit', 
        'wininit', 'winlogon', 'crashpad_handler', 'wermgr', 'werfault', 
        'backgroundtransferhost', 'smartscreen', 'igfxcuiservice', 'igfxem', 
        'nvsphelper64', 'rtkngui64', 'nahimic', 'wavesyssvc', 'securityhealthsystray'
    ];

    if (cleanLower.length <= 1 || cleanLower.includes('{') || cleanLower.includes('}')) return null;
    if (blacklist.some(bad => cleanLower === bad || cleanLower.startsWith(bad))) return null;

    let prettyName = cleanLower.replace(/[-_]/g, ' ').trim();
    prettyName = prettyName.replace(/\b\w/g, c => c.toUpperCase());

    return prettyName;
}

function detachListenersFromDefaultDevice() {
    if (!defaultDevice || !currentDeviceListeners) return;
    try {
        if (currentDeviceListeners.volumeId !== undefined) {
            defaultDevice.removeListener('volume', currentDeviceListeners.volumeId);
        }
        if (currentDeviceListeners.muteId !== undefined) {
            defaultDevice.removeListener('mute', currentDeviceListeners.muteId);
        }
    } catch (error) {} finally {
        currentDeviceListeners = null;
    }
}

function assignListenersToDefaultDevice(device, io) {
    detachListenersFromDefaultDevice();

    const onVolume = (vol) => {
        const volume = Math.round(vol * 100);
        io.emit('master_updated', { type: 'volume', value: volume });
    };

    const onMute = (mute) => {
        localMasterMute = mute; 
        io.emit('master_updated', { type: 'mute', value: mute });
    };

    const volumeId = device.on('volume', onVolume);
    const muteId = device.on('mute', onMute);

    currentDeviceListeners = { volumeId, muteId };
}

function initAudioMixer(io) {
    if (mixerInitialized) return;

    try {
        defaultDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);

        if (!defaultDevice) {
            console.error('❌ No se encontró dispositivo de audio principal.');
        } else {
            try {
                localMasterMute = defaultDevice.mute;
                console.log(`🔊 Dispositivo inicial: ${defaultDevice.name} | mute=${localMasterMute}`);
            } catch (e) {}

            assignListenersToDefaultDevice(defaultDevice, io);
            pollSessions(io); 
        }

        mixerPollInterval = setInterval(() => {
            try {
                const currentDefault = AudioMixer.getDefaultDevice(DeviceType.RENDER);

                if (currentDefault && (!defaultDevice || currentDefault.name !== defaultDevice.name)) {
                    detachListenersFromDefaultDevice();
                    defaultDevice = currentDefault;
                    try { localMasterMute = defaultDevice.mute; } catch (_) {}

                    assignListenersToDefaultDevice(defaultDevice, io);
                    activeSessions.clear();
                    pollSessions(io);
                    io.emit('mixer_initial_state', getInitialStateData());
                    return;
                }

                pollSessions(io);
            } catch (err) {}
        }, POLL_INTERVAL_MS);

        mixerInitialized = true;

    } catch (error) {}
}

function pollSessions(io) {
    if (!defaultDevice) return;

    const currentSessions = defaultDevice.sessions;
    const grouped = new Map();
    
    currentSessions.forEach((session) => {
        const label = getAppLabel(session);
        if (!label) return; 

        if (!grouped.has(label)) grouped.set(label, []);
        grouped.get(label).push(session);
    });

    const currentNames = new Set(grouped.keys());

    for (const [label, sessions] of grouped.entries()) {
        let maxVol = 0;
        let isMuted = false;

        for (const s of sessions) {
            const v = Math.round(s.volume * 100);
            if (v > maxVol) maxVol = v;
            if (s.mute) isMuted = true;
        }

        let stored = activeSessions.get(label);

        if (stored && stored.lastUserUpdate) {
            const timeSinceDrag = Date.now() - stored.lastUserUpdate;
            if (timeSinceDrag < DEBOUNCE_MS) {
                maxVol = stored.lastVolume;
                isMuted = stored.lastMute;
            }
        }

        if (!stored) {
            activeSessions.set(label, {
                sessions,
                lastVolume: maxVol,
                lastMute: isMuted,
                lastUserUpdate: 0
            });
            io.emit('session_added', { name: label, volume: maxVol, mute: isMuted });
        } else {
            stored.sessions = sessions;

            if (stored.lastVolume !== maxVol) {
                stored.lastVolume = maxVol;
                io.emit('session_updated', { name: label, type: 'volume', value: maxVol });
            }
            if (stored.lastMute !== isMuted) {
                stored.lastMute = isMuted;
                io.emit('session_updated', { name: label, type: 'mute', value: isMuted });
            }
        }
    }

    for (const [name] of activeSessions.entries()) {
        if (!currentNames.has(name)) {
            activeSessions.delete(name);
            io.emit('session_removed', { name });
        }
    }
}

function getInitialStateData() {
    if (!defaultDevice) return { master: { volume: 0, mute: false }, sessions: [] };

    return {
        master: {
            volume: Math.round(defaultDevice.volume * 100),
            mute: defaultDevice.mute
        },
        sessions: Array.from(activeSessions.entries()).map(([name, s]) => ({
            name,
            volume: s.lastVolume,
            mute: s.lastMute
        }))
    };
}

function sendInitialState(socket) {
    const initialState = getInitialStateData();
    socket.emit('mixer_initial_state', initialState);
}

function handleSocketCommands(socket) {
    socket.on('set_master_volume', (value) => {
        try { if (defaultDevice) defaultDevice.volume = value / 100; } catch (e) {}
    });

    socket.on('toggle_master_mute', () => {
        try {
            if (defaultDevice) {
                const newState = !localMasterMute;
                defaultDevice.mute = newState;
                localMasterMute = newState;
                
                const payload = { type: 'mute', value: newState };
                socket.emit('master_updated', payload);
                socket.broadcast.emit('master_updated', payload);
            }
        } catch (error) {}
    });

    socket.on('set_session_volume', ({ app, value }) => {
        try {
            const stored = activeSessions.get(app);
            if (!stored) return;
            stored.sessions.forEach((s) => { s.volume = value / 100; });
            stored.lastVolume = value;
            stored.lastUserUpdate = Date.now();
        } catch (e) {}
    });

    socket.on('toggle_session_mute', (payload) => {
        const app = typeof payload === 'string' ? payload : payload?.app;

        try {
            const stored = activeSessions.get(app);
            if (!stored || stored.sessions.length === 0) return;

            const newState = !stored.lastMute;

            stored.sessions.forEach((s) => { 
                try { s.mute = newState; } catch(e) {}
            });
            stored.lastMute = newState;
            stored.lastUserUpdate = Date.now();

            const updatePayload = { name: app, type: 'mute', value: newState };
            socket.emit('session_updated', updatePayload);
            socket.broadcast.emit('session_updated', updatePayload);

        } catch (error) {}
    });
}

function destroyAudioMixer() {
    if (mixerPollInterval) {
        clearInterval(mixerPollInterval);
        mixerPollInterval = null;
    }
    detachListenersFromDefaultDevice();
    activeSessions.clear();
    mixerInitialized = false;
    defaultDevice = null;
}

module.exports = {
    initAudioMixer, sendInitialState, handleSocketCommands, destroyAudioMixer
};