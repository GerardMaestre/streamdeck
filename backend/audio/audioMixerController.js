const { default: AudioMixer, DeviceType } = require('native-sound-mixer');
const path = require('path');

// Instancia global del dispositivo de salida
let defaultDevice;
let mixerPollInterval = null;
let mixerInitialized = false;
let currentDeviceListeners = null;
let localMasterMute = false;
const activeSessions = new Map();
const pollGroupedData = new Map();
const pollNames = new Set();
const pollGroupArrayPool = [];
const MAX_POLL_GROUPS = 256;
for (let i = 0; i < MAX_POLL_GROUPS; i += 1) pollGroupArrayPool.push([]);
const labelCache = new Map(); // Caché para nombres de aplicaciones

// Constantes de configuración
const POLL_INTERVAL_MS = 250;  // 300→250: Respuesta más instantánea
const DEBOUNCE_MS = 350;       // 400→350: Ventana de protección optimizada
const VOL_THRESHOLD = 0.5;     // Diferencia mínima para emitir cambio (evita ruido jitter)
function getAppLabel(session) {
    let rawName = session.appName || session.name;
    if (!rawName) return null;

    // Usar caché si ya hemos procesado esto
    if (labelCache.has(rawName)) return labelCache.get(rawName);

    rawName = rawName.replace(/[^\x20-\x7E]/g, '').trim();
    if (!rawName) {
        labelCache.set(session.appName || session.name, null);
        return null;
    }

    if (rawName.toLowerCase().includes('audiosrv') || rawName.toLowerCase() === 'system sounds') {
        labelCache.set(rawName, 'Sonidos del sistema');
        return 'Sonidos del sistema';
    }

    if (rawName.startsWith('@')) {
        labelCache.set(rawName, null);
        return null;
    }

    const baseName = path.basename(rawName);
    const cleanLower = baseName.toLowerCase().replace(/\.exe$/i, '').trim();

    // Filtro avanzado: Eliminar ruido hexadecimal (sesiones fantasma como '0d', '1a', 'ff')
    if (/^[0-9a-f]{1,4}$/i.test(cleanLower)) {
        labelCache.set(rawName, null);
        return null;
    }

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
        'qemu-system': 'QEMU Emulator',
        'telegram': 'Telegram',
        'whatsapp': 'WhatsApp',
        'league of legends': 'League of Legends',
        'valorant': 'Valorant',
        'update': 'Update'
    };

    let prettyName = null;
    for (const key in diccionario) {
        if (cleanLower.includes(key)) {
            prettyName = diccionario[key];
            break;
        }
    }

    if (!prettyName) {
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
            'nvsphelper64', 'rtkngui64', 'nahimic', 'wavesyssvc', 'securityhealthsystray',
            'msedgewebview2', 'devicedriver', 'dock_64', 'antigravity', 'wallpaper64', 'wallpaper32'
        ];

        if (cleanLower.length <= 1 || cleanLower.includes('{') || cleanLower.includes('}')) {
            prettyName = null;
        } else if (blacklist.some(bad => cleanLower.includes(bad))) {
            prettyName = null;
        } else {
            prettyName = cleanLower.replace(/[-_]/g, ' ').trim();
            prettyName = prettyName.replace(/\b\w/g, c => c.toUpperCase());
        }
    }

    labelCache.set(session.appName || session.name, prettyName);
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
            console.error('[Audio] No se encontro dispositivo de audio principal.');
        } else {
            try {
                localMasterMute = defaultDevice.mute;
                console.log(`[Audio] Dispositivo inicial: ${defaultDevice.name} | mute=${localMasterMute}`);
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

    // Reusar las colecciones para evitar nuevas asignaciones cada 250ms
    pollGroupedData.forEach((group) => {
        group.length = 0;
        pollGroupArrayPool.push(group);
    });
    pollGroupedData.clear();
    pollNames.clear();

    const currentSessions = defaultDevice.sessions;

    // 1. Agrupación eficiente
    for (let i = 0; i < currentSessions.length; i++) {
        const session = currentSessions[i];

        // Mostrar sesiones inactivas si tienen volumen o mute configurado,
        // para que apps como Navedaro aparezcan incluso antes de reproducir.
        const isSilentInactive = session.state !== 1 && session.volume === 0 && !session.mute;
        if (isSilentInactive) continue;

        const label = getAppLabel(session);
        if (!label) continue; 

        let group = pollGroupedData.get(label);
        if (!group) {
            group = pollGroupArrayPool.pop() || [];
            pollGroupedData.set(label, group);
            pollNames.add(label);
        }
        group.push(session);
    }

    // 2. Procesamiento de cambios
    for (const [label, sessions] of pollGroupedData.entries()) {
        let maxVol = 0;
        let isMuted = false;

        for (let j = 0; j < sessions.length; j++) {
            const s = sessions[j];
            const v = s.volume * 100;
            if (v > maxVol) maxVol = v;
            if (s.mute) isMuted = true;
        }
        
        const roundedVol = Math.round(maxVol);
        let stored = activeSessions.get(label);

        if (stored) {
            // Debounce contra cambios manuales del usuario en la tablet
            if (stored.lastUserUpdate && (Date.now() - stored.lastUserUpdate < DEBOUNCE_MS)) {
                continue;
            }

            stored.sessions = sessions;

            // Solo emitir si hay cambio real (usando threshold para volumen)
            const volChanged = Math.abs(stored.lastVolume - roundedVol) >= VOL_THRESHOLD;
            const muteChanged = stored.lastMute !== isMuted;

            if (volChanged) {
                stored.lastVolume = roundedVol;
                io.emit('session_updated', { name: label, type: 'volume', value: roundedVol });
            }
            if (muteChanged) {
                stored.lastMute = isMuted;
                io.emit('session_updated', { name: label, type: 'mute', value: isMuted });
            }
        } else {
            // Nueva sesión
            activeSessions.set(label, {
                sessions,
                lastVolume: roundedVol,
                lastMute: isMuted,
                lastUserUpdate: 0
            });
            io.emit('session_added', { name: label, volume: roundedVol, mute: isMuted });
        }
    }

    // 3. Limpieza de sesiones huérfanas
    if (activeSessions.size > currentNames.size) {
        for (const [name] of activeSessions.entries()) {
            if (!currentNames.has(name)) {
                activeSessions.delete(name);
                io.emit('session_removed', { name });
            }
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
        try { 
            if (defaultDevice) {
                defaultDevice.volume = value / 100; 
                // Evitamos el ping-pong: Solo informamos a los demás clientes
                socket.broadcast.emit('master_updated', { type: 'volume', value: Math.round(value) });
            }
        } catch (e) {}
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
            const targetVolume = Math.max(0, Math.min(100, Number(value)));

            if (stored.lastVolume === targetVolume) {
                stored.lastUserUpdate = Date.now();
                return;
            }

            stored.sessions.forEach((session) => {
                try { session.volume = targetVolume / 100; } catch (error) {}
            });

            stored.lastVolume = targetVolume;
            stored.lastUserUpdate = Date.now();

            const updatePayload = { name: app, type: 'volume', value: targetVolume };
            // CRÍTICO: Usar solo broadcast para no saturar al cliente que está deslizando
            socket.broadcast.emit('session_updated', updatePayload);
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