class StreamDeckClient {
    constructor() {
        this.socket = io();
        this.pages = {};
        this.currentPage = 'main';
        
        // Elementos del DOM
        this.container = document.getElementById('deck-container');
        this.overlay = document.getElementById('overlay');
        this.overlayContainer = document.getElementById('overlay-container');
        
        // Estado del Mezclador
        this.lastMixerState = null;
        this.activeSliders = new Set();
        this.pendingVolUpdates = {};
        this.volUpdateTimes = {};
        this.volUpdateTimers = {};

        // Estado del Discord
        this.discordMute = false;
        this.discordDeaf = false;
        this.discordUsers = [];
        this.discordConnectionStatus = 'disconnected';
        this.discordConnectionMessage = 'Sin conexión con Discord';

        // Elementos del Modal de Ejecución
        this.executionModal = document.getElementById('execution-modal');
        this.executionLogs = document.getElementById('execution-logs');
        this.executionSpinner = document.getElementById('execution-spinner');
        this.executionTitle = document.getElementById('execution-title');
        this.executionHideTimeout = null;
        
        // WakeLock
        this.wakeLock = null;

        // Intervalo de envío para volumen: prioriza respuesta inmediata sin saturar socket
        this.volumeEmitIntervalMs = 16;

        this.init();
    }

    async init() {
        this.setupSocketListeners();
        this.setupDOMListeners();

        // Cargar configuración desde el Backend (Punto 5)
        try {
            const res = await fetch('/api/config');
            const data = await res.json();
            this.pages = data.pages || {};
            // Cargar listado dinámico de scripts para asegurar que todos aparezcan
            try {
                const scriptsRes = await fetch('/api/scripts');
                if (scriptsRes.ok) {
                    this.scriptsByFolder = await scriptsRes.json();
                } else {
                    this.scriptsByFolder = {};
                }
            } catch (err) {
                console.warn('No se pudieron cargar scripts dinámicos', err);
                this.scriptsByFolder = {};
            }
        } catch (e) {
            console.error('Error cargando configuración:', e);
        }

        this.initMainGrid();
    }

    // ==========================================
    // UI GRID Y CARPETAS
    // ==========================================
    initMainGrid() {
        this.renderGrid('main');
    }

    renderGrid(pageId = 'main') {
        this.currentPage = pageId;
        this.container.innerHTML = '';

        const pageData = this.getPageData(pageId);
        const shouldInjectBack = pageId !== 'main';

        if (shouldInjectBack) {
            this.container.appendChild(this.createBackButton(0));
        }

        pageData.forEach((btnData, index) => {
            const visualIndex = shouldInjectBack ? index + 1 : index;
            this.container.appendChild(this.createButton(btnData, visualIndex));
        });
    }

    getPageData(pageId) {
        let pageData = this.pages[pageId];

        // Si la página está vinculada a un folder de scripts (payload.carpeta), intentamos
        // mezclar la configuración estática con los scripts detectados dinámicamente.
        if (Array.isArray(pageData) && pageData.length > 0) {
            const anyWithCarpeta = pageData.find(item => item && item.payload && item.payload.carpeta);
            if (anyWithCarpeta) {
                const carpeta = anyWithCarpeta.payload.carpeta;
                const detected = (this.scriptsByFolder && this.scriptsByFolder[carpeta]) ? this.scriptsByFolder[carpeta].archivos : [];

                // Mantener el orden y botones ya configurados, y anexar archivos faltantes
                const configured = pageData.slice();
                const existingFiles = new Set(configured.filter(i => i.payload && i.payload.archivo).map(i => i.payload.archivo));

                detected.forEach(f => {
                    if (!existingFiles.has(f.archivo)) {
                        configured.push({
                            label: f.label,
                            icon: '⚙️',
                            color: 'linear-gradient(145deg, #2980b9, #3498db)',
                            type: 'action',
                            action: 'ejecutar_script_dinamico',
                            payload: { carpeta, archivo: f.archivo }
                        });
                    }
                });

                pageData = configured;
            }
        }

        // Si no existe configuración y el pageId coincide con el nombre de carpeta, renderizarla directamente
        if ((!pageData || pageData.length === 0) && this.scriptsByFolder && this.scriptsByFolder[pageId]) {
            const carpeta = pageId;
            pageData = this.scriptsByFolder[carpeta].archivos.map(f => ({
                label: f.label,
                icon: '⚙️',
                color: 'linear-gradient(145deg, #2980b9, #3498db)',
                type: 'action',
                action: 'ejecutar_script_dinamico',
                payload: { carpeta, archivo: f.archivo }
            }));
        }

        return Array.isArray(pageData) ? pageData : [];
    }

    createBackButton(index) {
        const backBtn = document.createElement('button');
        backBtn.className = 'boton btn-streamdeck';
        backBtn.style.background = 'linear-gradient(145deg, #2c3e50, #34495e)';
        backBtn.style.animationDelay = `${index * 0.05}s`;
        backBtn.innerHTML = '<span class="icon">⬅️</span>Volver';

        backBtn.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(50);
            this.renderGrid('main');
        });

        return backBtn;
    }

    createPanelBackButton(extraClass = '') {
        const backBtn = document.createElement('button');
        backBtn.className = 'panel-back-btn';
        if (extraClass) backBtn.classList.add(extraClass);
        backBtn.type = 'button';
        backBtn.setAttribute('aria-label', 'Volver');
        backBtn.title = 'Volver';
        backBtn.innerHTML = '<span aria-hidden="true">&#x2190;</span>';

        backBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (navigator.vibrate) navigator.vibrate(30);
            this.closeFolder();
        });

        return backBtn;
    }

    createButton(btnData, index) {
        const btn = document.createElement('button');
        btn.className = 'boton btn-streamdeck';
        btn.style.background = btnData.color || '#333';
        btn.style.animationDelay = `${index * 0.05}s`; 
        
        btn.innerHTML = `<span class="icon">${btnData.icon}</span>${btnData.label}`;

        btn.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(50);

            const isFolderButton = btnData.type === 'folder' || Boolean(btnData.targetPage);

            if (isFolderButton) {
                this.renderGrid(btnData.targetPage || 'main');
            } else if (btnData.type === 'mixer') {
                this.openMixer();
            } else if (btnData.type === 'discord_panel') {
                this.openDiscordPanel();
            } else if (btnData.type === 'action') {
                if (btnData.payload) {
                    // Enviar evento dinámico con payload
                    this.socket.emit(btnData.action, btnData.payload);
                } else {
                    // Eventos tradicionales: channel + action
                    this.socket.emit(btnData.channel, btnData.action);
                }

                if (btnData.channel === 'ejecutar_script' || btnData.action === 'ejecutar_script_dinamico') {
                    this.showExecutionModal();
                }
            }
        });

        return btn;
    }

    openFolder(pageId) {
        this.renderGrid(pageId);
    }

    closeFolder() {
        this.overlay.classList.add('hidden');
        setTimeout(() => {
            if (this.overlay.classList.contains('hidden')) {
                this.overlayContainer.innerHTML = '';
            }
        }, 300);
    }

    setupDOMListeners() {
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.closeFolder();
        });

        // Cierre manual del modal de ejecución al clicar fuera (fondo borroso)
        this.executionModal.addEventListener('click', (e) => {
            if (e.target === this.executionModal) {
                this.hideExecutionModal(true);
            }
        });

        // PWA Wake Lock Logic
        document.body.addEventListener('click', () => {
            if (!this.wakeLock) this.requestWakeLock();
        }, { once: true });

        document.addEventListener('visibilitychange', () => {
            if (this.wakeLock !== null && document.visibilityState === 'visible') {
                this.requestWakeLock();
            }
        });
        
        // Exponer métodos globalmente solo para el uso desde HTML "oninput"/"onclick"
        window.streamDeck = this;
    }

    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {
            console.warn(`WakeLock Error: ${err.message}`);
        }
    }

    // ==========================================
    // MEZCLADOR DE AUDIO
    // ==========================================
    openMixer() {
        this.overlayContainer.innerHTML = '';
        this.overlayContainer.className = 'modal-content-wrapper'; // disable grid

        const mixerPanel = document.createElement('div');
        mixerPanel.className = 'mixer-panel';
        mixerPanel.classList.add('mixer-panel-with-back');
        mixerPanel.id = 'mixer-interface';
        
        mixerPanel.innerHTML = `
            <div id="master-mixer" class="mixer-row master-row"></div>
            <div class="mixer-divider"></div>
            <div id="app-mixers" class="app-mixers-container"></div>
        `;

        mixerPanel.appendChild(this.createPanelBackButton('panel-back-btn-right'));

        this.overlayContainer.appendChild(mixerPanel);
        this.overlay.classList.remove('hidden');
        
        if (this.lastMixerState) {
            this.renderInitialMixer();
        }
    }

    createMixerRow(appData, isMaster = false) {
        const id = isMaster ? 'global' : appData.name;
        const labelName = isMaster ? 'Master' : appData.name;
        
        let iconStr = '🔊';
        if(isMaster) iconStr = '🎧';
        else if(labelName.toLowerCase().includes('discord')) iconStr = '💬';
        else if(labelName.toLowerCase().includes('spotify')) iconStr = '🎵';
        else if(labelName.toLowerCase().includes('chrome') || labelName.toLowerCase().includes('msedge')) iconStr = '🌐';
        else if(labelName.toLowerCase().includes('steam') || labelName.toLowerCase().includes('game')) iconStr = '🎮';

        const originalIcon = appData.mute ? '🔇' : iconStr;
        const opacity = appData.mute ? '0.5' : '1';
        const initialFillScale = Math.max(0, Math.min(1, Number(appData.volume) / 100));
        const initialFillEmptyClass = initialFillScale <= 0.001 ? ' fill-empty' : '';

        const row = document.createElement('div');
        row.className = 'mixer-row';
        row.id = `mixer-row-${id}`;
        row.dataset.originalIcon = iconStr;

        row.innerHTML = `
            <div class="mixer-icon-btn" onclick="window.streamDeck.toggleMute('${id}', ${isMaster})">
                <span class="mixer-icon" id="icon-${id}" style="opacity:${opacity}">${originalIcon}</span>
            </div>
            <div class="slider-container">
                <input type="range" class="mixer-slider ${isMaster?'master-slider':''}" id="slider-${id}" 
                    min="0" max="100" value="${appData.volume}" 
                    onpointerdown="window.streamDeck.markSliderActive('${id}')"
                    onpointerup="window.streamDeck.unmarkSliderActive('${id}')"
                    onpointercancel="window.streamDeck.unmarkSliderActive('${id}')"
                    oninput="window.streamDeck.updateVolumeServer('${id}', this.value, ${isMaster})" >
                <div class="slider-fill${initialFillEmptyClass}" id="slider-fill-${id}" style="height: ${(initialFillScale*100).toFixed(2)}%"></div>
            </div>
            <div class="mixer-label">${labelName}</div>
        `;
        return row;
    }

    renderInitialMixer() {
        const masterContainer = document.getElementById('master-mixer');
        const appsContainer = document.getElementById('app-mixers');
        if (!masterContainer || !appsContainer || !this.lastMixerState) return;

        masterContainer.innerHTML = '';
        appsContainer.innerHTML = '';

        masterContainer.appendChild(this.createMixerRow(this.lastMixerState.master, true));

        const renderizadas = new Set();
        this.lastMixerState.sessions.forEach(session => {
            if (!renderizadas.has(session.name)) {
                appsContainer.appendChild(this.createMixerRow(session));
                renderizadas.add(session.name);
            }
        });
    }

    // LLamados desde HTML (a través de window.streamDeck)
    markSliderActive(id) {
        this.activeSliders.add(id);
    }

    unmarkSliderActive(id) {
        this.activeSliders.delete(id);
    }

    scheduleThrottledEmit(key, emitFn, intervalMs = this.volumeEmitIntervalMs) {
        const now = Date.now();
        const last = this.volUpdateTimes[key] || 0;
        const elapsed = now - last;

        const runEmit = () => {
            this.volUpdateTimes[key] = Date.now();
            this.volUpdateTimers[key] = null;
            emitFn();
        };

        if (elapsed >= intervalMs) {
            if (this.volUpdateTimers[key]) {
                clearTimeout(this.volUpdateTimers[key]);
                this.volUpdateTimers[key] = null;
            }
            runEmit();
            return;
        }

        if (!this.volUpdateTimers[key]) {
            this.volUpdateTimers[key] = setTimeout(runEmit, Math.max(0, intervalMs - elapsed));
        }
    }

    updateVolumeServer(app, value, isMaster) {
        const id = isMaster ? 'global' : app;
        const fill = document.getElementById(`slider-fill-${id}`);
        this.setSliderFillScale(fill, value / 100);

        const queueKey = isMaster ? 'mix_master' : `mix_${app}`;
        this.pendingVolUpdates[queueKey] = Number(value);

        this.scheduleThrottledEmit(queueKey, () => {
            const valToEmit = Math.round(this.pendingVolUpdates[queueKey]);
            if (isMaster) {
                this.socket.emit('set_master_volume', valToEmit);
            } else {
                this.socket.emit('set_session_volume', { app, value: valToEmit });
            }
        });
    }

    setSliderFillScale(fillElement, scaleValue) {
        if (!fillElement) return;

        const numeric = Number(scaleValue);
        const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
        fillElement.style.height = `${(clamped * 100).toFixed(2)}%`;
        fillElement.classList.toggle('fill-empty', clamped <= 0.001);
    }

    toggleMute(app, isMaster) {
        const id = isMaster ? 'global' : app;
        const slider = document.getElementById(`slider-${id}`);
        if (!slider) return;

        const iconBtn = document.getElementById(`icon-${id}`);
        const isCurrentlyMuted = iconBtn.textContent === '🔇';
        
        if (isMaster) {
            this.socket.emit('toggle_master_mute', !isCurrentlyMuted);
        } else {
            this.socket.emit('toggle_session_mute', { app, isMuted: !isCurrentlyMuted });
        }
    }

    // ==========================================
    // MODAL EJECUCIÓN (Dynamic Island)
    // ==========================================
    showExecutionModal() {
        clearTimeout(this.executionHideTimeout);
        this.executionModal.classList.remove('hidden');
        this.executionModal.classList.remove('closing');
        this.executionLogs.innerHTML = '';
        this.executionSpinner.textContent = '⚙️';
        this.executionSpinner.classList.remove('success');
        this.executionSpinner.style.animation = 'rotate 1.5s linear infinite';
        this.executionTitle.textContent = 'Ejecutando...';
    }

    hideExecutionModal(immediate = false) {
        clearTimeout(this.executionHideTimeout);
        if (immediate) {
            this.executionModal.classList.add('hidden');
            this.executionModal.classList.remove('closing');
            this.executionLogs.innerHTML = '';
            this.executionSpinner.textContent = '⚙️';
            return;
        }
        this.executionModal.classList.add('closing');
        setTimeout(() => {
            this.executionModal.classList.add('hidden');
            this.executionModal.classList.remove('closing');
            this.executionLogs.innerHTML = '';
            this.executionSpinner.textContent = '⚙️';
        }, 560);
    }

    // ==========================================
    // SOCKET LISTENERS
    // ==========================================
    setupSocketListeners() {
        this.socket.on('discord_connection_state', (state) => {
            this.discordConnectionStatus = state?.status || 'disconnected';
            this.discordConnectionMessage = state?.message || 'Sin conexión con Discord';
            this.updateDiscordConnectionUI();
            this.updateDiscordButtons();
            this.renderDiscordMixer();
        });

        this.socket.on('discord_voice_settings', (settings) => {
            this.discordMute = settings.mute;
            this.discordDeaf = settings.deaf;
            this.updateDiscordButtons();
        });

        this.socket.on('discord_voice_users', (users) => {
            this.discordUsers = users;
            this.renderDiscordMixer();
        });

        this.socket.on('mixer_initial_state', (state) => {
            this.lastMixerState = state;
            this.renderInitialMixer();
        });

        this.socket.on('master_updated', (data) => {
            const id = 'global';
            this.updateSliderUI(id, data);
        });

        this.socket.on('session_updated', (data) => {
            const id = data.name;
            this.updateSliderUI(id, data);
        });

        this.socket.on('session_added', (sessionData) => {
            const appsContainer = document.getElementById('app-mixers');
            if (appsContainer) {
                const existingRow = document.getElementById(`mixer-row-${sessionData.name}`);
                if (existingRow) {
                    existingRow.classList.remove('fade-out');
                } else {
                    appsContainer.appendChild(this.createMixerRow(sessionData));
                }
            }
        });

        this.socket.on('session_removed', (sessionData) => {
            const row = document.getElementById(`mixer-row-${sessionData.name}`);
            if (row && !row.classList.contains('fade-out')) {
                row.classList.add('fade-out');
                setTimeout(() => {
                    if (row.parentNode) row.remove();
                }, 300);
            }
        });

        this.socket.on('script_log', (payload) => {
            const text = payload.data || '';
            const lines = text.split('\n');
            lines.forEach(line => {
                if (line.trim().length === 0) return;
                const div = document.createElement('div');
                div.textContent = `> ${line.trim()}`;
                this.executionLogs.appendChild(div);
            });
            this.executionLogs.scrollTo({ top: this.executionLogs.scrollHeight, behavior: 'smooth' });
        });
        this.socket.on('script_success', () => {
            clearTimeout(this.executionHideTimeout);
            this.executionSpinner.style.animation = '';
            this.executionSpinner.classList.add('success');
            this.executionSpinner.textContent = '✅';
            this.executionTitle.textContent = '¡Completado!';
            this.executionLogs.scrollTo({ top: this.executionLogs.scrollHeight, behavior: 'smooth' });

            this.executionHideTimeout = setTimeout(() => {
                this.hideExecutionModal();
            }, 2500);
        });

        this.socket.on('script_error', (err) => {
            clearTimeout(this.executionHideTimeout);
            this.executionSpinner.style.animation = '';
            this.executionSpinner.classList.remove('success');
            this.executionSpinner.textContent = '❌';
            this.executionTitle.textContent = '¡Error!';
            if (err && (err.message || err.code)) {
                const div = document.createElement('div');
                div.style.color = 'red';
                div.textContent = err.message ? err.message : `Código ${err.code}`;
                this.executionLogs.appendChild(div);
            } else {
                this.executionLogs.innerHTML += '<div style="color: red;">[Script terminó con error]</div>';
            }
            this.executionLogs.scrollTo({ top: this.executionLogs.scrollHeight, behavior: 'smooth' });

            this.executionHideTimeout = setTimeout(() => {
                this.hideExecutionModal();
            }, 2500);
        });
    }

    updateSliderUI(id, data) {
        const slider = document.getElementById(`slider-${id}`);
        const iconBtn = document.getElementById(`icon-${id}`);
        const fill = document.getElementById(`slider-fill-${id}`);
        
        if (slider && data.type === 'volume' && !this.activeSliders.has(id)) {
            slider.value = data.value;
            this.setSliderFillScale(fill, data.value / 100);
        } else if (iconBtn && data.type === 'mute') {
            const row = document.getElementById(`mixer-row-${id}`);
            if(!row) return;
            const iconStr = row.dataset.originalIcon;
            iconBtn.textContent = data.value ? '🔇' : iconStr;
            iconBtn.style.opacity = data.value ? '0.5' : '1';
        }
    }

    // ==========================================
    // DISCORD RPC PANEL
    // ==========================================
    openDiscordPanel() {
        this.overlayContainer.innerHTML = '';
        this.overlayContainer.className = 'modal-content-wrapper'; // disable grid

        const discordPanel = document.createElement('div');
        discordPanel.className = 'discord-panel';
        discordPanel.id = 'discord-panel-container';
        
        discordPanel.innerHTML = `
            <div id="discord-connection-status" class="discord-status discord-status-${this.discordConnectionStatus}">
                ${this.discordConnectionMessage}
            </div>
            <div class="discord-main-layout">
                <div id="discord-call-mixer"></div>
                <div class="discord-controls discord-controls-right">
                    <div id="discord-mute-btn" class="discord-btn" onclick="window.streamDeck.toggleDiscordMute()">
                        <span class="d-icon">🎤</span>
                        <span>Micro</span>
                    </div>
                    <div id="discord-deaf-btn" class="discord-btn" onclick="window.streamDeck.toggleDiscordDeaf()">
                        <span class="d-icon">🎧</span>
                        <span>Cascos</span>
                    </div>
                </div>
            </div>
        `;

        discordPanel.appendChild(this.createPanelBackButton());

        this.overlayContainer.appendChild(discordPanel);
        this.overlay.classList.remove('hidden');

        this.updateDiscordConnectionUI();
        this.updateDiscordButtons();
        this.renderDiscordMixer();
    }

    toggleDiscordMute() {
        if (!['connected', 'fallback'].includes(this.discordConnectionStatus)) return;
        if (navigator.vibrate) navigator.vibrate(50);

        this.socket.emit('discord_toggle_mute', (result) => {
            if (result?.ok) return;
            this.discordConnectionMessage = result?.message || 'No se pudo alternar mute';
            this.updateDiscordConnectionUI();
        });
    }

    toggleDiscordDeaf() {
        if (!['connected', 'fallback'].includes(this.discordConnectionStatus)) return;
        if (navigator.vibrate) navigator.vibrate(50);

        this.socket.emit('discord_toggle_deaf', (result) => {
            if (result?.ok) return;
            this.discordConnectionMessage = result?.message || 'No se pudo alternar ensordecer';
            this.updateDiscordConnectionUI();
        });
    }

    updateDiscordConnectionUI() {
        const statusEl = document.getElementById('discord-connection-status');
        if (!statusEl) return;

        statusEl.className = `discord-status discord-status-${this.discordConnectionStatus}`;
        statusEl.textContent = this.discordConnectionMessage || 'Sin conexión con Discord';
    }

    updateDiscordButtons() {
        const muteBtn = document.getElementById('discord-mute-btn');
        const deafBtn = document.getElementById('discord-deaf-btn');
        const controlsEnabled = ['connected', 'fallback'].includes(this.discordConnectionStatus);

        if (muteBtn) {
            muteBtn.className = `discord-btn ${this.discordMute ? 'muted' : ''} ${controlsEnabled ? '' : 'disabled'}`;
            muteBtn.innerHTML = `<span class="d-icon">🎤</span><span>${this.discordMute ? 'Muteado' : 'Micro'}</span>`;
        }

        if (deafBtn) {
            deafBtn.className = `discord-btn ${this.discordDeaf ? 'deafened' : ''} ${controlsEnabled ? '' : 'disabled'}`;
            deafBtn.innerHTML = `<span class="d-icon">🎧</span><span>${this.discordDeaf ? 'Sordo' : 'Cascos'}</span>`;
        }
    }

    renderDiscordMixer() {
        const mixerContainer = document.getElementById('discord-call-mixer');
        if (!mixerContainer) return;

        if (this.discordConnectionStatus === 'fallback') {
            mixerContainer.innerHTML = '<div class="discord-empty">Modo básico: mute/deaf funciona, pero el mixer de usuarios necesita OAuth válido.</div>';
            return;
        }

        if (this.discordConnectionStatus !== 'connected') {
            mixerContainer.innerHTML = '<div class="discord-empty">Conecta Discord para ver usuarios de la llamada.</div>';
            return;
        }

        if (!Array.isArray(this.discordUsers) || this.discordUsers.length === 0) {
            mixerContainer.innerHTML = '<div class="discord-empty">No hay usuarios detectados en el canal de voz.</div>';
            return;
        }

        const existingCards = Array.from(mixerContainer.querySelectorAll('.discord-user-card'));
        const existingIds = new Set(existingCards.map((el) => el.dataset.userId));
        const nextIds = new Set(this.discordUsers.map((user) => user.id));

        existingCards.forEach((el) => {
            if (!nextIds.has(el.dataset.userId)) {
                el.classList.add('leaving');
                setTimeout(() => {
                    if (el.parentNode) el.remove();
                }, 400);
            }
        });

        this.discordUsers.forEach((user) => {
            if (!existingIds.has(user.id)) {
                const card = document.createElement('div');
                card.className = 'discord-user-card';
                card.dataset.userId = user.id;
                const userFillScale = Math.max(0, Math.min(1, Number(user.volume) / 200));
                const userFillEmptyClass = userFillScale <= 0.001 ? ' fill-empty' : '';

                const avatarHTML = user.avatar 
                    ? `<img src="${user.avatar}" class="discord-avatar">`
                    : `<div class="discord-avatar">${user.username.charAt(0).toUpperCase()}</div>`;

                card.innerHTML = `
                    ${avatarHTML}
                    <div class="slider-container">
                        <input type="range" class="mixer-slider" id="discord-slider-${user.id}" 
                            min="0" max="200" value="${user.volume}" 
                            onpointerdown="window.streamDeck.markDiscordSliderActive('${user.id}')"
                            onpointercancel="window.streamDeck.unmarkDiscordSliderActive('${user.id}')"
                            onpointerup="window.streamDeck.unmarkDiscordSliderActive('${user.id}')"
                            oninput="window.streamDeck.updateDiscordVolumeServer('${user.id}', this.value)" >
                        <div class="slider-fill discord-slider-fill${userFillEmptyClass}" id="discord-slider-fill-${user.id}" style="height: ${(userFillScale*100).toFixed(2)}%"></div>
                    </div>
                    <div class="discord-username">${user.username}</div>
                `;

                mixerContainer.appendChild(card);
            } else {
                if (!this.activeSliders.has('discord_' + user.id)) {
                    const slider = document.getElementById(`discord-slider-${user.id}`);
                    const fill = document.getElementById(`discord-slider-fill-${user.id}`);
                    if (slider) slider.value = user.volume;
                    this.setSliderFillScale(fill, user.volume / 200);
                }
            }
        });
    }

    markDiscordSliderActive(userId) {
        this.activeSliders.add('discord_' + userId);
    }

    unmarkDiscordSliderActive(userId) {
        this.activeSliders.delete('discord_' + userId);
        setTimeout(() => this.activeSliders.delete('discord_' + userId), 120); 
    }

    updateDiscordVolumeServer(userId, value) {
        if (this.discordConnectionStatus !== 'connected') return;

        const fill = document.getElementById(`discord-slider-fill-${userId}`);
        this.setSliderFillScale(fill, value / 200);

        const queueKey = `discord_${userId}`;
        this.pendingVolUpdates[queueKey] = Number(value);

        this.scheduleThrottledEmit(queueKey, () => {
            const currentVolume = Math.round(this.pendingVolUpdates[queueKey]);
            this.socket.emit('discord_set_user_volume', { userId, volume: currentVolume }, (result) => {
                if (result?.ok) return;
                this.discordConnectionMessage = result?.message || 'No se pudo cambiar el volumen';
                this.updateDiscordConnectionUI();
            });
        });
    }
}


// 1. Crear el botón invisible en la esquina
const btnFullscreen = document.createElement('div');
btnFullscreen.innerHTML = '🔲';
btnFullscreen.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    font-size: 24px;
    opacity: 0.3;
    z-index: 9999;
    cursor: pointer;
`;
document.body.appendChild(btnFullscreen);

// 2. Darle la orden de expandirse al tocarlo
btnFullscreen.addEventListener('click', () => {
    let elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) { /* Safari / Older Chrome */
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) { /* IE11 */
            elem.msRequestFullscreen();
        }
        btnFullscreen.style.opacity = '0'; // Ocultamos el botón cuando ya esté grande
    }
});




// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', () => {
    new StreamDeckClient();
});

