const { exec } = require('child_process');
const RPC = require('discord-rpc');

const clientId = process.env.DISCORD_CLIENT_ID || '1152291774610546688';
const clientSecret = process.env.DISCORD_CLIENT_SECRET || 'wGwfH1ZFUO395rKWn5b1DqIovAc35CO6';
const redirectUri = process.env.DISCORD_REDIRECT_URI || 'http://localhost';

const LOGIN_SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
const DEFAULT_RECONNECT_MS = 10000;
const FALLBACK_RETRY_MS = 60000;
const LOGIN_ATTEMPT_TIMEOUT_MS = 20000;
const RPC_DYNAMIC_EVENTS = ['VOICE_SETTINGS_UPDATE', 'VOICE_CHANNEL_SELECT', 'VOICE_STATE_UPDATE'];

class DiscordConnectionManager {
    constructor() {
        this.rpc = null;
        this.ioInstance = null;
        this.reconnectTimer = null;
        this.isConnecting = false;
        this.lastDiscordLaunchAttemptAt = 0;
        this.fallbackMode = false;
        this.voiceControlAvailable = false;
        
        this.connectionState = {
            status: 'disconnected',
            message: 'Discord no conectado'
        };

        // Callbacks to be hooked by Voice Service
        this.onConnected = () => {};
        this.onDisconnected = () => {};
        this.onFallback = () => {};
    }

    setIoInstance(io) {
        this.ioInstance = io;
    }

    updateConnectionState(status, message) {
        this.connectionState = { status, message };
        try {
            if (this.ioInstance) {
                this.ioInstance.emit('discord_connection_state', this.connectionState);
            }
        } catch (error) {
            console.error('[Discord Connection] Error al emitir estado a sockets:', error.message);
        }
    }

    isRpcReady() {
        return Boolean(this.rpc && this.rpc.user);
    }

    isAuthLoginError(message = '') {
        const lower = String(message).toLowerCase();
        return lower.includes('401') || lower.includes('unauthorized') || 
               lower.includes('invalid') || lower.includes('not authenticated');
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    removeRpcListenersByEvent(client, eventNames = []) {
        if (!client || typeof client.removeAllListeners !== 'function') return;
        for (const eventName of eventNames) {
            try {
                client.removeAllListeners(eventName);
            } catch (error) {
                console.warn(`[Discord Connection] Fallo al limpiar listeners ${eventName}:`, error.message);
            }
        }
    }

    destroyRpcClient(client) {
        if (!client) return;

        // Parche de seguridad para discord-rpc: Evita crasheo Hard de Node
        // cuando el socket IPC ha muerto pero el client intenta enviar el opcode de cierre.
        if (client.transport && !client.transport.socket) {
            client.transport.send = () => {}; 
            client.transport.close = () => {}; // <-- monkeypatch close
        }

        this.removeRpcListenersByEvent(client, ['disconnected', ...RPC_DYNAMIC_EVENTS]);
        try {
            client.destroy();
        } catch (error) {
            console.warn('[Discord Connection] Fallo al destruir cliente:', error.message);
        }
        if (client === this.rpc) {
            this.rpc = null;
        }
    }

    scheduleReconnect(delayMs = DEFAULT_RECONNECT_MS, { allowInFallback = false, forceFreshAuth = false } = {}) {
        if (this.reconnectTimer || (this.fallbackMode && !allowInFallback)) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect(forceFreshAuth);
        }, delayMs);
    }

    maybeLaunchDiscordDesktop() {
        if (process.platform !== 'win32') return;
        const now = Date.now();
        if (now - this.lastDiscordLaunchAttemptAt < 60000) return;
        
        this.lastDiscordLaunchAttemptAt = now;
        exec('start "" "discord://"', (error) => {
            if (error) {
                console.warn('[Discord Connection] No se pudo lanzar Discord automáticamente:', error.message);
            }
        });
    }

    buildLoginAttempts() {
        const attempts = [];
        const redirectCandidates = [redirectUri, 'http://localhost', 'http://127.0.0.1']
            .filter(Boolean).filter((value, index, list) => list.indexOf(value) === index);

        for (const candidate of redirectCandidates) {
            attempts.push({
                label: `oauth-none-${candidate}`,
                voiceCapable: true,
                timeoutMs: 20000,
                options: { clientId, clientSecret, scopes: LOGIN_SCOPES, redirectUri: candidate, prompt: 'none' }
            });
            attempts.push({
                label: `oauth-consent-${candidate}`,
                voiceCapable: true,
                timeoutMs: 45000,
                options: { clientId, clientSecret, scopes: LOGIN_SCOPES, redirectUri: candidate, prompt: 'consent' }
            });
        }
        attempts.push({
            label: 'basic-ipc',
            voiceCapable: false,
            timeoutMs: 12000,
            options: { clientId }
        });
        return attempts;
    }

    async loginAttemptWithTimeout(client, options, timeoutMs) {
        const timeoutToken = Symbol('login-timeout');
        let timer = null;
        try {
            const timeoutPromise = new Promise((resolve) => {
                timer = setTimeout(() => resolve(timeoutToken), timeoutMs);
            });
            const result = await Promise.race([client.login(options), timeoutPromise]);
            if (result === timeoutToken) throw new Error('DISCORD_LOGIN_TIMEOUT');
            return result;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async loginWithAttempts() {
        const attempts = this.buildLoginAttempts();
        let lastError = new Error('No se pudo autenticar con Discord RPC');
        let authFailureDetected = false;

        for (const attempt of attempts) {
            const attemptClient = new RPC.Client({ transport: 'ipc' });
            try {
                const loggedClient = await this.loginAttemptWithTimeout(attemptClient, attempt.options, attempt.timeoutMs);
                if (attempt.voiceCapable) {
                    try {
                        await loggedClient.getVoiceSettings();
                    } catch (voiceError) {
                        lastError = voiceError;
                        this.destroyRpcClient(loggedClient);
                        continue;
                    }
                }
                return { client: loggedClient, attemptLabel: attempt.label, voiceCapable: !!attempt.voiceCapable };
            } catch (error) {
                lastError = error;
                if (this.isAuthLoginError(error?.message)) authFailureDetected = true;
                this.destroyRpcClient(attemptClient);
            }
        }
        if (authFailureDetected) lastError.authFailureDetected = true;
        throw lastError;
    }

    async connect(forceFreshAuth = false) {
        if (this.isConnecting) return;
        if (this.isRpcReady()) {
            if (!(forceFreshAuth && this.fallbackMode)) return;
            this.destroyRpcClient(this.rpc);
        }

        this.isConnecting = true;
        this.updateConnectionState('connecting', 'Conectando con Discord...');

        try {
            const { client, attemptLabel, voiceCapable } = await this.loginWithAttempts();
            this.rpc = client;
            const currentClient = client;

            this.clearReconnectTimer();
            this.removeRpcListenersByEvent(currentClient, ['disconnected']);

            currentClient.on('disconnected', () => {
                if (this.rpc !== currentClient) return;
                this.updateConnectionState('disconnected', 'Discord desconectado. Reintentando...');
                
                try {
                    this.onDisconnected();
                } catch (e) {
                    console.error('[Discord Connection] Error procesando desconexión:', e.message);
                }

                this.removeRpcListenersByEvent(currentClient, ['disconnected', ...RPC_DYNAMIC_EVENTS]);
                this.rpc = null;
                this.scheduleReconnect(DEFAULT_RECONNECT_MS);
            });

            this.voiceControlAvailable = voiceCapable;
            this.fallbackMode = !voiceCapable;

            if (voiceCapable) {
                this.updateConnectionState('connected', `Conectado como ${client.user?.username || 'Discord'}`);
                console.log(`[Discord Connection] Online como ${client.user?.username} (${attemptLabel})`);
                try {
                    await this.onConnected(currentClient);
                } catch (e) {
                    console.error('[Discord Connection] Error durante callback de conexión:', e.message);
                }
            } else {
                this.updateConnectionState('fallback', `Conectado básico como ${client.user?.username || 'Usuario'}`);
                console.log(`[Discord Connection] Online modo básico (${attemptLabel})`);
                try {
                    this.onFallback();
                } catch (e) {
                    console.error('[Discord Connection] Error activando fallback:', e.message);
                }
                this.scheduleReconnect(FALLBACK_RETRY_MS, { allowInFallback: true, forceFreshAuth: true });
            }
        } catch (error) {
            this.handleConnectionError(error);
        } finally {
            this.isConnecting = false;
        }
    }

    handleConnectionError(error) {
        const message = error?.message || 'Error desconocido';
        const lowerMessage = message.toLowerCase();
        const authError = Boolean(error?.authFailureDetected) || this.isAuthLoginError(message);

        console.error('[Discord Connection] Fallo al conectar:', message);

        if (this.rpc) {
            this.destroyRpcClient(this.rpc);
        }

        if (authError || lowerMessage.includes('rpc_connection_timeout') || lowerMessage.includes('discord_login_timeout')) {
            this.fallbackMode = true;
            this.voiceControlAvailable = false;
            this.updateConnectionState('fallback', authError ? 'Modo básico activo: auto-reconexión...' : 'Discord no responde: reconectando...');
            
            try {
                this.onFallback();
            } catch (e) {
                console.error('[Discord Connection] Error activando fallback en fallo:', e.message);
            }

            if (!authError) this.maybeLaunchDiscordDesktop();
            
            this.scheduleReconnect(authError ? FALLBACK_RETRY_MS : 15000, { allowInFallback: true, forceFreshAuth: authError });
            return;
        }

        this.updateConnectionState('error', message);
        this.rpc = null;
        this.scheduleReconnect(DEFAULT_RECONNECT_MS);
    }
}

module.exports = new DiscordConnectionManager();