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
        this.pendingVolUpdates = {};
        this.lastEmittedVol = {};
        this._faderControllers = [];
        this._onResize = this._handleResize.bind(this);
        this._resizeAttached = false;
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
            queueUpdate(`speaking_${data.userId}`, () => {
                const row = document.querySelector(`.user-fader-row[data-user-id="${data.userId}"]`);
                if (row) {
                    const avatarCircle = row.querySelector('.user-avatar-circle');
                    if (avatarCircle) avatarCircle.classList.toggle('speaking', !!data.speaking);
                }
            });
        });
    }

    /** Open the Discord panel */
    open(discordPanelEl, onBack) {
        if (!this._resizeAttached) {
            window.addEventListener('resize', this._onResize);
            this._resizeAttached = true;
        }

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

        const existingUsers = Array.from(mixerContainer.querySelectorAll('.user-fader-row'));
        const existingById = new Map(existingUsers.map(el => [el.dataset.userId, el]));
        const nextIds = new Set(this.discordUsers.map(u => u.id));

        // 1. Remove users no longer present
        existingUsers.forEach(el => {
            if (!nextIds.has(el.dataset.userId)) {
                el.style.opacity = '0';
                el.style.transform = 'scale(0.8)';
                this.discordRowRefs.delete(el.dataset.userId);
                setTimeout(() => el.remove(), 400);
            }
        });

        // 2. Add/Update users
        this.discordUsers.forEach(user => {
            const id = user.id;
            let row = existingById.get(id);

            if (!row) {
                row = this._createUserRow(user, mixerContainer);
                mixerContainer.appendChild(row);
                this._cacheRowMetrics(id, row);
                
                const ctrl = this._faderControllers[this._faderControllers.length - 1];
                if (ctrl) {
                    const fillHeight = (user.volume / 200) * 100;
                    requestAnimationFrame(() => ctrl.setPercent(fillHeight, true));
                }
            } else {
                // Update existing row
                if (!this.activeSliders.has('discord_' + id)) {
                    const refsSafe = this._ensureRowRefs(id, row);
                    const { fill, thumb } = refsSafe;
                    const h = (user.volume / 200) * 100;
                    queueUpdate(`discord_${id}_vol`, () => {
                        fill.style.transform = `scale3d(1, ${h / 100}, 1)`;
                        setThumbTransform(thumb, h, refsSafe.trackHeight);
                    });
                }

                queueUpdate(`discord_${id}_speaking`, () => {
                    const avatarCircle = row.querySelector('.user-avatar-circle');
                    if (avatarCircle) avatarCircle.classList.toggle('speaking', !!user.speaking);
                });
            }
        });
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

    _ensureRowRefs(id, row) {
        const cached = this.discordRowRefs.get(id) || {};
        const refs = {
            row: cached.row || row,
            track: cached.track || row.querySelector('.slider-container'),
            fill: cached.fill || row.querySelector('.slider-fill'),
            thumb: cached.thumb || row.querySelector('.fader-thumb-mixer'),
            trackHeight: Number(cached.trackHeight) || 0
        };
        this.discordRowRefs.set(id, refs);
        return refs;
    }

    _cacheRowMetrics(id, row) {
        const refs = this._ensureRowRefs(id, row);
        refs.trackHeight = refs.track?.getBoundingClientRect().height || 0;
        this.discordRowRefs.set(id, refs);
    }

    _handleResize() {
        this.discordRowRefs.forEach((_refs, id) => {
            const row = document.querySelector(`.user-fader-row[data-user-id="${id}"]`);
            if (row) this._cacheRowMetrics(id, row);
        });
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
        this._faderControllers.forEach(c => c.destroy());
        this._faderControllers = [];
        if (this._resizeAttached) {
            window.removeEventListener('resize', this._onResize);
            this._resizeAttached = false;
        }
        this.discordRowRefs.clear();
    }
}
