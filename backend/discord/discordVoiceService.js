const { ejecutarMacro } = require('../automation/macroController');

// Helper: normaliza el estado de mute/deaf leyendo ambos campos que puede devolver
// la API de Discord (self_mute/mute y self_deaf/deaf), igual que hacen los event handlers.
function parseMute(settings)  { return !!(settings.self_mute || settings.mute); }
function parseDeaf(settings)  { return !!(settings.self_deaf || settings.deaf); }

class DiscordVoiceService {
    constructor() {
        this.connectionManager = null;
        this.ioInstance = null;
        this.lastKnownChannelId = null;

        this.fallbackVoiceState = {
            mute: false,
            deaf: false
        };

        this.speakingUsers = new Set();
        this.speakingTimeouts = new Map();
        this.speakingMeta = new Map();
        this.speakingInactivityMs = Number(process.env.DISCORD_SPEAKING_INACTIVITY_MS) || 2200;
        this.explicitDominanceMs = Number(process.env.DISCORD_SPEAKING_EXPLICIT_DOMINANCE_MS) || 1200;
        this.logger = console;
    }

    init(connectionManager, io) {
        this.connectionManager = connectionManager;
        this.ioInstance = io;

        this.connectionManager.onConnected = async (client) => {
            try {
                await this.setupRpcSubscriptions(client);
            } catch (e) {
                console.error('[Discord Voice] Fallo al establecer suscripciones RPC:', e.message);
            }
        };

        this.connectionManager.onDisconnected = () => {
            this.lastKnownChannelId = null;
            this.publishVoiceUsers([]);
        };

        this.connectionManager.onFallback = () => {
            this.publishFallbackSettings();
        };

        this.connectionManager.setIoInstance(io);
        this.connectionManager.connect();
    }

    mapUsersFromChannel(channelInfo) {
        try {
            const voiceStates = Array.isArray(channelInfo?.voice_states) ? channelInfo.voice_states : [];
            return voiceStates.map((voiceState) => {
                const user = voiceState.user || {};
                const userId = user.id || voiceState.user_id;
                const username = user.username || voiceState.nick || 'Usuario';
                const avatarHash = user.avatar;
                const volumeRaw = Number(voiceState.volume);
                const volume = Number.isFinite(volumeRaw) ? Math.min(200, Math.max(0, volumeRaw)) : 100;

                return {
                    id: userId,
                    username,
                    avatar: userId && avatarHash
                        ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`
                        : null,
                    volume,
                    speaking: this.speakingUsers.has(userId)
                };
            }).filter((user) => user.id);
        } catch (e) {
            console.error('[Discord Voice] Error transformando usuarios de canal:', e.message);
            return [];
        }
    }

    async publishVoiceUsers(usersOrFallback = null) {
        if (!this.ioInstance) return;

        if (Array.isArray(usersOrFallback)) {
            this.ioInstance.emit('discord_voice_users', usersOrFallback);
            return;
        }

        if (!this.connectionManager.isRpcReady() || !this.lastKnownChannelId) {
            this.ioInstance.emit('discord_voice_users', []);
            return;
        }

        try {
            const rpc = this.connectionManager.rpc;
            const channelInfo = await rpc.getChannel(this.lastKnownChannelId);
            const users = this.mapUsersFromChannel(channelInfo);
            const others = users.filter((user) => user.id !== rpc.user.id);
            this.ioInstance.emit('discord_voice_users', others);
        } catch (error) {
            console.warn('[Discord Voice] No se pudo obtener usuarios:', error.message);
            this.ioInstance.emit('discord_voice_users', []);
        }
    }

    async publishVoiceSettings() {
        if (!this.ioInstance || !this.connectionManager.isRpcReady()) return;

        try {
            const rpc = this.connectionManager.rpc;
            const settings = await rpc.getVoiceSettings();
            this.ioInstance.emit('discord_voice_settings', {
                mute: parseMute(settings),
                deaf: parseDeaf(settings)
            });
        } catch (error) {
            console.warn('[Discord Voice] No se pudo obtener estado de voz:', error.message);
        }
    }

    publishFallbackSettings() {
        try {
            if (this.ioInstance) {
                this.ioInstance.emit('discord_voice_settings', {
                    mute: !!this.fallbackVoiceState.mute,
                    deaf: !!this.fallbackVoiceState.deaf
                });
                this.ioInstance.emit('discord_voice_users', []);
            }
        } catch (e) {
            console.error('[Discord Voice] Fallo al publicar info fallback:', e.message);
        }
    }

    async setupRpcSubscriptions(client) {
        this.connectionManager.removeRpcListenersByEvent(client, [
            'VOICE_SETTINGS_UPDATE',
            'VOICE_CHANNEL_SELECT',
            'VOICE_STATE_UPDATE',
            'SPEAKING',
            'SPEAKING_START',
            'SPEAKING_STOP'
        ]);

        await client.subscribe('VOICE_SETTINGS_UPDATE', {});
        await client.subscribe('VOICE_CHANNEL_SELECT', {});

        client.on('VOICE_SETTINGS_UPDATE', (data) => {
            if (!this.ioInstance || this.connectionManager.rpc !== client) return;
            this.ioInstance.emit('discord_voice_settings', {
                mute: parseMute(data),
                deaf: parseDeaf(data)
            });
        });

        client.on('VOICE_CHANNEL_SELECT', async (data) => {
            if (this.connectionManager.rpc !== client) return;

            const previousChannelId = this.lastKnownChannelId;
            const nextChannelId = data?.channel_id || null;

            if (previousChannelId && previousChannelId !== nextChannelId) {
                try {
                    await client.unsubscribe('VOICE_STATE_UPDATE', { channel_id: previousChannelId });
                } catch (error) {
                    console.warn('[Discord Voice] No se pudo desuscribir del canal anterior:', error.message);
                }
            }

            this.lastKnownChannelId = nextChannelId;

            if (this.lastKnownChannelId) {
                try {
                    await client.subscribe('VOICE_STATE_UPDATE', { channel_id: this.lastKnownChannelId });
                    await client.subscribe('SPEAKING', { channel_id: this.lastKnownChannelId });
                    await client.subscribe('SPEAKING_START', { channel_id: this.lastKnownChannelId });
                    await client.subscribe('SPEAKING_STOP', { channel_id: this.lastKnownChannelId });
                } catch (error) {
                    console.warn('[Discord Voice] Suscripción eventos fallida:', error.message);
                }
            }

            await this.publishVoiceUsers();
        });

        const setSpeakingState = (uId, isSpeaking, source, explicit = false) => {
            if (!this.ioInstance || !uId) return;
            const now = Date.now();
            const previous = this.speakingMeta.get(uId);
            const previousState = !!previous?.speaking;
            const previousSource = previous?.source || 'none';

            if (!explicit && previous?.explicit && now - previous.updatedAt < this.explicitDominanceMs && previousState !== isSpeaking) {
                this.logger.debug?.(`[Discord Voice] speaking ignored (fallback under explicit dominance) userId=${uId} source=${source} prev=${previousSource} prevState=${previousState} nextState=${isSpeaking}`);
                return;
            }

            if (this.speakingTimeouts.has(uId)) {
                clearTimeout(this.speakingTimeouts.get(uId));
                this.speakingTimeouts.delete(uId);
            }

            if (isSpeaking) this.speakingUsers.add(uId);
            else this.speakingUsers.delete(uId);

            this.speakingMeta.set(uId, { speaking: isSpeaking, source, explicit, updatedAt: now });
            this.logger.debug?.(`[Discord Voice] speaking transition userId=${uId} source=${source} ${previousState} -> ${isSpeaking}`);
            this.ioInstance.emit('discord_user_speaking', { userId: uId, speaking: isSpeaking, source, ts: now });

            if (isSpeaking && !explicit) {
                const timeout = setTimeout(() => {
                    const latest = this.speakingMeta.get(uId);
                    if (latest?.speaking) {
                        this.speakingUsers.delete(uId);
                        const ts = Date.now();
                        this.speakingMeta.set(uId, { speaking: false, source: 'timeout', explicit: false, updatedAt: ts });
                        this.logger.debug?.(`[Discord Voice] speaking transition userId=${uId} source=timeout true -> false`);
                        this.ioInstance.emit('discord_user_speaking', { userId: uId, speaking: false, source: 'timeout', ts });
                    }
                    this.speakingTimeouts.delete(uId);
                }, this.speakingInactivityMs);
                this.speakingTimeouts.set(uId, timeout);
            }
        };

        const handleGenericSpeaking = (data) => {
            const uId = data.user_id || data.userId;
            const hasState = data.speaking_state !== undefined;
            const state = hasState ? (data.speaking_state !== 0) : true;
            setSpeakingState(uId, state, 'SPEAKING', false);
        };
        const handleStartSpeaking = (data) => setSpeakingState(data.user_id || data.userId, true, 'SPEAKING_START', true);
        const handleStopSpeaking = (data) => setSpeakingState(data.user_id || data.userId, false, 'SPEAKING_STOP', true);

        client.on('SPEAKING', handleGenericSpeaking);
        client.on('speaking', handleGenericSpeaking);
        client.on('SPEAKING_START', handleStartSpeaking);
        client.on('speaking-start', handleStartSpeaking);
        client.on('SPEAKING_STOP', handleStopSpeaking);
        client.on('speaking-stop', handleStopSpeaking);

        client.on('VOICE_STATE_UPDATE', async () => {
            if (this.connectionManager.rpc !== client) return;
            await this.publishVoiceUsers();
        });

        // Obtener el canal de voz actual al conectar
        try {
            const selectedVoiceChannel = await client.request('GET_SELECTED_VOICE_CHANNEL');
            this.lastKnownChannelId = selectedVoiceChannel?.id || selectedVoiceChannel?.channel_id || null;

            if (this.lastKnownChannelId) {
                try {
                    await client.subscribe('VOICE_STATE_UPDATE', { channel_id: this.lastKnownChannelId });
                    await client.subscribe('SPEAKING', { channel_id: this.lastKnownChannelId });
                    await client.subscribe('SPEAKING_START', { channel_id: this.lastKnownChannelId });
                    await client.subscribe('SPEAKING_STOP', { channel_id: this.lastKnownChannelId });
                } catch (error) {
                    console.warn('[Discord Voice] Suscripción inicial events fallada:', error.message);
                }
            }
        } catch (error) {
            this.lastKnownChannelId = null;
        }

        await this.publishVoiceSettings();
        await this.publishVoiceUsers();
    }

    ensureRpcAction() {
        return {
            ok: this.connectionManager.isRpcReady() && this.connectionManager.voiceControlAvailable,
            fallbackOk: this.connectionManager.fallbackMode || !this.connectionManager.voiceControlAvailable
        };
    }

    async toggleMute() {
        try {
            // REGLA DE ORO: Si no hay conexión RPC completa (VoiceCapable),
            // ejecutamos la macro inmediatamente para que el usuario no espere.
            const state = this.ensureRpcAction();
            if (!state.ok) {
                console.log('[Discord Voice] Ejecutando Macro de Mute (Modo Fallback/Macro activo)');
                await ejecutarMacro('mutear_discord');
                this.fallbackVoiceState.mute = !this.fallbackVoiceState.mute;
                this.publishFallbackSettings();
                return { ok: true, message: 'Micro alternado por atajo', fallback: true };
            }

            const rpc = this.connectionManager.rpc;
            const settings = await rpc.getVoiceSettings();
            await rpc.setVoiceSettings({ mute: !parseMute(settings) });
            await this.publishVoiceSettings();
            return { ok: true };

        } catch (error) {
            console.error('[Discord Voice] Fallo Mute:', error.message);
            // Si el RPC falla por cualquier motivo, intentamos la macro como último recurso
            await ejecutarMacro('mutear_discord');
            return { ok: true, message: 'Fallo RPC, usado Atajo', fallback: true };
        }
    }

    async toggleDeaf() {
        try {
            const state = this.ensureRpcAction();
            if (!state.ok) {
                console.log('[Discord Voice] Ejecutando Macro de Sordera (Modo Fallback/Macro activo)');
                await ejecutarMacro('ensordecer_discord');
                this.fallbackVoiceState.deaf = !this.fallbackVoiceState.deaf;
                this.publishFallbackSettings();
                return { ok: true, message: 'Cascos alternados por atajo', fallback: true };
            }

            const rpc = this.connectionManager.rpc;
            const settings = await rpc.getVoiceSettings();
            await rpc.setVoiceSettings({ deaf: !parseDeaf(settings) });
            await this.publishVoiceSettings();
            return { ok: true };

        } catch (error) {
            console.error('[Discord Voice] Fallo Deaf:', error.message);
            await ejecutarMacro('ensordecer_discord');
            return { ok: true, message: 'Fallo RPC, usado Atajo', fallback: true };
        }
    }

    async setUserVolume(userId, volume) {
        try {
            const state = this.ensureRpcAction();
            if (state.fallbackOk) return { ok: false, message: 'OAuth requerido para cambiar audios por usuario' };
            if (!state.ok) throw new Error('Cliente RPC no listo');

            const rpc = this.connectionManager.rpc;
            const normalizedVolume = Math.min(200, Math.max(0, parseInt(volume, 10) || 0));
            await rpc.setUserVoiceSettings(userId, { volume: normalizedVolume });
            return { ok: true };

        } catch (error) {
            console.error('[Discord Voice] Fallo Volumen Usuarios:', error.message);
            return { ok: false, message: error.message };
        }
    }

    async requestInitialState(socket) {
        if (!socket) return;

        try {
            socket.emit('discord_connection_state', this.connectionManager.connectionState);

            const state = this.ensureRpcAction();
            if (state.fallbackOk || !state.ok) {
                socket.emit('discord_voice_settings', {
                    mute: !!this.fallbackVoiceState.mute,
                    deaf: !!this.fallbackVoiceState.deaf
                });
                socket.emit('discord_voice_users', []);
                return;
            }

            const rpc = this.connectionManager.rpc;
            const settings = await rpc.getVoiceSettings();
            socket.emit('discord_voice_settings', {
                mute: parseMute(settings),
                deaf: parseDeaf(settings)
            });

            if (!this.lastKnownChannelId) {
                socket.emit('discord_voice_users', []);
                return;
            }

            const channelInfo = await rpc.getChannel(this.lastKnownChannelId);
            const users = this.mapUsersFromChannel(channelInfo).filter((u) => u.id !== rpc.user.id);
            socket.emit('discord_voice_users', users);

        } catch (error) {
            console.warn('[Discord Voice] Recuperación estado inicial fallida:', error.message);
            socket.emit('discord_voice_users', []);
        }
    }
}

module.exports = new DiscordVoiceService();
