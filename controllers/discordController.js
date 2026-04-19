const { exec } = require('child_process');
const RPC = require('discord-rpc');
const { ejecutarMacro } = require('./macroController');

const clientId = process.env.DISCORD_CLIENT_ID || '1152291774610546688';
const clientSecret = process.env.DISCORD_CLIENT_SECRET || 'wGwfH1ZFUO395rKWn5b1DqIovAc35CO6';
const redirectUri = process.env.DISCORD_REDIRECT_URI || 'http://localhost';

const LOGIN_SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
const DEFAULT_RECONNECT_MS = 10000;
const FALLBACK_RETRY_MS = 60000;
const LOGIN_ATTEMPT_TIMEOUT_MS = 20000;
const RPC_DYNAMIC_EVENTS = ['VOICE_SETTINGS_UPDATE', 'VOICE_CHANNEL_SELECT', 'VOICE_STATE_UPDATE'];

let rpc = null;
let ioInstance = null;
let lastKnownChannelId = null;
let reconnectTimer = null;
let isConnecting = false;
let lastDiscordLaunchAttemptAt = 0;
let fallbackMode = false;
let voiceControlAvailable = false;
let fallbackVoiceState = {
    mute: false,
    deaf: false
};

let connectionState = {
    status: 'disconnected',
    message: 'Discord no conectado'
};

const updateConnectionState = (status, message) => {
    connectionState = { status, message };
    if (ioInstance) {
        ioInstance.emit('discord_connection_state', connectionState);
    }
};

const isRpcReady = () => Boolean(rpc && rpc.user);

const isAuthLoginError = (message = '') => {
    const lower = String(message).toLowerCase();
    return (
        lower.includes('401') ||
        lower.includes('unauthorized') ||
        lower.includes('invalid') ||
        lower.includes('not authenticated')
    );
};

const clearReconnectTimer = () => {
    if (!reconnectTimer) return;

    clearTimeout(reconnectTimer);
    reconnectTimer = null;
};

const removeRpcListenersByEvent = (client, eventNames = []) => {
    if (!client || typeof client.removeAllListeners !== 'function') return;

    for (const eventName of eventNames) {
        try {
            client.removeAllListeners(eventName);
        } catch (error) {
            console.warn(`No se pudieron limpiar listeners para ${eventName}:`, error.message);
        }
    }
};

const destroyRpcClient = (client) => {
    if (!client) return;

    removeRpcListenersByEvent(client, ['disconnected', ...RPC_DYNAMIC_EVENTS]);

    try {
        client.destroy();
    } catch (error) {
        console.warn('No se pudo destruir cliente Discord RPC:', error.message);
    }

    if (client === rpc) {
        rpc = null;
    }
};

const scheduleReconnect = (
    delayMs = DEFAULT_RECONNECT_MS,
    { allowInFallback = false, forceFreshAuth = false } = {}
) => {
    if (reconnectTimer || (fallbackMode && !allowInFallback)) return;

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectRPC(forceFreshAuth);
    }, delayMs);
};

const maybeLaunchDiscordDesktop = () => {
    if (process.platform !== 'win32') return;

    const now = Date.now();
    if (now - lastDiscordLaunchAttemptAt < 60000) return;

    lastDiscordLaunchAttemptAt = now;
    exec('start "" "discord://"', (error) => {
        if (error) {
            console.warn('No se pudo lanzar Discord Desktop automáticamente:', error.message);
        }
    });
};

const buildLoginAttempts = () => {
    const attempts = [];

    const redirectCandidates = [redirectUri, 'http://localhost', 'http://127.0.0.1']
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);

    for (const redirectCandidate of redirectCandidates) {
        attempts.push({
            label: `oauth-none-${redirectCandidate}`,
            voiceCapable: true,
            timeoutMs: 20000,
            options: {
                clientId,
                clientSecret,
                scopes: LOGIN_SCOPES,
                redirectUri: redirectCandidate,
                prompt: 'none'
            }
        });

        attempts.push({
            label: `oauth-consent-${redirectCandidate}`,
            voiceCapable: true,
            timeoutMs: 45000,
            options: {
                clientId,
                clientSecret,
                scopes: LOGIN_SCOPES,
                redirectUri: redirectCandidate,
                prompt: 'consent'
            }
        });
    }

    attempts.push({
        label: 'basic-ipc',
        voiceCapable: false,
        timeoutMs: 12000,
        options: {
            clientId
        }
    });

    return attempts;
};

const loginAttemptWithTimeout = async (client, options, timeoutMs = LOGIN_ATTEMPT_TIMEOUT_MS) => {
    const timeoutToken = Symbol('login-timeout');
    let timer = null;

    try {
        const timeoutPromise = new Promise((resolve) => {
            timer = setTimeout(() => resolve(timeoutToken), timeoutMs);
        });

        const result = await Promise.race([client.login(options), timeoutPromise]);

        if (result === timeoutToken) {
            throw new Error('DISCORD_LOGIN_TIMEOUT');
        }

        return result;
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};

const loginWithAttempts = async () => {
    const attempts = buildLoginAttempts();
    let lastError = new Error('No se pudo autenticar con Discord RPC');
    let authFailureDetected = false;

    for (const attempt of attempts) {
        const attemptClient = new RPC.Client({ transport: 'ipc' });

        try {
            const loggedClient = await loginAttemptWithTimeout(
                attemptClient,
                attempt.options,
                attempt.timeoutMs
            );

            if (attempt.voiceCapable) {
                try {
                    await loggedClient.getVoiceSettings();
                } catch (voiceError) {
                    lastError = voiceError;

                    try {
                        destroyRpcClient(loggedClient);
                    } catch (destroyError) {
                        console.warn('No se pudo destruir cliente Discord durante login fallback:', destroyError.message);
                    }

                    continue;
                }
            }

            return {
                client: loggedClient,
                attemptLabel: attempt.label,
                voiceCapable: !!attempt.voiceCapable
            };
        } catch (error) {
            lastError = error;

            if (isAuthLoginError(error?.message)) {
                authFailureDetected = true;
            }

            try {
                destroyRpcClient(attemptClient);
            } catch (destroyError) {
                console.warn('No se pudo destruir cliente Discord de intento fallido:', destroyError.message);
            }
        }
    }

    if (authFailureDetected) {
        lastError.authFailureDetected = true;
    }

    throw lastError;
};

const mapUsersFromChannel = (channelInfo) => {
    const voiceStates = Array.isArray(channelInfo?.voice_states) ? channelInfo.voice_states : [];

    return voiceStates
        .map((voiceState) => {
            const user = voiceState.user || {};
            const userId = user.id || voiceState.user_id;
            const username = user.username || voiceState.nick || 'Usuario';
            const avatarHash = user.avatar;
            const volumeRaw = Number(voiceState.volume);
            const volume = Number.isFinite(volumeRaw) ? Math.min(200, Math.max(0, volumeRaw)) : 100;

            return {
                id: userId,
                username,
                avatar: userId && avatarHash ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png` : null,
                volume
            };
        })
        .filter((user) => user.id);
};

const publishVoiceUsers = async () => {
    if (!isRpcReady() || !ioInstance) return;

    if (!lastKnownChannelId) {
        ioInstance.emit('discord_voice_users', []);
        return;
    }

    try {
        const channelInfo = await rpc.getChannel(lastKnownChannelId);
        const users = mapUsersFromChannel(channelInfo);
        const others = users.filter((user) => user.id !== rpc.user.id);
        ioInstance.emit('discord_voice_users', others);
    } catch (error) {
        console.warn('No se pudo obtener usuarios de voz:', error.message);
    }
};

const publishVoiceSettings = async () => {
    if (!isRpcReady() || !ioInstance) return;

    try {
        const settings = await rpc.getVoiceSettings();
        ioInstance.emit('discord_voice_settings', {
            mute: !!settings.mute,
            deaf: !!settings.deaf
        });
    } catch (error) {
        console.warn('No se pudo obtener estado de voz:', error.message);
    }
};

const setupRpcSubscriptions = async () => {
    if (!isRpcReady()) return;

    const currentClient = rpc;

    try {
        removeRpcListenersByEvent(currentClient, RPC_DYNAMIC_EVENTS);

        await currentClient.subscribe('VOICE_SETTINGS_UPDATE', {});
        await currentClient.subscribe('VOICE_CHANNEL_SELECT', {});

        currentClient.on('VOICE_SETTINGS_UPDATE', (data) => {
            if (!ioInstance || rpc !== currentClient) return;

            ioInstance.emit('discord_voice_settings', {
                mute: !!data.mute,
                deaf: !!data.deaf
            });
        });

        currentClient.on('VOICE_CHANNEL_SELECT', async (data) => {
            if (rpc !== currentClient) return;

            lastKnownChannelId = data?.channel_id || null;

            if (lastKnownChannelId) {
                try {
                    await currentClient.subscribe('VOICE_STATE_UPDATE', { channel_id: lastKnownChannelId });
                } catch (error) {
                    console.warn('No se pudo suscribir a VOICE_STATE_UPDATE:', error.message);
                }
            }

            await publishVoiceUsers();
        });

        currentClient.on('VOICE_STATE_UPDATE', async () => {
            if (rpc !== currentClient) return;
            await publishVoiceUsers();
        });

        try {
            const selectedVoiceChannel = await currentClient.request('GET_SELECTED_VOICE_CHANNEL');
            lastKnownChannelId = selectedVoiceChannel?.id || selectedVoiceChannel?.channel_id || null;
        } catch (error) {
            lastKnownChannelId = null;
        }

        await publishVoiceSettings();
        await publishVoiceUsers();
    } catch (error) {
        console.error('Error configurando suscripciones Discord RPC:', error.message);
    }
};

const connectRPC = async (forceFreshAuth = false) => {
    if (isConnecting) return;

    if (isRpcReady()) {
        if (!(forceFreshAuth && fallbackMode)) return;

        destroyRpcClient(rpc);
    }

    isConnecting = true;
    updateConnectionState('connecting', 'Conectando con Discord...');

    try {
        const { client, attemptLabel, voiceCapable } = await loginWithAttempts();
        rpc = client;
        const currentClient = client;

        clearReconnectTimer();
        removeRpcListenersByEvent(currentClient, ['disconnected']);

        currentClient.on('disconnected', () => {
            if (rpc !== currentClient) return;

            updateConnectionState('disconnected', 'Discord desconectado. Reintentando...');
            lastKnownChannelId = null;

            if (ioInstance) {
                ioInstance.emit('discord_voice_users', []);
            }

            removeRpcListenersByEvent(currentClient, ['disconnected', ...RPC_DYNAMIC_EVENTS]);
            rpc = null;
            scheduleReconnect(DEFAULT_RECONNECT_MS);
        });

        const canUseVoice = voiceCapable;

        voiceControlAvailable = canUseVoice;
        fallbackMode = !canUseVoice;

        if (canUseVoice) {
            updateConnectionState('connected', `Conectado como ${client.user?.username || 'Discord'}`);
            console.log('Conectado a Discord RPC como', client.user?.username || 'desconocido', `(${attemptLabel})`);
            await setupRpcSubscriptions();
        } else {
            updateConnectionState('fallback', `Conectado a Discord en modo basico como ${client.user?.username || 'usuario'}`);
            console.log('Conectado en modo basico (sin scopes de voz)', `(${attemptLabel})`);

            if (ioInstance) {
                ioInstance.emit('discord_voice_settings', {
                    mute: !!fallbackVoiceState.mute,
                    deaf: !!fallbackVoiceState.deaf
                });
                ioInstance.emit('discord_voice_users', []);
            }

            // En modo basico, seguimos intentando subir a OAuth de voz en segundo plano.
            scheduleReconnect(FALLBACK_RETRY_MS, { allowInFallback: true, forceFreshAuth: true });
        }
    } catch (error) {
        const message = error?.message || 'Error desconocido de Discord RPC';
        const lowerMessage = message.toLowerCase();
        const authError = Boolean(error?.authFailureDetected) || isAuthLoginError(message);

        console.error('Discord no detectado o error de Login:', message);

        if (rpc) {
            destroyRpcClient(rpc);
        }

        if (authError) {
            fallbackMode = true;
            voiceControlAvailable = false;
            updateConnectionState('fallback', 'Modo basico activo: mute/deaf por atajos. Reintentando OAuth automaticamente...');

            if (ioInstance) {
                ioInstance.emit('discord_voice_settings', {
                    mute: !!fallbackVoiceState.mute,
                    deaf: !!fallbackVoiceState.deaf
                });
                ioInstance.emit('discord_voice_users', []);
            }

            scheduleReconnect(FALLBACK_RETRY_MS, { allowInFallback: true, forceFreshAuth: true });
            return;
        }

        if (lowerMessage.includes('rpc_connection_timeout') || lowerMessage.includes('discord_login_timeout')) {
            fallbackMode = true;
            voiceControlAvailable = false;
            updateConnectionState('fallback', 'Discord RPC no responde. Modo basico activo y reconectando...');

            if (ioInstance) {
                ioInstance.emit('discord_voice_settings', {
                    mute: !!fallbackVoiceState.mute,
                    deaf: !!fallbackVoiceState.deaf
                });
                ioInstance.emit('discord_voice_users', []);
            }

            maybeLaunchDiscordDesktop();
            scheduleReconnect(15000, { allowInFallback: true });
            return;
        }

        updateConnectionState('error', message);
        rpc = null;
        scheduleReconnect(DEFAULT_RECONNECT_MS);
    } finally {
        isConnecting = false;
    }
};

const ensureRpcReady = () => {
    if (!isRpcReady()) {
        return {
            ok: false,
            message: 'Discord RPC no está autenticado todavía'
        };
    }

    return { ok: true };
};

const initDiscordRPC = (io) => {
    ioInstance = io;
    connectRPC();
};

const discordToggleMute = async () => {
    if (fallbackMode || !voiceControlAvailable) {
        try {
            await ejecutarMacro('mutear_discord');
            fallbackVoiceState.mute = !fallbackVoiceState.mute;

            if (ioInstance) {
                ioInstance.emit('discord_voice_settings', {
                    mute: !!fallbackVoiceState.mute,
                    deaf: !!fallbackVoiceState.deaf
                });
            }

            return {
                ok: true,
                message: 'Micro alternado por atajo (Ctrl+Shift+M)',
                fallback: true
            };
        } catch (error) {
            return {
                ok: false,
                message: error?.message || 'No se pudo alternar el mute en modo fallback'
            };
        }
    }

    const ready = ensureRpcReady();
    if (!ready.ok) {
        return ready;
    }

    try {
        const settings = await rpc.getVoiceSettings();
        await rpc.setVoiceSettings({ mute: !settings.mute });
        await publishVoiceSettings();

        return { ok: true };
    } catch (error) {
        return { ok: false, message: error.message || 'No se pudo alternar el mute' };
    }
};

const discordToggleDeaf = async () => {
    if (fallbackMode || !voiceControlAvailable) {
        try {
            await ejecutarMacro('ensordecer_discord');
            fallbackVoiceState.deaf = !fallbackVoiceState.deaf;

            if (ioInstance) {
                ioInstance.emit('discord_voice_settings', {
                    mute: !!fallbackVoiceState.mute,
                    deaf: !!fallbackVoiceState.deaf
                });
            }

            return {
                ok: true,
                message: 'Cascos alternados por atajo (Ctrl+Shift+D)',
                fallback: true
            };
        } catch (error) {
            return {
                ok: false,
                message: error?.message || 'No se pudo alternar ensordecer en modo fallback'
            };
        }
    }

    const ready = ensureRpcReady();
    if (!ready.ok) {
        return ready;
    }

    try {
        const settings = await rpc.getVoiceSettings();
        await rpc.setVoiceSettings({ deaf: !settings.deaf });
        await publishVoiceSettings();

        return { ok: true };
    } catch (error) {
        return { ok: false, message: error.message || 'No se pudo alternar el ensordecer' };
    }
};

const discordSetUserVolume = async (userId, volume) => {
    if (fallbackMode || !voiceControlAvailable) {
        return {
            ok: false,
            message: 'El volumen por usuario requiere OAuth valido en Discord'
        };
    }

    const ready = ensureRpcReady();
    if (!ready.ok) {
        return ready;
    }

    const normalizedVolume = Math.min(200, Math.max(0, parseInt(volume, 10) || 0));

    try {
        await rpc.setUserVoiceSettings(userId, { volume: normalizedVolume });
        return { ok: true };
    } catch (error) {
        return { ok: false, message: error.message || 'No se pudo cambiar el volumen del usuario' };
    }
};

const requestInitialDiscordState = async (socket) => {
    if (!socket) return;

    socket.emit('discord_connection_state', connectionState);

    if (!isRpcReady() || fallbackMode || !voiceControlAvailable) {
        socket.emit('discord_voice_settings', {
            mute: fallbackMode ? !!fallbackVoiceState.mute : false,
            deaf: fallbackMode ? !!fallbackVoiceState.deaf : false
        });
        socket.emit('discord_voice_users', []);
        return;
    }

    try {
        const settings = await rpc.getVoiceSettings();
        socket.emit('discord_voice_settings', {
            mute: !!settings.mute,
            deaf: !!settings.deaf
        });

        if (!lastKnownChannelId) {
            socket.emit('discord_voice_users', []);
            return;
        }

        const channelInfo = await rpc.getChannel(lastKnownChannelId);
        const users = mapUsersFromChannel(channelInfo).filter((user) => user.id !== rpc.user.id);
        socket.emit('discord_voice_users', users);
    } catch (error) {
        console.warn('No se pudo preparar estado inicial de Discord:', error.message);
        socket.emit('discord_voice_users', []);
    }
};

module.exports = {
    initDiscordRPC,
    discordToggleMute,
    discordToggleDeaf,
    discordSetUserVolume,
    requestInitialDiscordState
};