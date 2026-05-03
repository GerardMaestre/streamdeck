const { exec } = require('child_process');
const RPC = require('discord-rpc');
const Logger = require('../core/logger/logger');
const { withTimeout, retryWithBackoff, circuitState } = require('../utils/resilience');

// Discord variables will be dynamically retrieved from process.env on demand.

const LOGIN_SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
const DEFAULT_RECONNECT_MS = 10000;
const FALLBACK_RETRY_MS = 60000;
const RPC_DYNAMIC_EVENTS = ['VOICE_SETTINGS_UPDATE', 'VOICE_CHANNEL_SELECT', 'VOICE_STATE_UPDATE'];

class DiscordConnectionManager {
    constructor() {
        this.rpc = null;
        this.ioInstance = null;
        this.reconnectTimer = null;
        this.isConnecting = false;
        this.lastDiscordLaunchAttemptAt = 0;
        this.lastDiscordRunCheckAt = 0;
        this.discordRunningCache = true;
        this.fallbackMode = false;
        this.voiceControlAvailable = false;

        this.connectionState = {
            status: 'disconnected',
            reasonCode: 'INIT',
            message: 'Discord no conectado'
        };
        this.rpcCircuit = circuitState({ failureThreshold: 4, cooldownMs: 30000 });

        this.onConnected = () => {};
        this.onDisconnected = () => {};
        this.onFallback = () => {};
    }

    setIoInstance(io) {
        this.ioInstance = io;
    }

    updateConnectionState(status, message, reasonCode = 'UNKNOWN') {
        this.connectionState = { status, message, reasonCode };
        try {
            if (this.ioInstance) {
                this.ioInstance.emit('discord_connection_state', this.connectionState);
            }
        } catch (error) {
            Logger.error('[Discord Connection] Error al emitir estado a sockets:', error.message);
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

    destroyRpcClient(client) {
        if (!client) return;
        try {
            // Eliminar listeners primero para evitar que eventos de error disparen reconexiones bucle
            if (typeof client.removeAllListeners === 'function') {
                client.removeAllListeners();
            }
            
            // Forzar cierre del socket subyacente si existe para evitar sockets colgando
            if (client.transport && client.transport.socket && typeof client.transport.socket.destroy === 'function') {
                client.transport.socket.destroy();
            }

            // Intentar cerrar la conexión de forma segura
            if (typeof client.destroy === 'function') {
                client.destroy().catch(() => {}); // Ignorar errores de destrucción
            }
        } catch (error) {
            // Silencioso: no queremos spam si falla la limpieza
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

    async isDiscordRunning() {
        if (process.platform !== 'win32') return true;

        const now = Date.now();
        if (now - this.lastDiscordRunCheckAt < 30000) {
            return this.discordRunningCache;
        }

        this.lastDiscordRunCheckAt = now;
        return new Promise((resolve) => {
            exec('tasklist /FI "IMAGENAME eq Discord.exe"', (err, stdout) => {
                if (err) {
                    this.discordRunningCache = true;
                    return resolve(true);
                }
                const isRunning = stdout.toLowerCase().includes('discord.exe');
                this.discordRunningCache = isRunning;
                resolve(isRunning);
            });
        });
    }

    maybeLaunchDiscordDesktop() {
        if (process.platform !== 'win32') return;
        const now = Date.now();
        if (now - this.lastDiscordLaunchAttemptAt < 60000) return;

        this.lastDiscordLaunchAttemptAt = now;
        exec('start "" "discord://"', (error) => {
            if (error) {
                Logger.warn(`[Discord Connection] No se pudo lanzar Discord automáticamente: ${error.message}`);
            }
        });
    }

    buildLoginAttempts() {
        const attempts = [];
        const clientId = (process.env.DISCORD_CLIENT_ID || '').trim();
        const clientSecret = (process.env.DISCORD_CLIENT_SECRET || '').trim();
        const redirectUri = (process.env.DISCORD_REDIRECT_URI || 'http://localhost').trim();
        
        if (!clientId) {
            Logger.warn('[Discord] DISCORD_CLIENT_ID no definido en .env. No se pueden generar intentos.');
            return attempts;
        }

        const redirectCandidates = [
            redirectUri,
            'http://localhost',
            'http://127.0.0.1',
            'http://localhost/callback',
            'http://127.0.0.1/callback',
            'http://localhost:3000/callback',
            'http://127.0.0.1:3000/callback'
        ]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);

        // 1. INTENTOS AVANZADOS (OAuth) - Para control de volumen y voz
        for (const candidate of redirectCandidates) {
            attempts.push({
                label: `Avanzado (Silent)`,
                id: `oauth-none-${candidate}`,
                voiceCapable: true,
                timeoutMs: 15000,
                delayMs: 1500, // Aumentado para evitar rate limit de IPC de Discord
                options: { clientId, clientSecret, scopes: LOGIN_SCOPES, redirectUri: candidate, prompt: 'none' }
            });
        }

        // 2. INTENTO BÁSICO (IPC Directo) - Fallback rápido para mute/deaf global
        attempts.push({
            label: 'Básico',
            id: 'basic-ipc',
            voiceCapable: false,
            timeoutMs: 15000,
            delayMs: 1500, // Asegurar un respiro antes del fallback
            options: { clientId }
        });

        // 3. INTENTO CON UI (Último recurso, requiere interacción)
        for (const candidate of redirectCandidates) {
            attempts.push({
                label: `Avanzado (Autorizar)`,
                id: `oauth-ui-${candidate}`,
                voiceCapable: true,
                timeoutMs: 30000,
                delayMs: 2000,
                options: { clientId, clientSecret, scopes: LOGIN_SCOPES, redirectUri: candidate, prompt: 'consent' }
            });
        }
        return attempts;
    }

    async loginWithAttempts() {
        const isRunning = await this.isDiscordRunning();
        Logger.info(`[Discord] Comprobando ejecucion: ${isRunning ? 'Discord DETECTADO' : 'Discord NO DETECTADO'}`);
        if (!isRunning) {
            const error = new Error('Discord no está ejecutándose en este PC');
            error.code = 'DISCORD_NOT_RUNNING';
            throw error;
        }

        const attempts = this.buildLoginAttempts();
        let lastError = new Error('No se pudo autenticar con Discord RPC');
        let authFailureDetected = false;

        for (const attempt of attempts) {
            if (attempt.delayMs) {
                await new Promise(r => setTimeout(r, attempt.delayMs));
            }

            const attemptClient = new RPC.Client({ transport: 'ipc' });
            
            try {
                Logger.info(`[Discord] Intentando conexion: ${attempt.label}...`);
                const loggedClient = await retryWithBackoff(() => withTimeout(() => attemptClient.login(attempt.options), attempt.timeoutMs, { reasonCode: 'DISCORD_LOGIN_TIMEOUT' }), { retries: 1, initialDelayMs: 300, shouldRetry: (e) => e?.code === 'DISCORD_LOGIN_TIMEOUT' });
                
                if (attempt.voiceCapable) {
                    try {
                        await loggedClient.getVoiceSettings();
                    } catch (voiceError) {
                        Logger.warn(`[Discord] El modo ${attempt.label} conecto pero no tiene permisos de voz.`);
                        this.destroyRpcClient(attemptClient);
                        continue;
                    }
                }
                return { client: loggedClient, attemptLabel: attempt.label, voiceCapable: !!attempt.voiceCapable };
            } catch (error) {
                Logger.warn(`[Discord] Intento ${attempt.label} fallo: ${error.message}`);
                this.destroyRpcClient(attemptClient);
                if (this.isAuthLoginError(error?.message)) authFailureDetected = true;
                lastError = error;
            }
        }
        if (authFailureDetected) lastError.authFailureDetected = true;
        throw lastError;
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

    async connect(forceFreshAuth = false) {
        if (this.isConnecting) return;
        if (this.isRpcReady()) {
            if (!(forceFreshAuth && this.fallbackMode)) return;
            this.destroyRpcClient(this.rpc);
        }

        this.isConnecting = true;
        this.updateConnectionState('degraded', 'Conectando con Discord...', 'CONNECTING');

        try {
            const { client, attemptLabel, voiceCapable } = await this.loginWithAttempts();
            this.rpc = client;
            const currentClient = client;

            this.clearReconnectTimer();
            this.removeRpcListenersByEvent(currentClient, ['disconnected']);

            currentClient.on('disconnected', () => {
                if (this.rpc !== currentClient) return;
                this.updateConnectionState('disconnected', 'Discord desconectado. Reintentando...', 'SOCKET_DISCONNECTED');

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
                this.rpcCircuit.recordSuccess();
                this.updateConnectionState('connected', `Conectado como ${client.user?.username || 'Discord'}`, 'RPC_OK');
                Logger.info(`[Discord] [OK] Conectado como ${client.user?.username} (${attemptLabel})`);
                try {
                    await this.onConnected(currentClient);
                } catch (e) {
                    // Silencioso
                }
            } else {
                this.rpcCircuit.recordFailure();
                this.updateConnectionState('degraded', `Conectado básico como ${client.user?.username || 'Usuario'}`, 'VOICE_UNAVAILABLE');
                Logger.warn(`[Discord] [!] Conectado en modo básico (${attemptLabel})`);
                try {
                    this.onFallback();
                } catch (e) {
                    // Silencioso
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

        if (error.code === 'DISCORD_NOT_RUNNING' || lowerMessage.includes('discord no está ejecutándose')) {
            Logger.info('[Discord Connection] Discord no está ejecutándose. Reintentando en 60 segundos.');
            this.fallbackMode = true;
            this.voiceControlAvailable = false;
            this.updateConnectionState('disconnected', 'Discord cerrado. Reintentando en 60 segundos...', 'DISCORD_NOT_RUNNING');
            if (this.rpc) {
                this.destroyRpcClient(this.rpc);
            }
            this.scheduleReconnect(60000, { allowInFallback: true, forceFreshAuth: true });
            return;
        }

        Logger.error(`[Discord Connection] Fallo al conectar: ${message}`);
        if (error.code) Logger.error(`[Discord Connection] Codigo de error: ${error.code}`);
        if (error.stack && !lowerMessage.includes('connection closed')) {
             // Solo mostrar stack si no es el tipico cierre de conexion
             Logger.error(error.stack);
        }
        if (this.rpc) {
            this.destroyRpcClient(this.rpc);
        }

        if (authError || lowerMessage.includes('rpc_connection_timeout') || lowerMessage.includes('discord_login_timeout')) {
            this.fallbackMode = true;
            this.voiceControlAvailable = false;
            this.updateConnectionState(
                'degraded',
                authError ? 'Modo básico activo: auto-reconexión...' : 'Discord no responde: reconectando...' , authError ? 'AUTH_FAILED' : 'RPC_UNRESPONSIVE'
            );

            try {
                this.onFallback();
            } catch (e) {
                console.error('[Discord Connection] Error activando fallback en fallo:', e.message);
            }

            if (!authError) this.maybeLaunchDiscordDesktop();

            this.scheduleReconnect(
                authError ? FALLBACK_RETRY_MS : 15000,
                { allowInFallback: true, forceFreshAuth: authError }
            );
            return;
        }

        this.rpcCircuit.recordFailure();
        this.updateConnectionState('disconnected', message, error.code || 'CONNECT_ERROR');
        this.rpc = null;
        this.scheduleReconnect(DEFAULT_RECONNECT_MS);
    }
}

module.exports = new DiscordConnectionManager();