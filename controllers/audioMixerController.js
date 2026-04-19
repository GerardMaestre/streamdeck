const { default: AudioMixer, DeviceType, AudioSessionState } = require('native-sound-mixer');
const path = require('path');

// Instancia global del dispositivo de salida
let defaultDevice;
let mixerPollInterval = null;
let mixerInitialized = false;
let currentDeviceListeners = null;
// Mantener un registro de las sesiones activas en un Map para facilitar el acceso
const activeSessions = new Map();

// Función para normalizar nombres problemáticos (como Spotify que pone el nombre de la canción en la sesión)
function getAppLabel(session) {
    let rawName = session.appName || session.name;
    if (!rawName) return 'App';
    
    // Extraer solo el nombre del archivo si es una ruta completa
    const exeName = path.basename(rawName);
    const lower = exeName.toLowerCase();
    
    if (lower.includes('spotify')) return 'Spotify';
    if (lower.includes('chrome')) return 'Chrome';
    if (lower.includes('msedge') || lower.includes('edge')) return 'Edge';
    if (lower.includes('discord')) return 'Discord';
    if (lower.startsWith('steam')) return 'Steam';
    if (lower.includes('obs64') || lower.includes('obs')) return 'OBS';
    if (lower.includes('audiodg')) return 'Windows';
    if (lower.includes('firefox')) return 'Firefox';
    if (lower.includes('brave')) return 'Brave';
    if (lower.includes('wallpaper')) return 'Wallpaper';
    if (lower.includes('mpc-hc') || lower.includes('mpc-be')) return 'Media Player';
    
    // Si no coincide con los grandes, devolvemos el propio nombre del ejecutable (sin .exe)
    // Capitalizando la primera letra
    let cleanName = exeName.replace(/\.exe$/i, '');
    return cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
}

function detachListenersFromDefaultDevice() {
    if (!defaultDevice || !currentDeviceListeners) return;

    try {
        defaultDevice.removeListener('volume', currentDeviceListeners.onVolume);
        defaultDevice.removeListener('mute', currentDeviceListeners.onMute);
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
        io.emit('master_updated', { type: 'mute', value: mute });
    };

    currentDeviceListeners = { onVolume, onMute };
    device.on('volume', onVolume);
    device.on('mute', onMute);
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
                console.log(`🔊 Dispositivo de audio por defecto: ${defaultDevice.name} | volume=${Math.round(defaultDevice.volume * 100)} | mute=${defaultDevice.mute}`);
            } catch (e) {
                console.log('🔊 Dispositivo de audio por defecto detectado (detalles no disponibles)');
            }

            assignListenersToDefaultDevice(defaultDevice, io);
            pollSessions(io); // Poblar la primera vez
        }

        // Simular bidireccionalidad para las sesiones y detectar nuevas usando Polling
        // Además, integramos tolerancia a fallos: re-chequeo del hardware de salida
        mixerPollInterval = setInterval(() => {
            try {
                // Chequear si el dispositivo ha cambiado o resucitado
                const currentDefault = AudioMixer.getDefaultDevice(DeviceType.RENDER);
                if (currentDefault && (!defaultDevice || currentDefault.name !== defaultDevice.name)) {
                    console.log('🔄 Cambio de hardware de audio detectado. Reconectando mixer a:', currentDefault.name);
                    detachListenersFromDefaultDevice();
                    defaultDevice = currentDefault;
                    assignListenersToDefaultDevice(defaultDevice, io);
                    // Reiniciar mapas locales
                    activeSessions.clear();
                    io.emit('mixer_initial_state', getInitialStateData());
                }

                pollSessions(io);
            } catch (err) {
                // Si el poll crashea (ej: quitaste el último dispositivo USB y Windows no tiene sonido)
                // lo atrapamos amigablemente.
                emitAudioMixerError(io, 'poll', err);
            }
        }, 600); // 600ms para mantener el puente libre de saturación de CPU

        mixerInitialized = true;

    } catch (error) {
        emitAudioMixerError(io, 'init', error);
    }
}

function pollSessions(io) {
    if (!defaultDevice) return;
    
    // Obtenemos todas las sesiones crudas de Windows
    const currentSessions = defaultDevice.sessions;
    
    // 1. AGRUPACIÓN: Aplicaciones múltiples (Chrome con 5 pestañas, Spotify con plugins, Discord con llamadas)
    // producen decenas de sesiones separadas. Debemos agruparlas bajo la misma etiqueta común.
    const grouped = new Map();
    currentSessions.forEach((session) => {
        if (!session.name && !session.appName) return;
        const label = getAppLabel(session);
        if (!grouped.has(label)) {
            grouped.set(label, []);
        }
        grouped.get(label).push(session);
    });
    
    const currentNames = new Set(grouped.keys());
    
    // 2. PROCESAMIENTO POR GRUPO PARA EVITAR LOOPS INFINITOS DE EVENTOS
    for (const [label, sessions] of grouped.entries()) {
        let maxVol = 0;
        let isMuted = false;
        
        // Unificamos el volumen cogiendo el que más suene de todas las subsesiones de esa app
        for (const s of sessions) {
            const v = Math.round(s.volume * 100);
            if (v > maxVol) maxVol = v;
            if (s.mute) isMuted = true;
        }
        
        let stored = activeSessions.get(label);
        if (!stored) {
            // Es una aplicación nueva que acaba de soltar sonido
            activeSessions.set(label, {
                sessions: sessions, // Guardamos todas sus sub-sesiones
                lastVolume: maxVol,
                lastMute: isMuted
            });
            io.emit('session_added', { name: label, volume: maxVol, mute: isMuted });
        } else {
            // Refrescar array de referencias subyacentes de Windows
            stored.sessions = sessions;

            // Comparar un único estado estabilizado y enviar la orden de actualización si cambió en Windows
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
    
    // 3. LIMPIEZA: Detectar cierre de sesiones buscando en el Map las que ya no están activas en Windows
    for (const [name, stored] of activeSessions.entries()) {
        if (!currentNames.has(name)) {
            activeSessions.delete(name);
            io.emit('session_removed', { name });
        }
    }
}

function getInitialStateData() {
    if (!defaultDevice) return null;

    return {
        master: {
            volume: Math.round(defaultDevice.volume * 100),
            mute: defaultDevice.mute
        },
        sessions: Array.from(activeSessions.entries()).map(([name, s]) => ({
            name: name,
            volume: s.lastVolume,
            mute: s.lastMute
        }))
    };
}

function sendInitialState(socket) {
    const initialState = getInitialStateData();
    if (initialState) {
        try {
            console.log('🔁 Enviando estado inicial del mezclador al cliente', {
                master: initialState.master,
                sessionsCount: Array.isArray(initialState.sessions) ? initialState.sessions.length : 0
            });
        } catch (e) {
            // ignore log errors
        }

        socket.emit('mixer_initial_state', initialState);
    }
}

function handleSocketCommands(socket) {
    socket.on('set_master_volume', (value) => {
        console.log('📨 Evento socket: set_master_volume ->', value);
        try {
            if (defaultDevice) defaultDevice.volume = value / 100;
        } catch (error) {
            console.error('❌ Error aplicando set_master_volume:', error);
            socket.emit('server_error', { context: 'set_master_volume', message: error?.message || String(error) });
        }
    });

    socket.on('toggle_master_mute', (isMuted) => {
        console.log('📨 Evento socket: toggle_master_mute ->', isMuted);
        try {
            if (defaultDevice) defaultDevice.mute = isMuted;
        } catch (error) {
            console.error('❌ Error aplicando toggle_master_mute:', error);
            socket.emit('server_error', { context: 'toggle_master_mute', message: error?.message || String(error) });
        }
    });

    socket.on('set_session_volume', ({ app, value }) => {
        console.log('📨 Evento socket: set_session_volume ->', { app, value });
        try {
            const stored = activeSessions.get(app);
            if (stored && stored.sessions) {
                // Modifica en bloque TODAS las sub-sesiones relativas a esta aplicación
                stored.sessions.forEach((s) => {
                    s.volume = value / 100;
                });
                stored.lastVolume = value; // Actualizar cache para no rebotar
            } else {
                console.warn('⚠️ set_session_volume: no se encontró sesión activa para', app);
            }
        } catch (error) {
            console.error('❌ Error aplicando set_session_volume:', error);
            socket.emit('server_error', { context: 'set_session_volume', message: error?.message || String(error) });
        }
    });

    socket.on('toggle_session_mute', ({ app, isMuted }) => {
        console.log('📨 Evento socket: toggle_session_mute ->', { app, isMuted });
        try {
            const stored = activeSessions.get(app);
            if (stored && stored.sessions) {
                stored.sessions.forEach((s) => {
                    s.mute = isMuted;
                });
                stored.lastMute = isMuted;
            } else {
                console.warn('⚠️ toggle_session_mute: no se encontró sesión activa para', app);
            }
        } catch (error) {
            console.error('❌ Error aplicando toggle_session_mute:', error);
            socket.emit('server_error', { context: 'toggle_session_mute', message: error?.message || String(error) });
        }
    });
}

module.exports = {
    initAudioMixer,
    sendInitialState,
    handleSocketCommands
};