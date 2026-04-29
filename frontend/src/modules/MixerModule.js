/**
 * MixerModule — Full audio mixer panel: render, faders, mute, volume.
 */
import { sanitizeId } from '../utils/dom.js';
import { queueUpdate } from '../utils/dom.js';
import { createFaderController, setThumbTransform } from '../ui/FaderFactory.js';
import { createPanelBackButton } from '../ui/ButtonFactory.js';

/**
 * Returns an emoji/SVG icon for a given app name.
 */
function getIconForApp(appName, isMaster) {
    const shadowClass = 'mixer-icon-shadow';
    if (isMaster) return `<span class="${shadowClass}" style="font-size:3.2rem; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));">🎧</span>`;

    const name = appName.toLowerCase();
    const fallbackSVG = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7;"><rect x="2" y="3" width="20" height="14" rx="3" ry="3"></rect><line x1="2" y1="9" x2="22" y2="9"></line><circle cx="6" cy="6" r="1" fill="white" stroke="none"></circle><circle cx="10" cy="6" r="1" fill="white" stroke="none"></circle></svg>`;

    const iconEmojiMap = {
        'spotify': '🎵', 'discord': '💬', 'chrome': '🌐', 'edge': '🌐',
        'microsoft edge': '🌐', 'steam': '🎮', 'obs': '🎥', 'vlc': '🎬',
        'firefox': '🦊', 'brave': '🦁', 'whatsapp': '💬', 'telegram': '✈️',
        'teams': '👥', 'zoom': '📹', 'epic games': '🎮', 'ea': '🎮',
        'origin': '⬡', 'ubisoft': '🌀', 'powertoys': '⚙️',
        'sonidos del sistema': '🔉', 'system sounds': '🔉',
        'league of legends': '🛡️', 'valorant': '🔥', 'minecraft': '🟩',
        'roblox': '🟥', 'itunes': '🎧', 'opera gx': '🟣', 'opera': '🟥',
        'slack': '💬', 'nvidia': '🟩', 'amd': '🔺', 'visual studio': '🟦',
        'twitch': '🟪', 'youtube': '▶️', 'battle.net': '☁️', 'riot': '🔥',
        'rockstar': '⭐'
    };

    // Category matches
    if (name.includes('qemu') || name.includes('game') || name.includes('juego') || name.includes('emulator')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🎮</span>`;
    if (name.includes('wallpaper')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🖼️</span>`;
    if (name.includes('sunshine') || name.includes('stream')) return `<span class="${shadowClass}" style="font-size:3.2rem;">☀️</span>`;
    if (name.includes('music') || name.includes('audio') || name.includes('player')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🎵</span>`;
    if (name.includes('video') || name.includes('movie') || name.includes('media')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🎬</span>`;
    if (name.includes('web') || name.includes('browser') || name.includes('internet')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🌐</span>`;
    if (name.includes('driver') || name.includes('system') || name.includes('host') || name.includes('update')) return `<span class="${shadowClass}" style="font-size:3.2rem;">⚙️</span>`;

    for (const key in iconEmojiMap) {
        if (name.includes(key)) return `<span class="${shadowClass}" style="font-size:3.2rem;">${iconEmojiMap[key]}</span>`;
    }

    return `<div class="${shadowClass}" style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));">${fallbackSVG}</div>`;
}

export class MixerModule {
    /**
     * @param {Object} ctx — App context
     * @param {Object} ctx.socket
     * @param {import('../core/EventBus.js').EventBus} ctx.events
     * @param {import('../ui/PanelManager.js').PanelManager} ctx.panelManager
     * @param {import('../utils/throttle.js').ThrottleScheduler} ctx.throttle
     */
    constructor(ctx) {
        this.socket = ctx.socket;
        this.events = ctx.events;
        this.panelManager = ctx.panelManager;
        this.throttle = ctx.throttle;
        this.volumeEmitIntervalMs = 30;

        // State
        this.lastMixerState = null;
        this.mixerRefs = {};
        this._renderedMixerState = null;

        // Anti-bounce systems
        this.activeSliders = ctx.activeSliders; // shared Set
        this.activeMutes = ctx.activeMutes;     // shared Set
        this.muteTimers = {};
        this.pendingVolUpdates = {};
        this.lastEmittedVol = {};

        this._faderControllers = [];
    }

    /** Register socket listeners for mixer events */
    setupSocketListeners() {
        this.socket.on('mixer_initial_state', (state) => {
            this.lastMixerState = state;
            if (this.panelManager.getActivePanel() === 'mixer') {
                this.renderInitialMixer();
            }
        });

        this.socket.on('master_updated', (data) => {
            if (this.lastMixerState) {
                if (data.type === 'volume') this.lastMixerState.master.volume = data.value;
                if (data.type === 'mute') this.lastMixerState.master.mute = data.value;
            }
            this.updateSliderUI('global', data);
        });

        this.socket.on('session_updated', (data) => {
            if (this.lastMixerState) {
                const sess = this.lastMixerState.sessions.find(s => s.name === data.name);
                if (sess) {
                    if (data.type === 'volume') sess.volume = data.value;
                    if (data.type === 'mute') sess.mute = data.value;
                }
            }
            this.updateSliderUI(sanitizeId(data.name), data);
        });

        this.socket.on('session_added', (sessionData) => {
            if (this.lastMixerState) {
                const existing = this.lastMixerState.sessions.find(s => s.name === sessionData.name);
                if (!existing) {
                    this.lastMixerState.sessions.push({
                        name: sessionData.name,
                        volume: sessionData.volume,
                        mute: sessionData.mute
                    });
                } else {
                    existing.volume = sessionData.volume;
                    existing.mute = sessionData.mute;
                }
            }

            const appsContainer = document.getElementById('app-mixers');
            if (appsContainer) {
                const sid = sanitizeId(sessionData.name);
                const existingRow = document.getElementById(`mixer-row-${sid}`);
                if (existingRow) {
                    existingRow.classList.remove('fade-out');
                    this.updateSliderUI(sid, { type: 'volume', value: sessionData.volume });
                    this.updateSliderUI(sid, { type: 'mute', value: sessionData.mute });
                } else {
                    appsContainer.appendChild(this.createMixerRow(sessionData));
                    requestAnimationFrame(() => {
                        this.updateSliderUI(sid, { type: 'volume', value: sessionData.volume });
                        this.updateSliderUI(sid, { type: 'mute', value: sessionData.mute });
                    });
                }
            }
        });

        this.socket.on('session_removed', (sessionData) => {
            this._handleSessionRemoved(sessionData.name);
        });

        this.socket.on('mixer_batch', (batch) => {
            if (!this.lastMixerState) return;
            
            if (batch.master) {
                if (batch.master.volume !== undefined) {
                    this.lastMixerState.master.volume = batch.master.volume;
                    this.updateSliderUI('global', { type: 'volume', value: batch.master.volume });
                }
                if (batch.master.mute !== undefined) {
                    this.lastMixerState.master.mute = batch.master.mute;
                    this.updateSliderUI('global', { type: 'mute', value: batch.master.mute });
                }
            }

            if (Array.isArray(batch.removed)) {
                batch.removed.forEach(name => this._handleSessionRemoved(name));
            }

            if (Array.isArray(batch.sessions)) {
                const appsContainer = document.getElementById('app-mixers');
                batch.sessions.forEach(sessionData => {
                    let existing = this.lastMixerState.sessions.find(s => s.name === sessionData.name);
                    if (!existing) {
                        this.lastMixerState.sessions.push({ name: sessionData.name, volume: sessionData.volume, mute: sessionData.mute });
                        if (appsContainer) {
                            const sid = sanitizeId(sessionData.name);
                            if (!document.getElementById(`mixer-row-${sid}`)) {
                                appsContainer.appendChild(this.createMixerRow(sessionData));
                            }
                        }
                    } else {
                        if (sessionData.volume !== undefined) existing.volume = sessionData.volume;
                        if (sessionData.mute !== undefined) existing.mute = sessionData.mute;
                    }

                    const sid = sanitizeId(sessionData.name);
                    const row = document.getElementById(`mixer-row-${sid}`);
                    if (row) row.classList.remove('fade-out');

                    if (sessionData.volume !== undefined) this.updateSliderUI(sid, { type: 'volume', value: sessionData.volume });
                    if (sessionData.mute !== undefined) this.updateSliderUI(sid, { type: 'mute', value: sessionData.mute });
                });
            }
        });
    }

    _handleSessionRemoved(name) {
        if (this.lastMixerState) {
            this.lastMixerState.sessions = this.lastMixerState.sessions.filter(s => s.name !== name);
        }
        const sid = sanitizeId(name);
        const row = document.getElementById(`mixer-row-${sid}`);
        if (row && !row.classList.contains('fade-out')) {
            row.classList.add('fade-out');
            setTimeout(() => { if (row.parentNode) row.remove(); }, 300);
        }
    }

    /** Open the mixer panel */
    open(mixerPanelEl, onBack) {
        this.mainPanelEl = mixerPanelEl;
        mixerPanelEl.className = 'panel-cache-node mixer-fullscreen-view';
        
        // RECREAR SIEMPRE EL DOM BASE. Esto evita problemas de nodos huérfanos
        // al salir y entrar del panel varias veces.
        mixerPanelEl.innerHTML = `
            <div class="mixer-panel mixer-panel-fullscreen" id="mixer-main-container" style="display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: center !important; gap: 26px !important; width: auto !important; min-width: 0 !important; max-width: calc(100vw - 40px) !important; padding: 28px 34px !important; position: absolute !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; border-radius: 40px !important; background: rgba(13, 20, 31, 0.88) !important; backdrop-filter: blur(24px) !important; border: 1px solid rgba(255,255,255,0.12) !important;">
                <div style="color: white; opacity: 0.5;">Cargando mezclador...</div>
            </div>
        `;

        let backBtn = document.getElementById('panel-back-button');
        if (backBtn) backBtn.remove();
        backBtn = createPanelBackButton(() => { if (onBack) onBack(); });
        backBtn.id = 'panel-back-button';
        document.body.appendChild(backBtn);

        this.panelManager.showPanel('mixer');
        this.socket.emit('mixer_initial_state');
        this.socket.emit('mixer_bind_commands');

        if (this.lastMixerState) {
            this.renderInitialMixer();
        }
    }

    /** Render the full mixer state */
    renderInitialMixer() {
        try {
            const container = document.getElementById('mixer-main-container');
            if (!container) {
                console.warn('[Mixer] Contenedor principal no encontrado en renderInitialMixer.');
                return;
            }
            if (!this.lastMixerState) {
                container.innerHTML = '<div style="color: white; opacity: 0.5;">Esperando conexión con el servidor...</div>';
                return;
            }

            const state = this.lastMixerState;
            const sessions = Array.isArray(state.sessions) ? state.sessions : [];
            
            // Limpiar faders anteriores y eventos huérfanos
            if (this._faderControllers) {
                this._faderControllers.forEach(c => { try { c.destroy(); } catch(e) {} });
            }
            this._faderControllers = [];
            this.mixerRefs = {};
            
            // Reconstrucción atómica del DOM interno
            container.replaceChildren();

            // 1. Master Fader (Obligatorio)
            const masterData = state.master || { name: 'Master', volume: 0, mute: false };
            container.appendChild(this.createMixerRow(masterData, true));

            // 2. Separador visual
            const divider = document.createElement('div');
            divider.style.cssText = 'width: 1px; height: 320px; background: rgba(255,255,255,0.15); margin: 0 10px; flex: 0 0 auto;';
            container.appendChild(divider);

            // 3. Contenedor de Aplicaciones
            const appsContainer = document.createElement('div');
            appsContainer.id = 'app-mixers';
            appsContainer.style.cssText = 'display: flex; flex-direction: row; align-items: center; gap: 26px;';
            container.appendChild(appsContainer);

            if (sessions.length > 0) {
                const seen = new Set();
                sessions.forEach(s => {
                    if (!seen.has(s.name)) {
                        appsContainer.appendChild(this.createMixerRow(s));
                        seen.add(s.name);
                    }
                });
            } else {
                const empty = document.createElement('div');
                empty.style.cssText = 'color: white; opacity: 0.3; font-size: 1.2rem; font-style: italic; margin-left: 20px;';
                empty.innerText = 'No hay apps activas';
                appsContainer.appendChild(empty);
            }

            // Animación y ajuste de los Thumbs post-render
            requestAnimationFrame(() => {
                try {
                    Object.keys(this.mixerRefs).forEach(id => {
                        const refs = this.mixerRefs[id];
                        if (!refs) return;
                        const sess = (id === 'global') ? masterData : sessions.find(s => sanitizeId(s.name) === id);
                        if (sess) {
                            setThumbTransform(refs.fill, refs.thumb, sess.volume);
                        }
                    });
                } catch(e) { console.error('[Mixer] Error posicionando thumbs:', e); }
            });

        } catch (error) {
            console.error('[Mixer] Error crítico en renderInitialMixer:', error);
            const container = document.getElementById('mixer-main-container');
            if (container) {
                container.innerHTML = `<div style="color: red;">Error UI: ${error.message}</div>`;
            }
        }
    }

    /** Create a mixer channel row for master or a session */
    createMixerRow(sessionData, isMaster = false) {
        const name = String(sessionData.name || (isMaster ? 'Master' : 'App')).trim();
        const id = isMaster ? 'global' : sanitizeId(name);
        const volume = Number.isFinite(Number(sessionData.volume)) ? Number(sessionData.volume) : 0;
        const isMuted = Boolean(sessionData.mute);

        const row = document.createElement('div');
        row.className = 'mixer-row';
        row.id = `mixer-row-${id}`;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mixer-icon-btn';
        button.dataset.mixerApp = isMaster ? 'master' : name;
        button.dataset.mixerId = id;

        const wrapper = document.createElement('span');
        wrapper.className = `mixer-icon-wrapper${isMuted ? ' mixer-icon-wrapper--muted' : ''}`;
        wrapper.id = isMaster ? 'icon-wrapper-global' : `icon-wrapper-${id}`;
        wrapper.innerHTML = getIconForApp(isMaster ? 'Master' : name, isMaster);
        button.appendChild(wrapper);

        const slider = document.createElement('div');
        slider.className = 'slider-container';
        slider.id = `slider-${id}`;

        const fill = document.createElement('div');
        fill.className = 'slider-fill';
        fill.style.transform = `scale3d(1, ${volume / 100}, 1)`;
        fill.id = `fill-${id}`;

        const thumb = document.createElement('div');
        thumb.className = 'fader-thumb-mixer';
        thumb.id = `thumb-${id}`;

        slider.appendChild(fill);
        slider.appendChild(thumb);

        const label = document.createElement('div');
        label.className = 'mixer-label';
        label.textContent = isMaster ? 'Master' : name;

        row.appendChild(button);
        row.appendChild(slider);
        row.appendChild(label);

        const track = slider;

        if (!button || !wrapper || !track || !fill || !thumb) {
            console.error('[Mixer] No se pudo crear la fila del mixer para', name);
            return row;
        }

        button.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleMute(isMaster ? 'Master' : name, isMaster, id);
        });

        this.mixerRefs[id] = { wrapper, track, fill, thumb, row };

        const faderController = createFaderController({
            track,
            fill,
            thumb,
            onDragStart: () => {
                this.activeSliders.add(id);
                row.classList.add('dragging');
            },
            onValueChange: (_, rounded) => {
                if (isMaster) {
                    this.updateVolumeServer(null, rounded, true, false);
                } else {
                    this.updateVolumeServer(name, rounded, false, false);
                }
            },
            onDragEnd: (finalPercent) => {
                this.activeSliders.delete(id);
                row.classList.remove('dragging');
                if (isMaster) {
                    this.updateVolumeServer(null, finalPercent, true, true);
                } else {
                    this.updateVolumeServer(name, finalPercent, false, true);
                }
            }
        });

        this._faderControllers.push(faderController);
        requestAnimationFrame(() => {
            faderController.setPercent(volume);
        });

        return row;
    }

    /** Incremental update of a single slider */
    updateSliderUI(id, data) {
        const refs = this.mixerRefs[id];
        if (!refs) return;

        queueUpdate(`mixer_${id}_${data.type}`, () => {
            if (data.type === 'volume') {
                if (!this.activeSliders.has(id)) {
                    const h = Number(data.value);
                    let trackH = refs.trackH || (() => {
                        const r = refs.track.getBoundingClientRect();
                        refs.trackH = r.height;
                        return r.height;
                    })();
                    if (trackH === 0) {
                        const dvh = window.innerHeight * 0.4;
                        trackH = Math.max(160, Math.min(300, dvh));
                    }
                    refs.fill.style.transform = `scale3d(1, ${h / 100}, 1)`;
                    setThumbTransform(refs.thumb, h, trackH);
                    this[`last_mixer_${id}`] = h;
                }
            } else if (data.type === 'mute') {
                if (this.activeMutes.has(id)) return;
                const iconContainer = refs.wrapper.closest('.mixer-icon-btn');
                if (data.value) {
                    if (iconContainer) iconContainer.classList.add('muted-active');
                    refs.wrapper.classList.add('mixer-icon-wrapper--muted');
                } else {
                    if (iconContainer) iconContainer.classList.remove('muted-active');
                    refs.wrapper.classList.remove('mixer-icon-wrapper--muted');
                }
            }
        });
    }

    /** Toggle mute with Optimistic UI */
    toggleMute(app, isMaster, domId = null) {
        const id = isMaster ? 'global' : app;
        const domKey = isMaster ? 'global' : (domId || sanitizeId(app));
        const wrapper = document.getElementById(domKey === 'global' ? 'icon-wrapper-global' : `icon-wrapper-${domKey}`) || document.getElementById(`icon-${domKey}`);
        if (!wrapper) return;

        const iconContainer = wrapper.closest('.mixer-icon-btn');
        if (!iconContainer) return;

        const isCurrentlyMuted = iconContainer.classList.contains('muted-active');
        const nextMuteState = !isCurrentlyMuted;

        if (nextMuteState) {
            iconContainer.classList.add('muted-active');
            wrapper.classList.add('mixer-icon-wrapper--muted');
        } else {
            iconContainer.classList.remove('muted-active');
            wrapper.classList.remove('mixer-icon-wrapper--muted');
        }
        iconContainer.classList.remove('pending');

        this.activeMutes.add(domKey);
        if (this.muteTimers[domKey]) clearTimeout(this.muteTimers[domKey]);
        this.muteTimers[domKey] = setTimeout(() => this.activeMutes.delete(domKey), 1500);

        if (isMaster) {
            this.socket.emit('toggle_master_mute');
        } else {
            this.socket.emit('toggle_session_mute', { app });
        }
    }

    /** Send volume to server (throttled) */
    updateVolumeServer(app, value, isMaster, immediate = false) {
        const queueKey = isMaster ? 'mix_master' : `mix_${app}`;
        const roundedValue = Math.round(Number(value));
        if (!Number.isFinite(roundedValue)) return;
        this.pendingVolUpdates[queueKey] = roundedValue;

        const emitVolume = (volume) => {
            if (isMaster) {
                this.socket.volatile.emit('set_master_volume', volume);
            } else {
                this.socket.volatile.emit('set_session_volume', { app, value: volume });
            }
        };

        if (immediate) {
            this.throttle.cancel(queueKey);
            const currentVolume = this.pendingVolUpdates[queueKey];
            if (this.lastEmittedVol[queueKey] === currentVolume) return;
            this.lastEmittedVol[queueKey] = currentVolume;
            emitVolume(currentVolume);
            return;
        }

        this.throttle.schedule(queueKey, () => {
            const valToEmit = this.pendingVolUpdates[queueKey];
            if (this.lastEmittedVol[queueKey] === valToEmit) return;
            this.lastEmittedVol[queueKey] = valToEmit;
            emitVolume(valToEmit);
        }, this.volumeEmitIntervalMs);
    }

    /** Destroy and clean up */
    destroy() {
        this._faderControllers.forEach(c => c.destroy());
        this._faderControllers = [];
    }
}
