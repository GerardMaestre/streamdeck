const { ejecutarMacro } = require('../macroController');

class DiscordVoiceService {
    constructor() {
        this.connectionManager = null;
        this.ioInstance = null;
        this.lastKnownChannelId = null;
        
        this.fallbackVoiceState = {
            mute: false,
            deaf: false
        };
    }

    init(connectionManager, io) {
        this.connectionManager = connectionManager;
        this.ioInstance = io;

        // Hooks toward connectionManager
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

        // Fire connecting sequence start
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
                    avatar: userId && avatarHash ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png` : null,
                    volume
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
                mute: !!(settings.self_mute || settings.mute), 
                deaf: !!(settings.self_deaf || settings.deaf) 
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
            'VOICE_STATE_UPDATE'
        ]);

        await client.subscribe('VOICE_SETTINGS_UPDATE', {});
        await client.subscribe('VOICE_CHANNEL_SELECT', {});

        client.on('VOICE_SETTINGS_UPDATE', (data) => {
            if (!this.ioInstance || this.connectionManager.rpc !== client) return;
            this.ioInstance.emit('discord_voice_settings', { 
                mute: !!(data.self_mute || data.mute), 
                deaf: !!(data.self_deaf || data.deaf) 
            });
        });

        client.on('VOICE_CHANNEL_SELECT', async (data) => {
            if (this.connectionManager.rpc !== client) return;
            this.lastKnownChannelId = data?.channel_id || null;

            if (this.lastKnownChannelId) {
                try {
                    await client.subscribe('VOICE_STATE_UPDATE', { channel_id: this.lastKnownChannelId });
                } catch (error) {
                    console.warn('[Discord Voice] Suscripcion parcial fallada (VOICE_STATE_UPDATE):', error.message);
                }
            }
            await this.publishVoiceUsers();
        });

        client.on('VOICE_STATE_UPDATE', async () => {
            if (this.connectionManager.rpc !== client) return;
            await this.publishVoiceUsers();
        });

        try {
            const selectedVoiceChannel = await client.request('GET_SELECTED_VOICE_CHANNEL');
            this.lastKnownChannelId = selectedVoiceChannel?.id || selectedVoiceChannel?.channel_id || null;
            
            if (this.lastKnownChannelId) {
                try {
                    await client.subscribe('VOICE_STATE_UPDATE', { channel_id: this.lastKnownChannelId });
                } catch (error) {
                    console.warn('[Discord Voice] Suscripción inicial fallada (VOICE_STATE_UPDATE):', error.message);
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
            const state = this.ensureRpcAction();
            if (state.fallbackOk) {
                await ejecutarMacro('mutear_discord');
                this.fallbackVoiceState.mute = !this.fallbackVoiceState.mute;
                this.publishFallbackSettings();
                return { ok: true, message: 'Micro alternado por atajo', fallback: true };
            }

            if (!state.ok) throw new Error('Cliente RPC no disponible');

            const rpc = this.connectionManager.rpc;
            const settings = await rpc.getVoiceSettings();
            // Usamos settings.mute (que es el estado actual reportado por Discord) para invertir el estado
            await rpc.setVoiceSettings({ self_mute: !settings.mute });
            await this.publishVoiceSettings();
            return { ok: true };

        } catch (error) {
            console.error('[Discord Voice] Fallo Mute:', error.message);
            return { ok: false, message: error.message };
        }
    }

    async toggleDeaf() {
        try {
            const state = this.ensureRpcAction();
            if (state.fallbackOk) {
                await ejecutarMacro('ensordecer_discord');
                this.fallbackVoiceState.deaf = !this.fallbackVoiceState.deaf;
                this.publishFallbackSettings();
                return { ok: true, message: 'Cascos alternados por atajo', fallback: true };
            }

            if (!state.ok) throw new Error('Cliente RPC no disponible');

            const rpc = this.connectionManager.rpc;
            const settings = await rpc.getVoiceSettings();
            await rpc.setVoiceSettings({ self_deaf: !settings.deaf });
            await this.publishVoiceSettings();
            return { ok: true };
            
        } catch (error) {
            console.error('[Discord Voice] Fallo Deaf:', error.message);
            return { ok: false, message: error.message };
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
                mute: !!(settings.self_mute || settings.mute), 
                deaf: !!(settings.self_deaf || settings.deaf) 
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