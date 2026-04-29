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
// Sesiones que siempre queremos ver si están abiertas (aunque no emitan sonido)
const ALWAYS_SHOW_SILENT_SESSIONS = new Set(['Spotify', 'Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Firefox', 'VLC Player', 'OBS Studio', 'Discord', 'Telegram', 'WhatsApp']);
const KNOWN_VISIBLE_PROCESSES = new Map([
    ['spotify.exe', 'Spotify'],
    ['chrome.exe', 'Google Chrome'],
    ['msedge.exe', 'Microsoft Edge'],
    ['brave.exe', 'Brave Browser'],
    ['firefox.exe', 'Firefox'],
    ['vlc.exe', 'VLC Player'],
    ['obs64.exe', 'OBS Studio'],
    ['obs32.exe', 'OBS Studio'],
    ['whatsapp.exe', 'WhatsApp'],
    ['whatsapp.root.exe', 'WhatsApp'],
    ['whatsappdesktop.exe', 'WhatsApp'],
    ['telegram.exe', 'Telegram']
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

    // Usamos PowerShell para filtrar procesos que tienen una ventana activa (MainWindowTitle)
    // Esto evita detectar procesos en segundo plano como el "Startup Boost" de Edge.
    // Usamos PowerShell para obtener procesos.
    // 1. Procesos con ventana (para la mayoría de apps)
    // 2. Procesos críticos aunque no tengan ventana (WhatsApp, Spotify, etc.)
    const psCommand = "$known = @('spotify','chrome','msedge','brave','firefox','vlc','obs64','obs32','whatsapp','whatsapp.root','whatsappdesktop','telegram'); Get-Process | Where-Object { ($_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0) -or ($known -contains $_.Name.ToLower()) } | Select-Object -ExpandProperty Name";
    
    execFile('powershell', ['-NoProfile', '-Command', psCommand], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
        processScanInFlight = false;
        if (error || !stdout) return;

        const nextLabels = new Set();
        const activeExes = stdout.toLowerCase().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        
        // Identificar apps por su ejecutable
        for (const [exeName, label] of KNOWN_VISIBLE_PROCESSES.entries()) {
            const exeBase = exeName.toLowerCase().replace(/\.exe$/, '');
            if (activeExes.includes(exeBase)) {
                nextLabels.add(label);
            }
        }
        
        // Re-sincronizar visibleProcessLabels
        visibleProcessLabels.clear();
        nextLabels.forEach((label) => visibleProcessLabels.add(label));
    });
}

function getAppLabel(session) {
    const rawName = session.appName || '';
    const windowTitle = (session.name || '').trim();
    
    // Si ya lo tenemos en caché por el par (rawName, windowTitle)
    const cacheKey = `${rawName}|${windowTitle}`;
    if (labelCache.has(cacheKey)) return labelCache.get(cacheKey);

    const titleLower = windowTitle.toLowerCase();
    const pathLower = rawName.toLowerCase();
    const baseName = path.basename(rawName).toLowerCase().replace(/\.exe$/i, '').trim();
    const canonicalExe = `${baseName}.exe`;
    const isBrowser = ['msedge', 'chrome', 'brave', 'firefox'].includes(baseName);

    // 1) Mapeo por ejecutable (más estable que títulos de ventana).
    if (KNOWN_VISIBLE_PROCESSES.has(canonicalExe)) {
        const stableLabel = KNOWN_VISIBLE_PROCESSES.get(canonicalExe);
        labelCache.set(cacheKey, stableLabel);
        return stableLabel;
    }

    // 2) Reglas por título SOLO para procesos no navegador.
    const titleRules = [
        { pattern: 'spotify', name: 'Spotify' },
        { pattern: 'discord', name: 'Discord' },
        { pattern: 'youtube', name: 'YouTube' },
        { pattern: 'twitch', name: 'Twitch' },
        { pattern: 'netflix', name: 'Netflix' },
        { pattern: 'hbo', name: 'HBO Max' },
        { pattern: 'disney+', name: 'Disney+' },
        { pattern: 'telegram', name: 'Telegram' },
        { pattern: 'messenger', name: 'Messenger' },
        { pattern: 'gmail', name: 'Gmail' },
        { pattern: 'outlook', name: 'Outlook' },
        { pattern: 'visual studio code', name: 'VS Code' },
        { pattern: 'postman', name: 'Postman' }
    ];

    if (!isBrowser) {
        for (const rule of titleRules) {
            if (titleLower.includes(rule.pattern)) {
                labelCache.set(cacheKey, rule.name);
                return rule.name;
            }
        }
    }

    // 3. Identificación por Nombre de Proceso

    if (baseName.includes('audiosrv') || baseName.includes('systemsounds') || titleLower === 'system sounds' || titleLower === 'sonidos del sistema') {
        labelCache.set(cacheKey, 'Sonidos del sistema');
        return 'Sonidos del sistema';
    }

    // Filtro de ruido hexadecimal o IDs raros
    if (/^[0-9a-f]{1,4}$/i.test(baseName) || baseName.startsWith('@')) {
        labelCache.set(cacheKey, null);
        return null;
    }

    const processRules = [
        { pattern: 'whatsapp', name: 'WhatsApp' },
        { pattern: 'spotify', name: 'Spotify' },
        { pattern: 'discord', name: 'Discord' },
        { pattern: 'steam', name: 'Steam' },
        { pattern: 'obs64', name: 'OBS Studio' },
        { pattern: 'obs32', name: 'OBS Studio' },
        { pattern: 'vlc', name: 'VLC Player' },
        { pattern: 'league of legends', name: 'League of Legends' },
        { pattern: 'valorant', name: 'Valorant' },
        { pattern: 'qemu-system', name: 'QEMU' },
        { pattern: 'sunshine', name: 'Sunshine' },
        { pattern: 'powertoys', name: 'PowerToys' },
        { pattern: 'telegram', name: 'Telegram' },
        { pattern: 'code', name: 'VS Code' },
        { pattern: 'explorer', name: 'Explorador de archivos' },
        // Navegadores al final
        { pattern: 'chrome', name: 'Google Chrome' },
        { pattern: 'msedge', name: 'Microsoft Edge' },
        { pattern: 'brave', name: 'Brave Browser' },
        { pattern: 'firefox', name: 'Firefox' }
    ];

    for (const rule of processRules) {
        if (baseName.includes(rule.pattern)) {
            if (isBrowser && windowTitle && windowTitle.toLowerCase() !== baseName && windowTitle.length > 3) {
                break; // Saltar al paso 4
            }
            labelCache.set(cacheKey, rule.name);
            return rule.name;
        }
    }

    // 3. Blacklist
    const blacklist = [
        'searchhost', 'shellexperiencehost', 'svchost', 'startmenuexperiencehost',
        'widgets', 'applicationframehost', 'backgroundtaskhost', 'searchapp', 'taskhostw', 
        'cmd', 'conhost', 'systemsettings', 'lockapp', 'textinputhost', 'idle', 
        'system', 'registry', 'smss', 'csrss', 'lsass', 'services', 'spoolsv',
        'audioclientrpc', 'esday', 'rundll32', 'dllhost', 'runtimebroker', 'sihost',
        'fontdrvhost', 'dwm', 'ctfmon', 'nvcontainer', 'nvdisplay', 'amdow', 
        'amdrsserv', 'wusa', 'wmiprvse', 'dashost', 'host32', 'host64', 'wsappx',
        'mousoftwareworker', 'usocoreworker', 'compattelrunner', 'vmmem', 'userinit', 
        'wininit', 'winlogon', 'crashpad_handler', 'wermgr', 'werfault', 
        'backgroundtransferhost', 'smartscreen', 'igfxcuiservice', 'igfxem', 
        'nvsphelper64', 'rtkngui64', 'nahimic', 'wavesyssvc', 'securityhealthsystray',
        'msedgewebview2', 'devicedriver', 'dock_64', 'antigravity', 'wallpaper64', 'wallpaper32',
        'experiencia de entrada', 'gamebar', 'remind_m', 'ascom', 'winwdr', 'winring0'
    ];

    if (blacklist.some(bad => baseName.includes(bad) || titleLower.includes(bad))) {
        labelCache.set(cacheKey, null);
        return null;
    }

    // 4. Título útil
    if (windowTitle && windowTitle.length > 2 && windowTitle.length < 50 && !windowTitle.includes('{')) {
        labelCache.set(cacheKey, windowTitle);
        return windowTitle;
    }

    // 5. Fallback
    if (baseName && baseName.length > 1) {
        let prettyName = baseName.replace(/[-_]/g, ' ').trim();
        prettyName = prettyName.replace(/\b\w/g, c => c.toUpperCase());
        labelCache.set(cacheKey, prettyName);
        return prettyName;
    }

    labelCache.set(cacheKey, null);
    return null;
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
    labelCache.clear(); // Limpiar caché al iniciar para recalcular nombres con las nuevas reglas

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
            refreshVisibleProcessLabels(); // Escaneo inicial
            pollSessions(io); 
        }

        // Polling adaptativo: ajusta el intervalo según actividad de sliders
        const runPollCycle = () => {
            try {
                const currentDefault = AudioMixer.getDefaultDevice(DeviceType.RENDER);

                if (currentDefault) {
                    if (!defaultDevice || currentDefault.name !== defaultDevice.name) {
                        detachListenersFromDefaultDevice();
                        defaultDevice = currentDefault;
                        try { localMasterMute = defaultDevice.mute; } catch (_) {}

                        assignListenersToDefaultDevice(defaultDevice, io);
                        activeSessions.clear();
                        pollSessions(io);
                        io.emit('mixer_initial_state', getInitialStateData());
                    } else {
                        // Refrescamos la referencia para asegurar sesiones actuales
                        defaultDevice = currentDefault;
                        pollSessions(io);
                    }
                }
            } catch (err) {
                console.error('[Audio] Error en ciclo de polling:', err);
            }

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
        const shouldKeepByVisibility = visibleProcessLabels.has(label);
        if (isSilentInactive && !ALWAYS_SHOW_SILENT_SESSIONS.has(label) && !shouldKeepByVisibility) continue;

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
        
        let stored = activeSessions.get(label);

        // Sincronización inteligente: 
        // 1. Si el usuario movió el slider recientemente, forzamos a todas las sesiones a ese valor.
        // 2. Si las sesiones son inconsistentes entre sí, unificamos al último valor conocido (lastVolume)
        //    para evitar que una nueva sesión que aparece al 100% "gane" a la configuración del usuario.
        if (sessionsSnapshot.length > 0 && stored) {
            const isBeingDragged = (Date.now() - stored.lastUserUpdate < 1500);
            const needsUnification = sessionsSnapshot.some(s => Math.abs(s.volume * 100 - stored.lastVolume) > 2);

            if (needsUnification) {
                if (isBeingDragged || stored.lastVolume !== undefined) {
                    // Forzamos la voluntad del usuario (o el último valor guardado) sobre las sesiones
                    sessionsSnapshot.forEach(s => {
                        try { s.volume = stored.lastVolume / 100; } catch (_) {}
                    });
                    maxVol = stored.lastVolume;
                }
            }
        }

        let roundedVol = Math.round(maxVol);

        if (stored?.processOnly && sessionsSnapshot.length > 0) {
            roundedVol = stored.lastVolume;
            sessionsSnapshot.forEach((session) => {
                try { session.volume = roundedVol / 100; } catch (_) {}
            });
            stored.processOnly = false;
        }

        // (Log removido para evitar saturación del terminal)
        // if (label === 'Spotify' || sessionsSnapshot.length > 1) { ... }

        if (stored) {
            // Debounce contra cambios manuales del usuario en la tablet (reducido a 600ms para mayor agilidad)
            if (stored.lastUserUpdate && (Date.now() - stored.lastUserUpdate < 600)) {
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

        let existing = activeSessions.get(label);
        if (existing) {
            existing.sessions = [];
            existing.processOnly = true;
            // No sobreescribimos lastVolume/lastUserUpdate si ya existen, 
            // para no perder lo que el usuario acaba de mover.
        } else {
            activeSessions.set(label, {
                sessions: [],
                lastVolume: volume,
                lastMute: mute,
                lastUserUpdate: 0,
                processOnly: true
            });
            existing = activeSessions.get(label);
        }
        
        batchUpdates.sessions.push({ name: label, volume: existing.lastVolume, mute: existing.lastMute });
    }

    // 3. Limpieza de sesiones huérfanas
    // Solo eliminamos si no está ni como sesión real ni como proceso visible conocido
    for (const [name] of activeSessions.entries()) {
        const isReal = pollNames.has(name);
        const isVisibleProcess = visibleProcessLabels.has(name);
        
        if (!isReal && !isVisibleProcess) {
            activeSessions.delete(name);
            batchUpdates.removed.push(name);
        }
    }

    if (batchUpdates.sessions.length > 0 || batchUpdates.removed.length > 0) {
        io.emit('mixer_batch', batchUpdates);
    }
}

function getInitialStateData() {
    if (!defaultDevice) return { master: { volume: 0, mute: false }, sessions: [] };

    return {
        master: {
            volume: Math.round(defaultDevice.volume * 100),
            mute: localMasterMute
        },
        sessions: Array.from(activeSessions.entries()).map(([name, s]) => {
            return {
                name,
                volume: s.lastVolume,
                mute: s.lastMute
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
        lastSliderActivity = Date.now();
        try { 
            const device = defaultDevice || AudioMixer.getDefaultDevice(DeviceType.RENDER);
            if (device) {
                device.volume = value / 100; 
                socket.broadcast.emit('master_updated', { type: 'volume', value: Math.round(value) });
            }
        } catch (e) {
            console.error('[Mixer] Error setting master volume:', e);
        }
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
        lastSliderActivity = Date.now();
        try {
            const targetVolume = Math.max(0, Math.min(100, Number(value)));
            const stored = activeSessions.get(app);
            
            if (stored) {
                if (stored.lastVolume === targetVolume) {
                    stored.lastUserUpdate = Date.now();
                    return;
                }
                stored.lastVolume = targetVolume;
                stored.lastUserUpdate = Date.now();
            }

            // Usar las sesiones ya cacheadas si están disponibles y no están vacías
            let sessionsToUpdate = (stored && stored.sessions && stored.sessions.length > 0) ? stored.sessions : null;

            // Si no hay sesiones cacheadas, las buscamos en el dispositivo (lento, pero necesario una vez)
            if (!sessionsToUpdate) {
                const currentDevice = defaultDevice || AudioMixer.getDefaultDevice(DeviceType.RENDER);
                if (currentDevice) {
                    sessionsToUpdate = currentDevice.sessions.filter(s => getAppLabel(s) === app);
                    if (stored) stored.sessions = sessionsToUpdate;
                }
            }

            if (!sessionsToUpdate) return;

            let appliedCount = 0;
            sessionsToUpdate.forEach((s) => {
                try {
                    s.volume = targetVolume / 100;
                    appliedCount++;
                } catch (err) {
                    // Si falla, es posible que la sesión sea inválida, la limpiaremos en el próximo poll
                }
            });

            // Persistencia y broadcast
            persistMixerSessionState(app, targetVolume, stored ? stored.lastMute : false);
            socket.broadcast.emit('session_updated', { name: app, type: 'volume', value: targetVolume });

        } catch (e) {
            console.error(`[Mixer] Critical error in set_session_volume for ${app}:`, e);
        }
    });

    socket.on('toggle_session_mute', (payload) => {
        const app = typeof payload === 'string' ? payload : payload?.app;
        lastSliderActivity = Date.now();

        try {
            const stored = activeSessions.get(app);
            const newState = stored ? !stored.lastMute : true;

            const currentDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);
            if (!currentDevice) return;

            let appliedCount = 0;
            currentDevice.sessions.forEach((s) => {
                if (getAppLabel(s) === app) {
                    try {
                        s.mute = newState;
                        appliedCount++;
                    } catch (e) {}
                }
            });

            if (stored) {
                stored.lastMute = newState;
                stored.lastUserUpdate = Date.now();
            }

            // console.log(`[Mixer] ${app} Mute -> ${newState} (${appliedCount} sessions controlled)`);

            const updatePayload = { name: app, type: 'mute', value: newState };
            socket.emit('session_updated', updatePayload);
            socket.broadcast.emit('session_updated', updatePayload);
            persistMixerSessionState(app, stored ? stored.lastVolume : 100, newState);
        } catch (error) {
            console.error(`[Mixer] Error in toggle_session_mute for ${app}:`, error);
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
}

module.exports = {
    initAudioMixer, sendInitialState, handleSocketCommands, destroyAudioMixer
};
