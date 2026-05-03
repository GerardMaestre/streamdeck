/**
 * DiscordModule — Discord panel: voice users, mute/deaf, volume faders.
 */
import { queueUpdate } from '../utils/dom.js';
import { createFaderController, setThumbTransform } from '../ui/FaderFactory.js';
import { createPanelBackButton } from '../ui/ButtonFactory.js';

export class DiscordModule {
    constructor(ctx) {
        this.socket = ctx.socket;
        this.events = ctx.events;
        this.panelManager = ctx.panelManager;
        this.throttle = ctx.throttle;
        this.activeSliders = ctx.activeSliders;

        // State
        this.discordMute = false;
        this.discordDeaf = false;
        this.discordUsers = [];
        this.discordConnectionStatus = 'disconnected';
        this.discordConnectionMessage = 'Sin conexión con Discord';
        this.discordRowRefs = new Map();
        this._userTrackHeights = new Map();
        this.pendingVolUpdates = {};
        this.lastEmittedVol = {};
        this._faderControllers = [];
        this._pendingFrameUsers = new Map();
        this._pendingSpeakingEvents = new Map();
        this._frameScheduled = false;

        this._onWindowResize = () => {
            this._userTrackHeights.clear();
            this.discordRowRefs.forEach((refs, userId) => {
                const track = refs?.track;
                if (!track) return;
                this._userTrackHeights.set(userId, track.getBoundingClientRect().height);
            });
        };

        window.addEventListener('resize', this._onWindowResize);
    }

    setupSocketListeners() {
        this.socket.on('discord_connection_state', (state) => {
            this.discordConnectionStatus = state?.status || 'disconnected';
            this.discordConnectionMessage = state?.message || 'Sin conexión con Discord';
            this.updateConnectionUI();
            this.updateButtons();
            this.renderMixer();
        });

        this.socket.on('discord_voice_settings', (settings) => {
            this.discordMute = settings.mute;
            this.discordDeaf = settings.deaf;
            this.updateButtons();
        });

        this.socket.on('discord_voice_users', (users) => {
            this.discordUsers = users;
            this.renderMixer();
        });

        this.socket.on('discord_user_speaking', (data) => {
            if (!data?.userId) return;
            this._pendingSpeakingEvents.set(data.userId, !!data.speaking);
            this._scheduleFramePatch();
        });
    }

    /** Open the Discord panel */
    open(discordPanelEl, onBack) {
        if (!discordPanelEl.innerHTML) {
            discordPanelEl.className = 'panel-cache-node discord-sketch-match-view';
            discordPanelEl.innerHTML = `
                <div class="discord-sketch-header">
                    <div id="discord-status-pill" class="discord-status-pill disconnected">DESCONECTADO</div>
                </div>
                <div class="discord-sketch-content">
                    <div class="discord-card-mixer" id="discord-mixer-container"></div>
                    <div class="discord-card-tactical">
                        <div id="tactical-mute-btn" class="discord-tactical-btn"><span class="t-icon">🎙️</span><span class="t-label">MICRO</span></div>
                        <div id="tactical-deaf-btn" class="discord-tactical-btn"><span class="t-icon">🎧</span><span class="t-label">SORDO</span></div>
                    </div>
                </div>
            `;

            discordPanelEl.querySelector('#tactical-mute-btn').addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.toggleMute();
            });
            discordPanelEl.querySelector('#tactical-deaf-btn').addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.toggleDeaf();
            });
        }

        // Asegurar que el botón de atrás siempre esté presente al abrir
        if (!document.getElementById('panel-back-button')) {
            document.body.appendChild(createPanelBackButton(() => {
                if (onBack) onBack();
            }));
        }

        this.updateButtons();
        this.renderMixer();
        this.panelManager.showPanel('discord');
        this.socket.emit('discord_initial_state');
    }

    toggleMute() {
        if (!['connected', 'fallback'].includes(this.discordConnectionStatus)) return;
        if (navigator.vibrate) navigator.vibrate(50);

        this.discordMute = !this.discordMute;
        this.updateButtons();

        this.socket.emit('discord_toggle_mute', (result) => {
            if (result && !result.ok) {
                this.discordMute = !this.discordMute;
                this.updateButtons();
                this.discordConnectionMessage = result?.message || 'No se pudo alternar mute';
                this.updateConnectionUI();
            }
        });
    }

    toggleDeaf() {
        if (!['connected', 'fallback'].includes(this.discordConnectionStatus)) return;
        if (navigator.vibrate) navigator.vibrate(50);

        this.discordDeaf = !this.discordDeaf;
        this.updateButtons();

        this.socket.emit('discord_toggle_deaf', (result) => {
            if (result && !result.ok) {
                this.discordDeaf = !this.discordDeaf;
                this.updateButtons();
                this.discordConnectionMessage = result?.message || 'No se pudo alternar ensordecer';
                this.updateConnectionUI();
            }
        });
    }

    updateConnectionUI() {
        const statusEl = document.getElementById('discord-status-pill');
        if (!statusEl) return;
        const isConnected = ['connected', 'fallback'].includes(this.discordConnectionStatus);
        statusEl.textContent = isConnected ? 'CONECTADO' : 'DESCONECTADO';
        statusEl.className = `discord-status-pill ${isConnected ? 'connected' : 'disconnected'}`;
    }

    updateButtons() {
        const muteBtn = document.getElementById('tactical-mute-btn');
        const deafBtn = document.getElementById('tactical-deaf-btn');
        const isNotConnected = !['connected', 'fallback'].includes(this.discordConnectionStatus);

        if (muteBtn) {
            muteBtn.classList.toggle('active', this.discordMute);
            muteBtn.classList.toggle('disabled', isNotConnected);
        }
        if (deafBtn) {
            deafBtn.classList.toggle('active', this.discordDeaf);
            deafBtn.classList.toggle('disabled', isNotConnected);
        }
    }

    /** Render/update the Discord user mixer with incremental DOM diffing */
    renderMixer() {
        const mixerContainer = document.getElementById('discord-mixer-container');
        if (!mixerContainer) return;

        // Status / empty states
        if (this.discordConnectionStatus !== 'connected') {
            const msg = this.discordConnectionStatus === 'fallback' ? 'MODO BÁSICO ACTIVADO' : 'ESPERANDO A DISCORD...';
            const icon = this.discordConnectionStatus === 'fallback' ? '⚠️' : '📡';
            const emptyState = document.createElement('div');
            emptyState.className = 'discord-empty-state';
            emptyState.innerHTML = `<div class="discord-empty-icon">${icon}</div><div class="discord-empty-text">${msg}</div>`;
            mixerContainer.replaceChildren(emptyState);
            return;
        }

        if (!Array.isArray(this.discordUsers) || this.discordUsers.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'discord-empty-state';
            emptyState.innerHTML = `<div class="discord-empty-icon discord-empty-icon--dim">🔇</div><div class="discord-empty-text discord-empty-text--dim">CANAL VACÍO</div>`;
            mixerContainer.replaceChildren(emptyState);
            return;
        }

        const existing = mixerContainer.querySelector('.discord-empty-state');
        if (existing) existing.remove();

        this.renderInitialSkeleton();
        this.patchUsers(this.discordUsers);
    }

    renderInitialSkeleton() {
        const mixerContainer = document.getElementById('discord-mixer-container');
        if (!mixerContainer) return;

        const existingUsers = Array.from(mixerContainer.querySelectorAll('.user-fader-row'));
        const existingById = new Map(existingUsers.map(el => [el.dataset.userId, el]));
        const nextIds = new Set(this.discordUsers.map(u => u.id));

        existingUsers.forEach(el => {
            if (!nextIds.has(el.dataset.userId)) {
                el.style.opacity = '0';
                el.style.transform = 'scale(0.8)';
                this.discordRowRefs.delete(el.dataset.userId);
                this._userTrackHeights.delete(el.dataset.userId);
                setTimeout(() => el.remove(), 400);
            }
        });

        this.discordUsers.forEach(user => {
            const id = user.id;
            const row = existingById.get(id);
            if (row) return;

            const newRow = this._createUserRow(user, mixerContainer);
            mixerContainer.appendChild(newRow);
            this._userTrackHeights.set(id, this._getTrackHeight(id));

            const ctrl = this._faderControllers[this._faderControllers.length - 1];
            if (ctrl) {
                const fillHeight = (user.volume / 200) * 100;
                requestAnimationFrame(() => ctrl.setPercent(fillHeight, true));
            }
        });
    }

    patchUsers(users) {
        users.forEach((user) => {
            this._pendingFrameUsers.set(user.id, user);
        });
        this._scheduleFramePatch();
    }

    _scheduleFramePatch() {
        if (this._frameScheduled) return;
        this._frameScheduled = true;
        requestAnimationFrame(() => {
            this._frameScheduled = false;
            this._flushFramePatches();
        });
    }

    _flushFramePatches() {
        this._pendingFrameUsers.forEach((user, id) => {
            const refs = this.discordRowRefs.get(id);
            if (!refs) return;

            if (!this.activeSliders.has('discord_' + id)) {
                const h = (user.volume / 200) * 100;
                const trackHeight = this._getTrackHeight(id);
                queueUpdate(`discord_${id}_vol`, () => {
                    refs.fill.style.transform = `scale3d(1, ${h / 100}, 1)`;
                    setThumbTransform(refs.thumb, h, trackHeight);
                });
            }

            const speakingState = this._pendingSpeakingEvents.has(id)
                ? this._pendingSpeakingEvents.get(id)
                : !!user.speaking;
            queueUpdate(`discord_${id}_speaking`, () => {
                const avatarCircle = refs.row.querySelector('.user-avatar-circle');
                if (avatarCircle) avatarCircle.classList.toggle('speaking', speakingState);
            });
        });

        this._pendingSpeakingEvents.forEach((speaking, userId) => {
            if (this._pendingFrameUsers.has(userId)) return;
            const refs = this.discordRowRefs.get(userId);
            if (!refs) return;
            queueUpdate(`discord_${userId}_speaking`, () => {
                const avatarCircle = refs.row.querySelector('.user-avatar-circle');
                if (avatarCircle) avatarCircle.classList.toggle('speaking', speaking);
            });
        });

        this._pendingFrameUsers.clear();
        this._pendingSpeakingEvents.clear();
    }

    _getTrackHeight(userId) {
        const cachedHeight = this._userTrackHeights.get(userId);
        if (typeof cachedHeight === 'number') return cachedHeight;
        const refs = this.discordRowRefs.get(userId);
        const trackHeight = refs?.track?.getBoundingClientRect().height || 0;
        this._userTrackHeights.set(userId, trackHeight);
        return trackHeight;
    }

    /** Create a new user fader row with touch handling */
    _createUserRow(user, mixerContainer) {
        const id = user.id;
        const row = document.createElement('div');
        row.className = 'user-fader-row';
        row.dataset.userId = id;

        const avatarHTML = user.avatar
            ? `<img src="${user.avatar}">`
            : `<span>${user.username.charAt(0).toUpperCase()}</span>`;

        const initialVol = Number(user.volume);
        const fillHeight = (initialVol / 200) * 100;
        const isSpeaking = user.speaking ? ' speaking' : '';

        row.innerHTML = `
            <div class="user-avatar-circle${isSpeaking}">${avatarHTML}</div>
            <div class="slider-container discord-slider-tall">
                <div id="discord-slider-fill-${id}" class="slider-fill discord-fill-warm" style="transform: scale3d(1, ${fillHeight / 100}, 1); transform-origin: bottom;"></div>
                <div class="fader-thumb-mixer" style="bottom: 0"></div>
            </div>
            <div class="discord-username-tag">${user.username}</div>
        `;

        const track = row.querySelector('.slider-container');
        const fill = row.querySelector('.slider-fill');
        const thumb = row.querySelector('.fader-thumb-mixer');
        this.discordRowRefs.set(id, { row, track, fill, thumb });

        // Fader controller via FaderFactory
        const faderCtrl = createFaderController({
            track,
            fill,
            thumb,
            initialPercent: fillHeight,
            captureTarget: thumb,
            onDragStart: () => {
                this.activeSliders.add('discord_' + id);
                row.classList.add('dragging');
            },
            onValueChange: (_smooth, rounded) => {
                if (rounded !== this[`last_discord_${id}`]) {
                    this[`last_discord_${id}`] = rounded;
                    const discordVol = Math.round(rounded * 2);
                    this.updateVolumeServer(id, discordVol);
                }
            },
            onDragEnd: () => {
                row.classList.remove('dragging');
                setTimeout(() => this.activeSliders.delete('discord_' + id), 500);
            }
        });
        // ctrl.setPercent(fillHeight, true); <-- Defer until after append in renderMixer
        this._faderControllers.push(faderCtrl);

        return row;
    }

    /** Send discord volume to server (throttled) */
    updateVolumeServer(userId, value) {
        if (this.discordConnectionStatus !== 'connected') return;
        const queueKey = `discord_${userId}`;
        this.pendingVolUpdates[queueKey] = Number(value);

        this.throttle.schedule(queueKey, () => {
            const currentVolume = Math.round(this.pendingVolUpdates[queueKey]);
            this.socket.volatile.emit('discord_set_user_volume', { userId, volume: currentVolume }, (result) => {
                if (result?.ok) return;
                this.discordConnectionMessage = result?.message || 'No se pudo cambiar el volumen';
                this.updateConnectionUI();
            });
        });
    }

    destroy() {
        window.removeEventListener('resize', this._onWindowResize);
        this._faderControllers.forEach(c => c.destroy());
        this._faderControllers = [];
        this.discordRowRefs.clear();
        this._userTrackHeights.clear();
        this._pendingFrameUsers.clear();
        this._pendingSpeakingEvents.clear();
    }
}
