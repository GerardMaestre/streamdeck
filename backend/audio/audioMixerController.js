const { default: AudioMixer, DeviceType } = require('native-sound-mixer');
const path = require('path');
const { execFile } = require('child_process');
const { appStateStore } = require('../data/state-store');

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
const boundSockets = new Set(); // Guard para evitar listeners duplicados por socket
let globalIo = null;

// Constantes de configuración — Polling adaptativo
const POLL_INTERVAL_ACTIVE_MS = 250;  // Cuando el mixer está visible o hay sliders activos
const POLL_INTERVAL_IDLE_MS = 1000;   // Reposo: reduce CPU cuando la tablet está en la grid
let currentPollIntervalMs = POLL_INTERVAL_IDLE_MS;
let lastSliderActivity = 0;           // Timestamp de última interacción
let visibleMixerClients = 0;
const SLIDER_ACTIVITY_TIMEOUT = 2000; // Después de 2s sin actividad → modo idle
const DEBOUNCE_MS = 350;       // 400→350: Ventana de protección optimizada
const VOL_THRESHOLD = 0.5;     // Diferencia mínima para emitir cambio (evita ruido jitter)
const ALWAYS_SHOW_SILENT_SESSIONS = new Set(['Spotify', 'Google Chrome', 'Firefox', 'VLC Player', 'OBS Studio', 'Discord']);
const KNOWN_VISIBLE_PROCESSES = new Map([
    ['spotify.exe', 'Spotify'],
    ['chrome.exe', 'Google Chrome'],
    ['firefox.exe', 'Firefox'],
    ['vlc.exe', 'VLC Player'],
    ['obs64.exe', 'OBS Studio'],
    ['obs32.exe', 'OBS Studio'],
    ['discord.exe', 'Discord']
]);
const visibleProcessLabels = new Set();
let lastProcessScanAt = 0;
let processScanInFlight = false;
const PROCESS_SCAN_INTERVAL_MS = 5000;

function refreshVisibleProcessLabels() {
    if (process.platform !== 'win32') return;
    const now = Date.now();
    if (processScanInFlight || now - lastProcessScanAt < PROCESS_SCAN_INTERVAL_MS) return;
    processScanInFlight = true;
    lastProcessScanAt = now;

    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 2000 }, (error, stdout) => {
        processScanInFlight = false;
        if (error || !stdout) return;

        const nextLabels = new Set();
        const lowerOutput = stdout.toLowerCase();
        for (const [exeName, label] of KNOWN_VISIBLE_PROCESSES.entries()) {
            if (lowerOutput.includes(`"${exeName}"`) || lowerOutput.includes(exeName)) {
                nextLabels.add(label);
            }
        }

        visibleProcessLabels.clear();
        nextLabels.forEach((label) => visibleProcessLabels.add(label));
    });
}

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

    // Array ordenado por especificidad (más específico primero para evitar conflictos de matching)
    // Ej: "league of legends" debe matchear antes que solo "legends"
    const matchingRules = [
        { pattern: 'league of legends', name: 'League of Legends' },
        { pattern: 'qemu-system', name: 'QEMU Emulator' },
        { pattern: 'spotify', name: 'Spotify' },
        { pattern: 'chrome', name: 'Google Chrome' },
        { pattern: 'msedge', name: 'Microsoft Edge' },
        { pattern: 'discord', name: 'Discord' },
        { pattern: 'steam', name: 'Steam' },
        { pattern: 'obs64', name: 'OBS Studio' },
        { pattern: 'obs32', name: 'OBS Studio' },
        { pattern: 'audiodg', name: 'Sonidos del sistema' },
        { pattern: 'systemsounds', name: 'Sonidos del sistema' },
        { pattern: 'firefox', name: 'Firefox' },
        { pattern: 'brave', name: 'Brave' },
        { pattern: 'vlc', name: 'VLC Player' },
        { pattern: 'sunshine', name: 'Sunshine' },
        { pattern: 'powertoys', name: 'PowerToys' },
        { pattern: 'telegram', name: 'Telegram' },
        { pattern: 'whatsapp', name: 'WhatsApp' },
        { pattern: 'valorant', name: 'Valorant' },
        { pattern: 'update', name: 'Update' }
    ];

    let prettyName = null;
    for (const rule of matchingRules) {
        if (cleanLower.includes(rule.pattern)) {
            prettyName = rule.name;
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
    globalIo = io;

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

        // Polling adaptativo: ajusta el intervalo según actividad de sliders
        const runPollCycle = () => {
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

            // Ajustar intervalo: rápido si hay actividad reciente, lento si idle
            const now = Date.now();
            const isActive = visibleMixerClients > 0 || (now - lastSliderActivity) < SLIDER_ACTIVITY_TIMEOUT;
            const desiredInterval = isActive ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;

            if (desiredInterval !== currentPollIntervalMs) {
                currentPollIntervalMs = desiredInterval;
                clearInterval(mixerPollInterval);
                mixerPollInterval = setInterval(runPollCycle, currentPollIntervalMs);
            }
        };

        mixerPollInterval = setInterval(runPollCycle, currentPollIntervalMs);



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

    const batchUpdates = { sessions: [], removed: [] };

    const currentSessions = defaultDevice.sessions;
    if (visibleMixerClients > 0) refreshVisibleProcessLabels();

    // 1. Agrupación eficiente
    for (let i = 0; i < currentSessions.length; i++) {
        const session = currentSessions[i];
        const label = getAppLabel(session);
        if (!label) continue;

        const isSilentInactive = session.state !== 1 && session.volume === 0 && !session.mute;
        if (isSilentInactive && !ALWAYS_SHOW_SILENT_SESSIONS.has(label)) continue;

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
        const sessionsSnapshot = sessions.slice();

        for (let j = 0; j < sessionsSnapshot.length; j++) {
            const s = sessionsSnapshot[j];
            const v = s.volume * 100;
            if (v > maxVol) maxVol = v;
            if (s.mute) isMuted = true;
        }
        
        let roundedVol = Math.round(maxVol);
        let stored = activeSessions.get(label);

        if (stored?.processOnly && sessionsSnapshot.length > 0) {
            roundedVol = stored.lastVolume;
            sessionsSnapshot.forEach((session) => {
                try { session.volume = roundedVol / 100; } catch (_) {}
            });
            stored.processOnly = false;
        }

        // LOG: Si hay múltiples sesiones bajo el mismo label
        if (sessionsSnapshot.length > 1) {
            console.log(`ℹ️  [Mixer] Label "${label}" has ${sessionsSnapshot.length} sessions:`, sessionsSnapshot.map(s => s.appName).join(', '));
        }

        if (stored) {
            // Debounce contra cambios manuales del usuario en la tablet
            if (stored.lastUserUpdate && (Date.now() - stored.lastUserUpdate < DEBOUNCE_MS)) {
                continue;
            }

            stored.sessions = sessionsSnapshot;

            // Solo emitir si hay cambio real (usando threshold para volumen)
            const volChanged = Math.abs(stored.lastVolume - roundedVol) >= VOL_THRESHOLD;
            const muteChanged = stored.lastMute !== isMuted;

            if (volChanged || muteChanged) {
                const sessionUpdate = { name: label };
                if (volChanged) {
                    stored.lastVolume = roundedVol;
                    sessionUpdate.volume = roundedVol;
                }
                if (muteChanged) {
                    stored.lastMute = isMuted;
                    sessionUpdate.mute = isMuted;
                }
                batchUpdates.sessions.push(sessionUpdate);
            }
        } else {
            // Nueva sesión
            activeSessions.set(label, {
                sessions: sessionsSnapshot,
                lastVolume: roundedVol,
                lastMute: isMuted,
                lastUserUpdate: 0
            });
            batchUpdates.sessions.push({ name: label, volume: roundedVol, mute: isMuted });
        }
    }

    const persistedMixer = appStateStore.get('persistedMixer') || {};
    const persistedSessions = persistedMixer.sessions || {};
    for (const label of visibleProcessLabels) {
        if (pollNames.has(label)) continue;
        pollNames.add(label);
        if (activeSessions.has(label)) continue;

        const persisted = persistedSessions[label] || {};
        const volume = Number.isFinite(persisted.volume) ? persisted.volume : 100;
        const mute = typeof persisted.mute === 'boolean' ? persisted.mute : false;
        activeSessions.set(label, {
            sessions: [],
            lastVolume: volume,
            lastMute: mute,
            lastUserUpdate: 0,
            lastUserUpdate: 0,
            processOnly: true
        });
        batchUpdates.sessions.push({ name: label, volume, mute });
    }

    // 3. Limpieza de sesiones huérfanas
    if (activeSessions.size > pollNames.size) {
        for (const [name] of activeSessions.entries()) {
            if (!pollNames.has(name)) {
                activeSessions.delete(name);
                batchUpdates.removed.push(name);
            }
        }
    }

    if (batchUpdates.sessions.length > 0 || batchUpdates.removed.length > 0) {
        io.emit('mixer_batch', batchUpdates);
    }
}

function getInitialStateData() {
    if (!defaultDevice) return { master: { volume: 0, mute: false }, sessions: [] };

    const persistedMixer = appStateStore.get('persistedMixer') || {};
    const persistedSessions = persistedMixer.sessions || {};

    return {
        master: {
            volume: Math.round(defaultDevice.volume * 100),
            mute: typeof persistedMixer.masterMute === 'boolean' ? persistedMixer.masterMute : defaultDevice.mute
        },
        sessions: Array.from(activeSessions.entries()).map(([name, s]) => {
            const persisted = persistedSessions[name] || {};
            return {
                name,
                volume: Number.isFinite(persisted.volume) ? persisted.volume : s.lastVolume,
                mute: typeof persisted.mute === 'boolean' ? persisted.mute : s.lastMute
            };
        })
    };
}

function persistMixerSessionState(name, volume, mute) {
    const persisted = appStateStore.get('persistedMixer') || { sessions: {} };
    persisted.sessions = persisted.sessions || {};
    persisted.sessions[name] = { volume, mute };
    appStateStore.set('persistedMixer', persisted).catch(() => {});
}

function persistMasterState(mute) {
    const persisted = appStateStore.get('persistedMixer') || { sessions: {} };
    persisted.sessions = persisted.sessions || {};
    persisted.masterMute = mute;
    appStateStore.set('persistedMixer', persisted).catch(() => {});
}



function sendInitialState(socket) {
    const initialState = getInitialStateData();
    socket.emit('mixer_initial_state', initialState);
}

function handleSocketCommands(socket) {
    // Guard: bind only once per socket to prevent duplicate listeners
    if (boundSockets.has(socket.id)) return;
    boundSockets.add(socket.id);

    socket.on('disconnect', () => {
        boundSockets.delete(socket.id);
        visibleMixerClients = Math.max(0, visibleMixerClients - 1);
    });

    socket.on('mixer_panel_open', () => {
        if (!socket.data.mixerPanelOpen) {
            socket.data.mixerPanelOpen = true;
            visibleMixerClients += 1;
        }
        lastSliderActivity = Date.now();
    });

    socket.on('mixer_panel_closed', () => {
        if (socket.data.mixerPanelOpen) {
            socket.data.mixerPanelOpen = false;
            visibleMixerClients = Math.max(0, visibleMixerClients - 1);
        }
    });

    socket.on('set_master_volume', (value) => {
        lastSliderActivity = Date.now(); // Marca actividad para polling adaptativo
        try { 
            if (defaultDevice) {
                defaultDevice.volume = value / 100; 
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
                persistMasterState(newState);
            }
        } catch (error) {}
    });

    socket.on('set_session_volume', ({ app, value }) => {
        lastSliderActivity = Date.now(); // Marca actividad para polling adaptativo
        try {
            const stored = activeSessions.get(app);
            if (!stored) return;
            const targetVolume = Math.max(0, Math.min(100, Number(value)));

            if (stored.lastVolume === targetVolume) {
                stored.lastUserUpdate = Date.now();
                return;
            }

            // LOG: Mostrar cuántas sesiones se van a modificar
            if (stored.sessions.length === 0) {
                stored.lastVolume = targetVolume;
                stored.lastUserUpdate = Date.now();
                const updatePayload = { name: app, type: 'volume', value: targetVolume };
                persistMixerSessionState(app, targetVolume, stored.lastMute);
                socket.broadcast.emit('session_updated', updatePayload);
                return;
            }

            if (stored.sessions.length > 1) {
                console.log(`⚠️  [Mixer] Setting volume for "${app}" affecting ${stored.sessions.length} sessions:`, stored.sessions.map(s => s.appName).join(', '));
            }

            stored.sessions.forEach((session) => {
                try { session.volume = targetVolume / 100; } catch (error) {}
            });

            stored.lastVolume = targetVolume;
            stored.lastUserUpdate = Date.now();

            const updatePayload = { name: app, type: 'volume', value: targetVolume };
            persistMixerSessionState(app, targetVolume, stored.lastMute);
            socket.broadcast.emit('session_updated', updatePayload);
        } catch (e) {}
    });

    socket.on('toggle_session_mute', (payload) => {
        const app = typeof payload === 'string' ? payload : payload?.app;

        try {
            const stored = activeSessions.get(app);
            if (!stored) return;

            const newState = !stored.lastMute;

            if (stored.sessions.length > 0) {
                stored.sessions.forEach((s) => { 
                    try { s.mute = newState; } catch(e) {}
                });
            }
            stored.lastMute = newState;
            stored.lastUserUpdate = Date.now();

            const updatePayload = { name: app, type: 'mute', value: newState };
            socket.emit('session_updated', updatePayload);
            socket.broadcast.emit('session_updated', updatePayload);
            persistMixerSessionState(app, stored.lastVolume, newState);
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
