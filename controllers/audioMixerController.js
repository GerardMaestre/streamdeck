const { default: AudioMixer, DeviceType } = require('native-sound-mixer');
const path = require('path');

// Instancia global del dispositivo de salida
let defaultDevice;
let mixerPollInterval = null;
let mixerInitialized = false;
let currentDeviceListeners = null;
// BUG FIX #1: No inicializar a false hardcodeado.
// Se sincroniza correctamente desde el dispositivo real en initAudioMixer y al reconectar.
let localMasterMute = false;
const activeSessions = new Map();

// Constantes de configuración (fácil de ajustar sin tocar la lógica)
const POLL_INTERVAL_MS = 600;
const DEBOUNCE_MS = 1500; // Tiempo tras el que se vuelve a escuchar a Windows

// Función para normalizar nombres problemáticos (como Spotify que pone el nombre de la canción en la sesión)
function getAppLabel(session) {
    let rawName = session.appName || session.name;
    if (!rawName) return null;

    // Eliminar basura residual en memoria (caracteres no ASCII / caracteres de control)
    rawName = rawName.replace(/[^\x20-\x7E]/g, '').trim();
    if (!rawName) return null;

    // 1. Limpiar los IDs de sesión raros de Windows (%b{...})
    let safeName = rawName.split('%b')[0];

    // 2. Extraer el nombre base (eliminar rutas C:/...)
    let baseName = path.basename(safeName);
    let lower = baseName.toLowerCase();
    let cleanLower = lower.replace(/\.exe$/i, '').trim();

    // 3. LISTA NEGRA (Procesos basura del sistema que nunca deben mostrarse)
    const blacklist = [
        'searchhost', 'shellexperiencehost', 'svchost', 'startmenuexperiencehost',
        'webresourcedirectory', 'widgets', 'systemsounds', 'applicationframehost',
        'gamebar', 'gamebarftserver', 'backgroundtaskhost', 'searchapp', 'explorer',
        'taskhostw', 'cmd', 'conhost', 'systemsettings', 'lockapp', 'textinputhost',
        'idle', 'system', 'registry', 'smss', 'csrss', 'lsass', 'services', 'spoolsv',
        'devicedriver', 'wallpaper64', 'audioclientrpc', 'esday', 'rundll32', 'dllhost'
    ];

    if (blacklist.includes(cleanLower) || cleanLower.length < 2) return null;

    // 4. DICCIONARIO DE NOMBRES BONITOS
    const diccionario = {
        'spotify': 'Spotify',
        'chrome': 'Google Chrome',
        'msedge': 'Microsoft Edge',
        'discord': 'Discord',
        'steam': 'Steam',
        'obs64': 'OBS Studio',
        'audiodg': 'Sonidos de Windows',
        'firefox': 'Firefox',
        'brave': 'Brave',
        'vlc': 'VLC Player',
        'sunshine': 'Sunshine',
        'dock_64': 'Stream Deck',
        'powertoys': 'PowerToys'
    };

    for (const key in diccionario) {
        if (cleanLower.includes(key)) return diccionario[key];
    }

    // 5. APP O JUEGO DESCONOCIDO: Auto-formateo
    // Transforma "grand-theft-auto.exe" → "Grand Theft Auto"
    let prettyName = baseName.replace(/\.exe$/i, '').replace(/[-_]/g, ' ').trim();
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
    } catch (error) {
        console.error('❌ Error limpiando listeners del dispositivo de audio:', error);
    } finally {
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
        localMasterMute = mute; // Mantener caché sincronizada con Windows
        io.emit('master_updated', { type: 'mute', value: mute });
    };

    const volumeId = device.on('volume', onVolume);
    const muteId = device.on('mute', onMute);

    currentDeviceListeners = { volumeId, muteId };
}

function emitAudioMixerError(io, context, error) {
    const message = error?.message || String(error);
    console.error(`❌ [audio_mixer:${context}]`, error);

    if (io) {
        io.emit('server_error', {
            context: `audio_mixer:${context}`,
            message
        });
    }
}

function initAudioMixer(io) {
    if (mixerInitialized) {
        console.warn('⚠️ initAudioMixer ya fue inicializado. Se evita doble registro de listeners.');
        return;
    }

    try {
        defaultDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);

        if (!defaultDevice) {
            console.error('❌ No se encontró dispositivo de audio principal.');
        } else {
            try {
                // BUG FIX #1: Sincronizar localMasterMute con el estado REAL del dispositivo al arrancar.
                // Si el PC ya tenía el audio muteado, la caché lo reflejará correctamente.
                localMasterMute = defaultDevice.mute;
                console.log(`🔊 Dispositivo de audio: ${defaultDevice.name} | volume=${Math.round(defaultDevice.volume * 100)} | mute=${defaultDevice.mute}`);
            } catch (e) {
                console.log('🔊 Dispositivo de audio por defecto detectado (detalles no disponibles)');
            }

            assignListenersToDefaultDevice(defaultDevice, io);
            pollSessions(io); // Poblar la primera vez
        }

        // Polling: detecta nuevas sesiones y cambios de hardware
        mixerPollInterval = setInterval(() => {
            try {
                const currentDefault = AudioMixer.getDefaultDevice(DeviceType.RENDER);

                if (currentDefault && (!defaultDevice || currentDefault.name !== defaultDevice.name)) {
                    console.log('🔄 Cambio de hardware detectado. Reconectando a:', currentDefault.name);
                    detachListenersFromDefaultDevice();
                    defaultDevice = currentDefault;

                    // BUG FIX #4: Sincronizar localMasterMute también al reconectar hardware.
                    try { localMasterMute = defaultDevice.mute; } catch (_) {}

                    assignListenersToDefaultDevice(defaultDevice, io);

                    // Poblar sesiones antes de emitir estado inicial
                    activeSessions.clear();
                    pollSessions(io);
                    io.emit('mixer_initial_state', getInitialStateData());

                    // BUG FIX #2: return aquí para no llamar a pollSessions() otra vez
                    // en la línea de abajo, evitando doble emisión de session_added.
                    return;
                }

                pollSessions(io);
            } catch (err) {
                emitAudioMixerError(io, 'poll', err);
            }
        }, POLL_INTERVAL_MS);

        mixerInitialized = true;

    } catch (error) {
        emitAudioMixerError(io, 'init', error);
    }
}

function pollSessions(io) {
    if (!defaultDevice) return;

    const currentSessions = defaultDevice.sessions;

    // 1. AGRUPACIÓN: Chrome, Spotify, Discord abren múltiples sub-sesiones.
    // Las agrupamos bajo la misma etiqueta para mostrar una sola entrada por app.
    const grouped = new Map();
    currentSessions.forEach((session) => {
        const label = getAppLabel(session);
        if (!label) return; // Blacklist o nombre inválido → ignorar

        if (!grouped.has(label)) grouped.set(label, []);
        grouped.get(label).push(session);
    });

    const currentNames = new Set(grouped.keys());

    // 2. PROCESAMIENTO por grupo
    for (const [label, sessions] of grouped.entries()) {
        let maxVol = 0;
        let isMuted = false;

        // Tomamos el volumen más alto del grupo y mute si cualquiera está muteado
        for (const s of sessions) {
            const v = Math.round(s.volume * 100);
            if (v > maxVol) maxVol = v;
            if (s.mute) isMuted = true;
        }

        let stored = activeSessions.get(label);

        // ANTI-VIBRACIÓN: Si el usuario tocó este control hace menos de DEBOUNCE_MS,
        // ignoramos lo que reporte Windows y mantenemos el valor elegido por el usuario.
        // BUG FIX #3: Eliminado el `|| Math.abs(...) <= 2` sin límite de tiempo,
        // que bloqueaba cambios legítimos de volumen indefinidamente.
        if (stored && stored.lastUserUpdate) {
            const timeSinceDrag = Date.now() - stored.lastUserUpdate;
            if (timeSinceDrag < DEBOUNCE_MS) {
                maxVol = stored.lastVolume;
                isMuted = stored.lastMute;
            }
        }

        if (!stored) {
            // Sesión nueva
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

    // 3. LIMPIEZA: Eliminar sesiones que ya no están activas en Windows
    for (const [name] of activeSessions.entries()) {
        if (!currentNames.has(name)) {
            activeSessions.delete(name);
            io.emit('session_removed', { name });
        }
    }
}

function getInitialStateData() {
    if (!defaultDevice) {
        return { master: { volume: 0, mute: false }, sessions: [] };
    }

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
    console.log('🔁 Enviando estado inicial al cliente', {
        master: initialState.master,
        sessionsCount: initialState.sessions.length
    });
    socket.emit('mixer_initial_state', initialState);
}

function handleSocketCommands(socket) {
    socket.on('set_master_volume', (value) => {
        console.log('📨 set_master_volume ->', value);
        try {
            if (defaultDevice) defaultDevice.volume = value / 100;
        } catch (error) {
            console.error('❌ Error en set_master_volume:', error);
            socket.emit('server_error', { context: 'set_master_volume', message: error?.message || String(error) });
        }
    });

    socket.on('toggle_master_mute', () => {
        console.log('📨 toggle_master_mute | localMasterMute actual:', localMasterMute);
        try {
            if (defaultDevice) {
                const newState = !localMasterMute;
                defaultDevice.mute = newState;
                localMasterMute = newState; // Actualizar caché inmediatamente
                console.log(`   ↳ Master mute → ${newState}`);
            }
        } catch (error) {
            console.error('❌ Error en toggle_master_mute:', error);
            socket.emit('server_error', { context: 'toggle_master_mute', message: error?.message || String(error) });
        }
    });

    socket.on('set_session_volume', ({ app, value }) => {
        try {
            const stored = activeSessions.get(app);
            if (!stored) {
                console.warn(`⚠️ set_session_volume: app "${app}" no encontrada`);
                return;
            }
            stored.sessions.forEach((s) => { s.volume = value / 100; });
            stored.lastVolume = value;
            stored.lastUserUpdate = Date.now();
        } catch (error) {
            console.error('❌ Error en set_session_volume:', error);
        }
    });

    socket.on('toggle_session_mute', (payload) => {
        const app = typeof payload === 'string' ? payload : payload?.app;
        const explicitMute = typeof payload === 'object' ? payload?.isMuted : undefined;

        console.log(`🔇 toggle_session_mute | app="${app}" | explicitMute=${explicitMute}`);

        try {
            const stored = activeSessions.get(app);

            if (!stored) {
                console.warn(`⚠️ app "${app}" no encontrada en activeSessions. Apps activas: [${[...activeSessions.keys()].join(', ')}]`);
                return;
            }

            if (stored.sessions.length === 0) {
                console.warn(`⚠️ app "${app}" no tiene sub-sesiones activas`);
                return;
            }

            const newState = explicitMute !== undefined ? explicitMute : !stored.lastMute;
            console.log(`   ↳ ${stored.lastMute} → ${newState}`);

            stored.sessions.forEach((s) => { s.mute = newState; });
            stored.lastMute = newState;
            stored.lastUserUpdate = Date.now();

        } catch (error) {
            console.error('❌ Error en toggle_session_mute:', error);
            socket.emit('server_error', { context: 'toggle_session_mute', message: error?.message || String(error) });
        }
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
    console.log('🛑 Audio Mixer destruido y limpiado.');
}

module.exports = {
    initAudioMixer,
    sendInitialState,
    handleSocketCommands,
    destroyAudioMixer
};