/**
 * MixerModule — Full audio mixer panel: render, faders, mute, volume.
 */
import { sanitizeId } from '../utils/dom.js';
import { queueUpdate } from '../utils/dom.js';
import { createFaderController, setThumbTransform } from '../ui/FaderFactory.js';
import { createPanelBackButton } from '../ui/ButtonFactory.js';

/**
 * Returns a high-quality logo or emoji icon for a given app name.
 * Usa iconos directos de CDN (SimpleIcons/cdn.jsdelivr) para apps conocidas,
 * y Google Favicons como fallback para el resto.
 */
function getIconForApp(appName, isMaster) {
    const shadowClass = 'mixer-icon-shadow';
    const iconStyle = 'width: 100px; height: 100px; object-fit: contain; filter: drop-shadow(0 8px 20px rgba(0,0,0,0.6));';

    if (isMaster) return `<span class="${shadowClass}" style="font-size:4rem; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));">🎧</span>`;

    const name = appName.toLowerCase().trim();

    // Determinar emoji de fallback según categoría
    let emoji = '✨';
    if (name.includes('whatsapp') || name.includes('messenger') || name.includes('telegram') || name.includes('discord') || name.includes('chat')) {
        emoji = '💬';
    } else if (name.includes('browser') || name.includes('web') || name.includes('internet') || name.includes('chrome') || name.includes('edge') || name.includes('firefox')) {
        emoji = '🌐';
    } else if (name.includes('music') || name.includes('audio') || name.includes('reproductor') || name.includes('spotify') || name.includes('youtube')) {
        emoji = '🎵';
    } else if (name.includes('game') || name.includes('juego') || name.includes('league') || name.includes('valorant') || name.includes('steam')) {
        emoji = '🎮';
    } else if (name.includes('sistema') || name.includes('system')) {
        emoji = '🔊';
    }

    const fallbackSpan = `<span class="${shadowClass}" style="font-size:3.5rem; display:none;">${emoji}</span>`;
    
    // Iconos directos por CDN — Usamos SimpleIcons con colores de marca exactos
    const cdnIconMap = [
        { key: 'whatsapp',     url: 'https://cdn.simpleicons.org/whatsapp/25D366' },
        { key: 'whatsapp.root', url: 'https://cdn.simpleicons.org/whatsapp/25D366' },
        { key: 'spotify',      url: 'https://cdn.simpleicons.org/spotify/1DB954' },
        { key: 'discord',      url: 'https://cdn.simpleicons.org/discord/5865F2' },
        { key: 'youtube',      url: 'https://cdn.simpleicons.org/youtube/FF0000' },
        { key: 'twitch',       url: 'https://cdn.simpleicons.org/twitch/9146FF' },
        { key: 'google chrome', url: 'https://cdn.simpleicons.org/googlechrome' },
        { key: 'chrome',       url: 'https://cdn.simpleicons.org/googlechrome' },
        { key: 'microsoft edge', url: 'https://cdn.simpleicons.org/microsoftedge/0078D7' },
        { key: 'edge',         url: 'https://cdn.simpleicons.org/microsoftedge/0078D7' },
        { key: 'firefox',      url: 'https://cdn.simpleicons.org/firefoxbrowser/FF7139' },
        { key: 'brave',        url: 'https://cdn.simpleicons.org/brave/FB542B' },
        { key: 'steam',        url: 'https://cdn.simpleicons.org/steam/ffffff' },
        { key: 'obs studio',   url: 'https://cdn.simpleicons.org/obsstudio/302E31' },
        { key: 'vlc',          url: 'https://cdn.simpleicons.org/vlcmediaplayer/FF8800' },
        { key: 'telegram',     url: 'https://cdn.simpleicons.org/telegram/26A5E4' },
        { key: 'league of legends', url: 'https://cdn.simpleicons.org/riotgames/D32936' },
        { key: 'valorant',     url: 'https://cdn.simpleicons.org/valorant/FA4454' },
        { key: 'visual studio code', url: 'https://cdn.simpleicons.org/visualstudiocode/007ACC' },
        { key: 'vs code',      url: 'https://cdn.simpleicons.org/visualstudiocode/007ACC' },
        { key: 'code',         url: 'https://cdn.simpleicons.org/visualstudiocode/007ACC' },
        { key: 'powertoys',    url: 'https://cdn.simpleicons.org/powertoys/ffffff' },
        { key: 'sunshine',     url: 'https://cdn.simpleicons.org/sunshine/FFB300' },
        { key: 'netflix',      url: 'https://cdn.simpleicons.org/netflix/E50914' },
        { key: 'disney+',      url: 'https://cdn.simpleicons.org/disneyplus/ffffff' },
        { key: 'explorador',   url: 'https://www.google.com/s2/favicons?domain=microsoft.com&sz=128' }
    ];

    // Buscar coincidencia exacta o parcial priorizando el orden del array
    for (const item of cdnIconMap) {
        if (name.includes(item.key)) {
            return `<img src="${item.url}" class="${shadowClass}" style="${iconStyle}" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';">${fallbackSpan}`;
        }
    }

    // Fallbacks por categorías con Estética Premium
    if (name.includes('sonidos del sistema') || name.includes('system sounds')) {
        return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 4px 10px rgba(74, 144, 226, 0.5));">🔊</span>`;
    }
    if (name.includes('game') || name.includes('juego') || name.includes('play') || name.includes('roblox') || name.includes('minecraft')) {
        return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 4px 10px rgba(255, 71, 87, 0.5));">🎮</span>`;
    }
    if (name.includes('browser') || name.includes('web') || name.includes('internet') || name.includes('chrome') || name.includes('edge') || name.includes('firefox')) {
        return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 4px 10px rgba(46, 213, 115, 0.5));">🌐</span>`;
    }
    if (name.includes('music') || name.includes('audio') || name.includes('reproductor')) {
        return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 4px 10px rgba(255, 165, 2, 0.5));">🎵</span>`;
    }
    if (name.includes('video') || name.includes('media') || name.includes('movie')) {
        return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 4px 10px rgba(112, 161, 255, 0.5));">🎬</span>`;
    }
    if (name.includes('chat') || name.includes('message') || name.includes('social') || name.includes('whatsapp') || name.includes('telegram')) {
        return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 4px 10px rgba(255, 107, 129, 0.5));">💬</span>`;
    }
    if (name.includes('system') || name.includes('host') || name.includes('update') || name.includes('config')) {
        return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 4px 10px rgba(164, 176, 190, 0.5));">⚙️</span>`;
    }

    // Fallback genérico final (Icono de estrella vibrante)
    return `<span class="${shadowClass}" style="font-size:3.5rem; filter: drop-shadow(0 6px 15px rgba(255, 255, 255, 0.4));">✨</span>`;
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
        this.volumeEmitIntervalMs = 30;

        // State
        this.lastMixerState = null;
        this.mixerRefs = {};
        this._renderedMixerState = null;
        this._volBuffer = {};
        
        // Actualización en tiempo real: usamos un mapa de tiempos para trocear los envíos
        this._lastEmitTimes = {};
        this._minEmitIntervalMs = 30; // ~33 fps para el audio, real-time suave

        // Anti-bounce systems
        this.activeSliders = ctx.activeSliders; // shared Set
        this.activeMutes = ctx.activeMutes;     // shared Set
        this.muteTimers = {};

        this._faderControllers = [];
        this.sessionStateByName = new Map();
        this.rowRefsBySessionId = new Map();
        this._pendingBatchVisualUpdates = new Map();
        this._batchVisualFramePending = false;
        this._lastRenderedSessionIds = [];
        this._boundWindowResize = () => this._handleWindowResize();
    }

    /** Register socket listeners for mixer events */
    setupSocketListeners() {
        this.socket.on('mixer_initial_state', (state) => {
            this.lastMixerState = state;
            this._rebuildSessionStateIndex();
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
            if (this.lastMixerState && data?.name) {
                const sess = this.sessionStateByName.get(data.name);
                if (sess) {
                    if (data.type === 'volume') sess.volume = data.value;
                    if (data.type === 'mute') sess.mute = data.value;
                }
            }
            this.updateSliderUI(sanitizeId(data.name), data);
        });

        this.socket.on('mixer_batch', (batch) => {
            if (!this.lastMixerState) return;
            
            const pendingVisualUpdates = new Map();
            if (batch.master) {
                if (batch.master.volume !== undefined) {
                    this.lastMixerState.master.volume = batch.master.volume;
                    pendingVisualUpdates.set('global', { volume: batch.master.volume });
                }
                if (batch.master.mute !== undefined) {
                    this.lastMixerState.master.mute = batch.master.mute;
                    const prev = pendingVisualUpdates.get('global') || {};
                    pendingVisualUpdates.set('global', { ...prev, mute: batch.master.mute });
                }
            }

            if (Array.isArray(batch.removed)) {
                batch.removed.forEach(name => this._handleSessionRemoved(name));
            }

            if (Array.isArray(batch.sessions)) {
                const appsContainer = document.getElementById('app-mixers');
                batch.sessions.forEach(sessionData => {
                    let existing = this.sessionStateByName.get(sessionData.name);
                    if (!existing) {
                        existing = { name: sessionData.name, volume: sessionData.volume, mute: sessionData.mute };
                        this.lastMixerState.sessions.push(existing);
                        this.sessionStateByName.set(sessionData.name, existing);
                        if (appsContainer) {
                            const sid = sanitizeId(sessionData.name);
                            if (!document.getElementById(`mixer-row-${sid}`)) {
                                appsContainer.appendChild(this.createMixerRow(sessionData));
                                // Posicionar fader inmediatamente tras inserción en el DOM
                                const controller = this._faderControllers[this._faderControllers.length - 1];
                                if (controller) {
                                    requestAnimationFrame(() => controller.setPercent(sessionData.volume, true));
                                }
                            }
                        }
                    } else {
                        if (sessionData.volume !== undefined) existing.volume = sessionData.volume;
                        if (sessionData.mute !== undefined) existing.mute = sessionData.mute;
                    }

                    const sid = sanitizeId(sessionData.name);
                    const row = document.getElementById(`mixer-row-${sid}`);
                    if (row) row.classList.remove('fade-out');

                    const sessionPending = pendingVisualUpdates.get(sid) || {};
                    if (sessionData.volume !== undefined) sessionPending.volume = sessionData.volume;
                    if (sessionData.mute !== undefined) sessionPending.mute = sessionData.mute;
                    if (Object.keys(sessionPending).length > 0) {
                        pendingVisualUpdates.set(sid, sessionPending);
                    }
                });
            }

            this._enqueueBatchVisualUpdates(pendingVisualUpdates);
        });
    }

    _rebuildSessionStateIndex() {
        this.sessionStateByName.clear();
        const sessions = this.lastMixerState?.sessions || [];
        sessions.forEach((session) => {
            if (session?.name) this.sessionStateByName.set(session.name, session);
        });
    }

    _enqueueBatchVisualUpdates(pendingVisualUpdates) {
        pendingVisualUpdates.forEach((update, id) => {
            const prev = this._pendingBatchVisualUpdates.get(id) || {};
            this._pendingBatchVisualUpdates.set(id, { ...prev, ...update });
        });

        if (this._batchVisualFramePending) return;
        this._batchVisualFramePending = true;
        requestAnimationFrame(() => {
            this._batchVisualFramePending = false;
            const updatesToApply = this._pendingBatchVisualUpdates;
            this._pendingBatchVisualUpdates = new Map();
            updatesToApply.forEach((update, id) => {
                if (update.volume !== undefined) this.updateSliderUI(id, { type: 'volume', value: update.volume });
                if (update.mute !== undefined) this.updateSliderUI(id, { type: 'mute', value: update.mute });
            });
        });
    }

    _handleSessionRemoved(name) {
        if (this.lastMixerState) {
            this.lastMixerState.sessions = this.lastMixerState.sessions.filter(s => s.name !== name);
        }
        this.sessionStateByName.delete(name);
        const sid = sanitizeId(name);
        // Limpiar referencias cacheadas para evitar memory leak
        delete this.mixerRefs[sid];
        this.rowRefsBySessionId.delete(sid);
        delete this[`last_mixer_${sid}`];
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
            <div class="mixer-panel mixer-panel-fullscreen" id="mixer-main-container">
                <div class="mixer-loading-state">Cargando mezclador...</div>
            </div>
        `;

        const backBtn = createPanelBackButton(() => { 
            document.body.classList.remove('mixer-low-perf');
            if (onBack) onBack(); 
        });
        document.body.appendChild(backBtn);

        this.panelManager.showPanel('mixer');
        window.addEventListener('resize', this._boundWindowResize);
        // Enable aggressive low-perf mode while mixer is open on touch devices
        try {
            const isTouch = navigator.maxTouchPoints && navigator.maxTouchPoints > 0;
            if (isTouch) document.body.classList.add('mixer-low-perf');
        } catch (e) {}
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
            
            this._rebuildSessionStateIndex();
            container.classList.add('mixer-initializing');

            // 1. Master Fader (Obligatorio)
            const masterData = state.master || { name: 'Master', volume: 0, mute: false };
            let masterRow = document.getElementById('mixer-row-global');
            if (!masterRow) {
                container.replaceChildren();
                masterRow = this.createMixerRow(masterData, true);
                container.appendChild(masterRow);
                const divider = document.createElement('div');
                divider.className = 'mixer-vertical-divider';
                container.appendChild(divider);
                const appsContainer = document.createElement('div');
                appsContainer.id = 'app-mixers';
                appsContainer.className = 'mixer-apps-grid';
                container.appendChild(appsContainer);
            }

            const appsContainer = document.getElementById('app-mixers');
            if (!appsContainer) return;

            const desiredIds = [];
            const desiredSet = new Set();
            if (sessions.length > 0) {
                const seen = new Set();
                sessions.forEach(s => {
                    if (!seen.has(s.name)) {
                        const sid = sanitizeId(s.name);
                        desiredIds.push(sid);
                        desiredSet.add(sid);
                        if (!document.getElementById(`mixer-row-${sid}`)) {
                            const row = this.createMixerRow(s);
                            appsContainer.appendChild(row);
                        }
                        seen.add(s.name);
                    }
                });
                // Remover filas ausentes
                Array.from(appsContainer.querySelectorAll('.mixer-row')).forEach((row) => {
                    const rowId = row.id.replace('mixer-row-', '');
                    if (!desiredSet.has(rowId)) row.remove();
                });
                // Reordenar según estado
                desiredIds.forEach((sid) => {
                    const row = document.getElementById(`mixer-row-${sid}`);
                    if (row) appsContainer.appendChild(row);
                });
            } else {
                appsContainer.replaceChildren();
            }
            this._lastRenderedSessionIds = desiredIds;
            this._settleAndApplyInitialPositions(masterData, sessions, container);

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
        this._appendIconContent(wrapper, isMaster ? 'Master' : name, isMaster);
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

        let startPos = null;
        let isPressing = false;

        button.addEventListener('pointerdown', (e) => {
            startPos = { x: e.clientX, y: e.clientY };
            isPressing = true;
            button.classList.add('pressing');
        });

        button.addEventListener('pointerup', (e) => {
            if (!isPressing) return;
            const dist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);
            isPressing = false;
            button.classList.remove('pressing');

            if (dist < 20) {
                e.preventDefault();
                e.stopPropagation();
                this.toggleMute(isMaster ? 'Master' : name, isMaster, id);
            }
        });

        button.addEventListener('pointercancel', () => {
            isPressing = false;
            button.classList.remove('pressing');
        });

        button.addEventListener('click', (e) => e.preventDefault());

        this.mixerRefs[id] = { wrapper, track, fill, thumb, row };
        this.rowRefsBySessionId.set(id, this.mixerRefs[id]);

        const faderController = createFaderController({
            track,
            fill,
            thumb,
            initialPercent: volume,
            disableSmooth: true,
            onDragStart: () => {
                this.activeSliders.add(id);
                row.classList.add('dragging');
            },
            onValueChange: (_, rounded) => {
                this.updateVolumeServer(isMaster ? null : name, rounded, isMaster, false);
            },
            onDragEnd: (finalPercent) => {
                this.activeSliders.delete(id);
                row.classList.remove('dragging');
                this.updateVolumeServer(isMaster ? null : name, finalPercent, isMaster, true);
            }
        });

        this._faderControllers.push(faderController);
        this.mixerRefs[id].controller = faderController;
        // faderController.setPercent(volume, true); <-- Se llama desde fuera tras el append

        return row;
    }

    _nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    async _settleAndApplyInitialPositions(masterData, sessions, container) {
        await this._nextFrame();
        await this._nextFrame();
        const masterRefs = this.rowRefsBySessionId.get('global');
        if (masterRefs?.controller) masterRefs.controller.setPercent(masterData.volume, true);
        sessions.forEach((s) => {
            const sid = sanitizeId(s.name);
            const refs = this.rowRefsBySessionId.get(sid);
            if (refs?.controller) refs.controller.setPercent(s.volume, true);
        });
        container.classList.remove('mixer-initializing');
    }

    _handleWindowResize() {
        if (this.panelManager.getActivePanel() !== 'mixer') return;
        this.renderInitialMixer();
    }

    _appendIconContent(wrapper, appName, isMaster) {
        const template = document.createElement('template');
        template.innerHTML = getIconForApp(appName, isMaster);
        const fragment = document.createDocumentFragment();
        fragment.appendChild(template.content.cloneNode(true));
        wrapper.replaceChildren(fragment);
    }

    /** Incremental update of a single slider */
    updateSliderUI(id, data) {
        const refs = this.rowRefsBySessionId.get(id) || this.mixerRefs[id];
        if (!refs) return;
        // If the slider is currently being dragged, update DOM immediately
        // to avoid queuing via RAF and improve perceived responsiveness.
        if (data.type === 'volume') {
            if (this.activeSliders.has(id)) {
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
                return;
            }

            // Otherwise, batch updates via RAF for general updates.
            queueUpdate(`mixer_${id}_${data.type}`, () => {
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
            });
        } else if (data.type === 'mute') {
            queueUpdate(`mixer_${id}_mute`, () => {
                if (this.activeMutes.has(id)) return;
                const iconContainer = refs.wrapper.closest('.mixer-icon-btn');
                if (data.value) {
                    if (iconContainer) iconContainer.classList.add('muted-active');
                    refs.wrapper.classList.add('mixer-icon-wrapper--muted');
                } else {
                    if (iconContainer) iconContainer.classList.remove('muted-active');
                    refs.wrapper.classList.remove('mixer-icon-wrapper--muted');
                }
            });
        }
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

    /** Direct real-time emission with timestamp throttling */
    updateVolumeServer(app, value, isMaster, immediate = false) {
        const roundedValue = Math.round(Number(value));
        if (!Number.isFinite(roundedValue)) return;

        const queueKey = isMaster ? 'master' : app;
        const now = Date.now();
        const lastEmit = this._lastEmitTimes[queueKey] || 0;

        if (immediate || (now - lastEmit >= this._minEmitIntervalMs)) {
            this._lastEmitTimes[queueKey] = now;
            if (isMaster) {
                this.socket.emit('set_master_volume', roundedValue);
            } else {
                this.socket.emit('set_session_volume', { app, value: roundedValue });
            }
        }
    }

    /** Destroy and clean up */
    destroy() {
        this._faderControllers.forEach(c => c.destroy());
        this._faderControllers = [];
        window.removeEventListener('resize', this._boundWindowResize);
    }
}
