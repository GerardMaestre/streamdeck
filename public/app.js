class StreamDeckClient {
    constructor() {
        if (window.streamDeck) return window.streamDeck;
        this.socket = io();
        this.pages = {};
        this.currentPage = 'main';
        
        this.container = document.getElementById('deck-container');
        this.overlay = document.getElementById('overlay');
        this.overlayContainer = document.getElementById('overlay-container');
        
        this.lastMixerState = null;
        
        // --- SISTEMAS DE BLOQUEO ANTI-REBOTE (OPTIMISTIC UI) ---
        this.activeSliders = new Set();
        this.activeMutes = new Set(); 
        this.muteTimers = {};
        
        this.pendingVolUpdates = {};
        this.volUpdateTimes = {};
        this.volUpdateTimers = {};
        this.listenersInitialized = false;

        this.discordMute = false;
        this.discordDeaf = false;
        this.discordUsers = [];
        this.discordConnectionStatus = 'disconnected';
        this.discordConnectionMessage = 'Sin conexión con Discord';

        // IDs de Domótica (Luces)
        this.tuyaDevices = ["bf02a8f057179a10753ram", "bf63d2743895e42709akue", "bf9d385783be51f82cef86"];
        
        // Recuperar última intensidad guardada o usar 100 por defecto
        const savedIntensity = localStorage.getItem('lastTuyaIntensity');
        this.lastTuyaIntensity = savedIntensity ? parseInt(savedIntensity) : 100;

        this.executionModal = document.getElementById('execution-modal');
        this.executionLogs = document.getElementById('execution-logs');
        this.executionSpinner = document.getElementById('execution-spinner');
        this.executionTitle = document.getElementById('execution-title');
        this.executionHideTimeout = null;
        this.wakeLock = null;
        this.volumeEmitIntervalMs = 16;
        this.mixerRefs = {}; // Caché de referencias DOM para el mixer
        this.lastUpdateTime = {}; // Throttle de recepción

        this.init();
    }

    async init() {
        this.setupSocketListeners();
        this.setupDOMListeners();

        try {
            const res = await fetch('/api/config');
            const data = await res.json();
            this.pages = data.pages || {};
            try {
                const scriptsRes = await fetch('/api/scripts');
                if (scriptsRes.ok) {
                    this.scriptsByFolder = await scriptsRes.json();
                } else {
                    this.scriptsByFolder = {};
                }
            } catch (err) {
                this.scriptsByFolder = {};
            }
        } catch (e) {}

        this.initMainGrid();
    }

    initMainGrid() {
        this.renderGrid('main');
    }

    renderGrid(pageId = 'main') {
        this.currentPage = pageId;
        this.container.innerHTML = '';
        this.container.className = 'grid-container'; // Limpiamos clases de vistas especiales

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
    // --- DISCORD PANEL ---
    renderDiscordPanel() {
        this.container.innerHTML = '';
        this.container.className = 'grid-container';

        const fragment = document.createDocumentFragment();
        fragment.appendChild(this.createBackButton(12));

        const title = document.createElement('h2');
        title.className = 'section-title';
        title.textContent = 'Control de Discord';
        fragment.appendChild(title);

        const card = document.createElement('div');
        card.className = 'discord-main-card glass';

        const statusRow = document.createElement('div');
        statusRow.className = 'discord-status-row';
        statusRow.innerHTML = `
            <div class="status-indicator ${this.discordConnectionStatus}"></div>
            <span class="status-text">${this.discordConnectionMessage}</span>
        `;
        card.appendChild(statusRow);

        const controlGrid = document.createElement('div');
        controlGrid.className = 'discord-controls-grid';

        const btnMute = document.createElement('button');
        btnMute.className = `discord-btn glass ${this.discordMute ? 'active' : ''}`;
        btnMute.id = 'discord-btn-mute';
        btnMute.innerHTML = `<span class="d-icon">${this.discordMute ? '🔇' : '🎙️'}</span><span class="d-label">Mute</span>`;
        btnMute.addEventListener('click', () => this.toggleDiscordMute());
        controlGrid.appendChild(btnMute);

        const btnDeaf = document.createElement('button');
        btnDeaf.className = `discord-btn glass ${this.discordDeaf ? 'active' : ''}`;
        btnDeaf.id = 'discord-btn-deaf';
        btnDeaf.innerHTML = `<span class="d-icon">${this.discordDeaf ? '🎧' : '🔊'}</span><span class="d-label">Deafen</span>`;
        btnDeaf.addEventListener('click', () => this.toggleDiscordDeafen());
        controlGrid.appendChild(btnDeaf);

        card.appendChild(controlGrid);

        const usersList = document.createElement('div');
        usersList.className = 'discord-users-list';
        this.discordUsers.forEach(u => {
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            userItem.innerHTML = `
                <img src="${u.avatar}" class="user-avatar" />
                <span class="user-name">${u.name}</span>
                <span class="user-mic ${u.speaking ? 'speaking' : ''}">🎙️</span>
            `;
            usersList.appendChild(userItem);
        });
        card.appendChild(usersList);

        fragment.appendChild(card);
        this.container.appendChild(fragment);
    }

    // --- DOMÓTICA INTEGRADA (STRICT SKETCH MATCH) ---
    renderDomoticaModernView() {
        this.container.innerHTML = '';
        this.container.className = 'grid-container domotica-sketch-match-view';

        // 0. Marco maestro del dibujo
        const masterFrame = document.createElement('div');
        masterFrame.className = 'domotica-master-frame';

        // 1. Cabecera (Botón Volver)
        const header = document.createElement('div');
        header.className = 'domotica-sketch-header';
        
        const backBtn = document.createElement('button');
        backBtn.className = 'back-btn-sketch-circle';
        backBtn.innerHTML = '←'; 
        backBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            // ESCUDO ANTI-PENETRACIÓN TOTAL
            const shield = document.createElement('div');
            shield.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:9999; cursor:default;';
            document.body.appendChild(shield);
            setTimeout(() => shield.remove(), 500);

            // Delay estratégico para que la tablet consuma el evento
            setTimeout(() => {
                this.currentPage = 'main';
                this.renderGrid();
            }, 100);
        });
        header.appendChild(backBtn);
        masterFrame.appendChild(header);

        // 2. Contenedor de División
        const contentArea = document.createElement('div');
        contentArea.className = 'domotica-sketch-content';

        // --- IZQUIERDA: TARJETA SLIDER ---
        const sliderCard = document.createElement('div');
        sliderCard.className = 'domotica-card-fader';
        
        const faderTrack = document.createElement('div');
        faderTrack.className = 'fader-track-pro';

        const faderFill = document.createElement('div');
        faderFill.className = 'fader-fill-pro';
        faderFill.style.height = `${this.lastTuyaIntensity}%`;

        const faderThumb = document.createElement('div');
        faderThumb.className = 'fader-thumb-pro';
        faderThumb.style.bottom = `${this.lastTuyaIntensity}%`;

        faderTrack.appendChild(faderFill);
        faderTrack.appendChild(faderThumb);

        let trackRect = null;
        const updateFader = (e) => {
            if (!trackRect) trackRect = faderTrack.getBoundingClientRect();
            const y = e.clientY - trackRect.top;
            let percent = 100 - (y / trackRect.height) * 100;
            percent = Math.max(1, Math.min(100, Math.round(percent)));
            
            if (percent === this.lastTuyaIntensity) return;
            this.lastTuyaIntensity = percent;
            localStorage.setItem('lastTuyaIntensity', percent);
            
            // Visual instantáneo
            faderFill.style.height = `${percent}%`;
            faderThumb.style.bottom = `${percent}%`;
            
            // Emisión de red diferida pero con valor ACTUAL
            const currentVal = percent; 
            const tuyaVal = Math.round(10 + (currentVal / 100) * 990);
            
            this.scheduleThrottledEmit('tuya_brightness', () => {
                this.socket.emit('tuya_command', {
                    deviceIds: this.tuyaDevices,
                    code: 'bright_value_v2',
                    value: tuyaVal
                });
            }, 350);
        };

        faderTrack.addEventListener('pointerdown', (e) => {
            trackRect = faderTrack.getBoundingClientRect();
            faderTrack.setPointerCapture(e.pointerId);
            updateFader(e);
            faderTrack.addEventListener('pointermove', updateFader);
        });
        faderTrack.addEventListener('pointerup', (e) => {
            faderTrack.releasePointerCapture(e.pointerId);
            faderTrack.removeEventListener('pointermove', updateFader);
        });

        sliderCard.appendChild(faderTrack);
        contentArea.appendChild(sliderCard);

        // --- DERECHA: TARJETA BOTONES ---
        const buttonsCard = document.createElement('div');
        buttonsCard.className = 'domotica-card-buttons';

        const controlGrid = document.createElement('div');
        controlGrid.className = 'domotica-sketch-grid';

        const controls = [
            { label: 'ENCENDER', value: true, action: 'tuya_scene_toggle', icon: '🌟', color: '#2ecc71' },
            { label: 'APAGAR', value: false, action: 'tuya_scene_toggle', icon: '🌑', color: '#e74c3c' },
            { label: 'BLANCO', value: 'white', code: 'work_mode', icon: '⚪', color: '#ecf0f1' },
            { label: 'ESCENA', value: 'scene', code: 'work_mode', icon: '🔮', color: '#9b59b6' }
        ];

        controls.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'domotica-sketch-btn';
            btn.style.setProperty('--btn-accent', c.color);
            btn.innerHTML = `<span class="k-icon">${c.icon}</span><span class="k-label">${c.label}</span>`;
            
            btn.addEventListener('pointerdown', () => {
                if (navigator.vibrate) navigator.vibrate(40);
                const payload = c.action === 'tuya_scene_toggle' 
                    ? { deviceIds: this.tuyaDevices, code: 'switch_led', value: c.value }
                    : { deviceIds: this.tuyaDevices, code: c.code, value: c.value };
                this.socket.emit('tuya_command', payload);
            });

            controlGrid.appendChild(btn);
        });

        buttonsCard.appendChild(controlGrid);
        contentArea.appendChild(buttonsCard);

        masterFrame.appendChild(contentArea);
        this.container.appendChild(masterFrame);
    }

    updateTuyaIntensityServer(value) {
        const tuyaVal = Math.round(10 + (value / 100) * 990);
        
        this.scheduleThrottledEmit('tuya_brightness', () => {
            this.socket.emit('tuya_command', {
                deviceIds: this.tuyaDevices,
                code: 'bright_value_v2',
                value: tuyaVal
            });
        }, 350); 
    }

    getPageData(pageId) {
        let pageData = this.pages[pageId];

        if (Array.isArray(pageData) && pageData.length > 0) {
            const anyWithCarpeta = pageData.find(item => item && item.payload && item.payload.carpeta);
            if (anyWithCarpeta) {
                const carpeta = anyWithCarpeta.payload.carpeta;
                const detected = (this.scriptsByFolder && this.scriptsByFolder[carpeta]) ? this.scriptsByFolder[carpeta].archivos : [];

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
            } else if (btnData.type === 'domotica_panel') {
                this.renderDomoticaModernView();
            } else if (btnData.type === 'action') {
                if (btnData.payload) {
                    this.socket.emit(btnData.action, btnData.payload);
                } else {
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

        this.executionModal.addEventListener('click', (e) => {
            if (e.target === this.executionModal) {
                this.hideExecutionModal(true);
            }
        });

        document.body.addEventListener('click', () => {
            if (!this.wakeLock) this.requestWakeLock();
        }, { once: true });

        document.addEventListener('visibilitychange', () => {
            if (this.wakeLock !== null && document.visibilityState === 'visible') {
                this.requestWakeLock();
            }
        });
        
        window.streamDeck = this;
    }

    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {}
    }

    getIconForApp(appName, isMaster) {
        const shadow = 'filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));';
        
        if (isMaster) return `<span style="font-size:2rem; ${shadow}">🎧</span>`;

        const name = appName.toLowerCase();
        
        const fallbackSVG = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="4" ry="4" fill="rgba(255,255,255,0.03)"></rect><path d="M2 8h20"></path><circle cx="6" cy="5.5" r="1" fill="rgba(255,255,255,0.6)" stroke="none"></circle><circle cx="10" cy="5.5" r="1" fill="rgba(255,255,255,0.6)" stroke="none"></circle></svg>`;
        const fallbackSrc = `data:image/svg+xml;base64,${btoa(fallbackSVG)}`;
        const fallbackHTML = `<img src="${fallbackSrc}" style="width: 34px; height: 34px; ${shadow}" />`;

        const iconMap = {
            'spotify': 'spotify/1DB954',
            'discord': 'discord/5865F2',
            'chrome': 'googlechrome/4285F4',
            'edge': 'microsoftedge/0078D7',
            'steam': 'steam/ffffff',
            'obs': 'obsstudio/FFFFFF',
            'vlc': 'vlcmediaplayer/FF8800',
            'firefox': 'firefox/FF7139',
            'brave': 'brave/FF2000',
            'whatsapp': 'whatsapp/25D366',
            'telegram': 'telegram/26A5E4',
            'teams': 'microsoftteams/6264A7',
            'zoom': 'zoom/2D8CFF',
            'epic games': 'epicgames/FFFFFF',
            'ea': 'ea/FFFFFF',
            'ubisoft': 'ubisoft/FFFFFF',
            'powertoys': 'microsoft/FFFFFF',
            'sonidos del sistema': 'windows11/0078D4',
            'league of legends': 'leagueoflegends/C89B3C',
            'valorant': 'valorant/FF4655',
            'minecraft': 'minecraft/118C4E',
            'roblox': 'roblox/FFFFFF',
            'itunes': 'itunes/FB5EC9',
            'opera gx': 'operagx/FF0000',
            'opera': 'opera/FF1B2D',
            'slack': 'slack/4A154B'
        };

        if (name.includes('qemu') || name.includes('game') || name.includes('juego') || name.includes('emulator')) return `<span style="font-size:2.2rem; ${shadow}">🎮</span>`;
        if (name.includes('wallpaper')) return `<span style="font-size:2.2rem; ${shadow}">🖼️</span>`;
        if (name.includes('sunshine') || name.includes('stream')) return `<span style="font-size:2.2rem; ${shadow}">☀️</span>`;
        if (name.includes('music') || name.includes('audio') || name.includes('player')) return `<span style="font-size:2.2rem; ${shadow}">🎵</span>`;
        if (name.includes('video') || name.includes('movie') || name.includes('media')) return `<span style="font-size:2.2rem; ${shadow}">🎬</span>`;
        if (name.includes('web') || name.includes('browser')) return `<span style="font-size:2.2rem; ${shadow}">🌐</span>`;
        if (name.includes('driver') || name.includes('system') || name.includes('host') || name.includes('update')) return `<span style="font-size:2.2rem; ${shadow}">⚙️</span>`;

        for (const key in iconMap) {
            if (name.includes(key)) {
                return `<img src="https://cdn.simpleicons.org/${iconMap[key]}" style="width: 32px; height: 32px; ${shadow}" onerror="this.onerror=null; this.src='${fallbackSrc}';" />`;
            }
        }

        return fallbackHTML;
    }

    openMixer() {
        this.overlayContainer.innerHTML = '';
        this.overlayContainer.className = 'modal-content-wrapper'; 

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
        
        const iconHTML = this.getIconForApp(labelName, isMaster);
        const opacity = appData.mute ? '0.4' : '1';
        const vol = Number(appData.volume);
        const mutedClass = appData.mute ? ' muted-active' : '';

        const row = document.createElement('div');
        row.className = 'mixer-row';
        row.id = `mixer-row-${id}`;

        row.innerHTML = `
            <div class="mixer-icon-btn${mutedClass}" onpointerup="window.streamDeck.toggleMute('${id}', ${isMaster})">
                <div id="icon-wrapper-${id}" style="opacity:${opacity}; display:flex; justify-content:center; align-items:center; width:100%; height:100%; transition: opacity 0.3s ease;">
                    ${iconHTML}
                </div>
            </div>
            <div class="slider-container" id="track-${id}">
                <div class="slider-fill" id="slider-fill-${id}" style="height: ${vol}%"></div>
                <div class="fader-thumb-mixer" id="thumb-${id}" style="bottom: ${vol}%"></div>
            </div>
            <div class="mixer-label">${labelName}</div>
        `;

        const track = row.querySelector('.slider-container');
        const fill = row.querySelector('.slider-fill');
        const thumb = row.querySelector('.fader-thumb-mixer');
        const wrapper = row.querySelector(`#icon-wrapper-${id}`);

        // CACHÉ LOCAL (Pattern Domótica)
        this.mixerRefs[id] = { track, fill, thumb, wrapper };

        let trackRect = null;
        const updateMix = (e) => {
            if (!trackRect) trackRect = track.getBoundingClientRect();
            
            const y = e.clientY - trackRect.top;
            let percent = 100 - (y / trackRect.height) * 100;
            percent = Math.max(0, Math.min(100, Math.round(percent)));
            
            // 1. Bloqueo de duplicados
            if (percent === this[`last_${id}`]) return;
            this[`last_${id}`] = percent;

            // 2. Visual INSTANTÁNEO (Sin funciones externas)
            fill.style.height = `${percent}%`;
            thumb.style.bottom = `${percent}%`;
            
            // 3. Emisión RED Throttleada (CALCO DE DOMÓTICA - 350ms)
            const queueKey = isMaster ? 'mix_master' : `mix_${id}`;
            this.pendingVolUpdates[queueKey] = percent;

            this.scheduleThrottledEmit(queueKey, () => {
                const valToEmit = Math.round(this.pendingVolUpdates[queueKey]);
                if (isMaster) {
                    this.socket.emit('set_master_volume', valToEmit);
                } else {
                    this.socket.emit('set_session_volume', { app: id, value: valToEmit });
                }
            }, 350); // Mismo throttle que Domótica para no ahogar la tablet
        };

        track.addEventListener('pointerdown', (e) => {
            trackRect = track.getBoundingClientRect();
            track.setPointerCapture(e.pointerId);
            this.markSliderActive(id);
            updateMix(e);
            
            const moveHandler = (m) => updateMix(m);
            const stopHandler = (u) => {
                track.releasePointerCapture(u.pointerId);
                track.removeEventListener('pointermove', moveHandler);
                track.removeEventListener('pointerup', stopHandler);
                this.unmarkSliderActive(id);
                trackRect = null;
            };
            track.addEventListener('pointermove', moveHandler);
            track.addEventListener('pointerup', stopHandler);
        });

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

    markSliderActive(id) { 
        this.activeSliders.add(id); 
    }
    
    unmarkSliderActive(id) { 
        setTimeout(() => {
            this.activeSliders.delete(id);
        }, 500); 
    }

    scheduleThrottledEmit(key, emitFn, intervalMs = this.volumeEmitIntervalMs) {
        if (!this.volUpdateFunctions) this.volUpdateFunctions = {};
        
        // Siempre guardamos la última versión de la función (el último valor)
        this.volUpdateFunctions[key] = emitFn;

        const now = Date.now();
        const last = this.volUpdateTimes[key] || 0;
        const elapsed = now - last;

        const runEmit = () => {
            this.volUpdateTimes[key] = Date.now();
            this.volUpdateTimers[key] = null;
            if (this.volUpdateFunctions[key]) {
                this.volUpdateFunctions[key]();
            }
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
            this.volUpdateTimers[key] = setTimeout(runEmit, Math.max(1, intervalMs - elapsed));
        }
    }

    updateVolumeServer(app, value, isMaster) {
        const id = isMaster ? 'global' : app;
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

    // 🔥 FIX DEFINITIVO PARA EL REBOTE DE MUTE (Optimistic UI)
    toggleMute(app, isMaster) {
        const id = isMaster ? 'global' : app;
        const wrapper = document.getElementById(id === 'global' ? 'icon-wrapper-global' : `icon-wrapper-${id}`) || document.getElementById(`icon-${id}`);
        if (!wrapper) return;

        const iconContainer = wrapper.closest('.mixer-icon-btn');
        if (!iconContainer) return;

        // 1. Asumimos que la acción es instantánea (Optimistic UI)
        const isCurrentlyMuted = iconContainer.classList.contains('muted-active');
        const nextMuteState = !isCurrentlyMuted;

        if (nextMuteState) {
            iconContainer.classList.add('muted-active');
            wrapper.style.opacity = '0.4';
        } else {
            iconContainer.classList.remove('muted-active');
            wrapper.style.opacity = '1';
        }

        // Ya no hace falta la clase "pending" que generaba el parpadeo
        iconContainer.classList.remove('pending');

        // 2. Aplicamos un "Escudo" o Bloqueo por 1.5 segundos
        // Esto ignora las respuestas tardías del servidor que intenten "deshacer" visualmente el click.
        this.activeMutes.add(id);

        if (this.muteTimers[id]) {
            clearTimeout(this.muteTimers[id]);
        }
        this.muteTimers[id] = setTimeout(() => {
            this.activeMutes.delete(id);
        }, 1500);

        // 3. Enviamos la orden real al servidor por debajo
        if (isMaster) {
            this.socket.emit('toggle_master_mute');
        } else {
            this.socket.emit('toggle_session_mute', { app });
        }
    }

    showExecutionModal() {
        clearTimeout(this.executionHideTimeout);
        this.executionModal.classList.remove('hidden');
        this.executionModal.classList.remove('closing');
        if (this.executionLogs) this.executionLogs.innerHTML = '';
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

    setupSocketListeners() {
        if (this.listenersInitialized) return;
        this.listenersInitialized = true;

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
            this.updateSliderUI('global', data);
        });

        this.socket.on('session_updated', (data) => {
            this.updateSliderUI(data.name, data);
        });

        this.socket.on('session_added', (sessionData) => {
            const appsContainer = document.getElementById('app-mixers');
            if (appsContainer) {
                const existingRow = document.getElementById(`mixer-row-${sessionData.name}`);
                if (existingRow) {
                    existingRow.classList.remove('fade-out');
                    this.updateSliderUI(sessionData.name, { type: 'volume', value: sessionData.volume });
                    this.updateSliderUI(sessionData.name, { type: 'mute', value: sessionData.mute });
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
            if (!this.executionLogs) return;
            const text = payload.data || '';
            const lines = text.split('\n');
            lines.forEach(line => {
                const cleanLine = line.trim();
                if (cleanLine.length === 0) return;
                const lastLog = this.executionLogs.lastElementChild;
                if (lastLog && lastLog.textContent === `> ${cleanLine}`) return;

                const div = document.createElement('div');
                div.textContent = `> ${cleanLine}`;
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
        // THROTTLE RECEPTOR (60fps máximo para no saturar la tablet)
        const now = Date.now();
        if (now - (this.lastUpdateTime[id] || 0) < 16) return;
        this.lastUpdateTime[id] = now;

        const refs = this.mixerRefs[id];
        if (!refs) return; 

        if (data.type === 'volume') {
            if (!this.activeSliders.has(id)) {
                const percent = data.value;
                refs.fill.style.height = `${percent}%`;
                refs.thumb.style.bottom = `${percent}%`;
            }
        } else if (data.type === 'mute') {
            if (this.activeMutes.has(id)) return;
            const iconContainer = refs.wrapper.closest('.mixer-icon-btn');
            if (data.value) {
                if (iconContainer) iconContainer.classList.add('muted-active');
                refs.wrapper.style.opacity = '0.4'; 
            } else {
                if (iconContainer) iconContainer.classList.remove('muted-active');
                refs.wrapper.style.opacity = '1'; 
            }
        }
    }

    openDiscordPanel() {
        this.overlayContainer.innerHTML = '';
        this.overlayContainer.className = 'discord-sketch-match-view';

        // 1. HEADER (Status + Close)
        const header = document.createElement('div');
        header.className = 'discord-sketch-header';
        
        const statusPill = document.createElement('div');
        statusPill.id = 'discord-status-pill';
        statusPill.className = 'discord-status-pill';
        statusPill.textContent = this.discordConnectionStatus === 'connected' ? 'CONECTADO' : 'DESCONECTADO';
        
        const backBtn = document.createElement('div');
        backBtn.className = 'discord-back-btn-circle';
        backBtn.innerHTML = '←';
        backBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            // ESCUDO ANTI-PENETRACIÓN TOTAL (Huawei Tablet Fix)
            const shield = document.createElement('div');
            shield.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:9999; cursor:default;';
            document.body.appendChild(shield);
            setTimeout(() => shield.remove(), 500);

            // Feedback visual + Delay para que el evento no traspase
            backBtn.style.background = 'rgba(255,255,255,0.3)';
            setTimeout(() => {
                this.overlay.classList.add('hidden');
                backBtn.style.background = '';
            }, 100);
        });

        header.appendChild(statusPill);
        header.appendChild(backBtn);

        // 2. CONTENT (Split View)
        const contentGrid = document.createElement('div');
        contentGrid.className = 'discord-sketch-content';

        // 2a. Mezclador (Izquierda)
        const mixerPanel = document.createElement('div');
        mixerPanel.className = 'discord-card-mixer';
        mixerPanel.id = 'discord-mixer-container';

        // 2b. Controles Globales (Derecha)
        const controlsPanel = document.createElement('div');
        controlsPanel.className = 'discord-card-tactical';

        const muteBtn = document.createElement('div');
        muteBtn.id = 'tactical-mute-btn';
        muteBtn.className = 'discord-tactical-btn';
        muteBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.toggleDiscordMute();
        });
        muteBtn.innerHTML = `<span class="t-icon">🎙️</span><span class="t-label">MICRO</span>`;

        const deafBtn = document.createElement('div');
        deafBtn.id = 'tactical-deaf-btn';
        deafBtn.className = 'discord-tactical-btn';
        deafBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.toggleDiscordDeaf();
        });
        deafBtn.innerHTML = `<span class="t-icon">🎧</span><span class="t-label">SORDO</span>`;

        controlsPanel.appendChild(muteBtn);
        controlsPanel.appendChild(deafBtn);

        contentGrid.appendChild(mixerPanel);
        contentGrid.appendChild(controlsPanel);

        this.overlayContainer.appendChild(header);
        this.overlayContainer.appendChild(contentGrid);

        this.overlay.classList.remove('hidden');

        this.updateDiscordButtons();
        this.renderDiscordMixer();
    }

    toggleDiscordMute() {
        if (!['connected', 'fallback'].includes(this.discordConnectionStatus)) return;
        if (navigator.vibrate) navigator.vibrate(50);
        
        // Optimistic UI para Discord también
        this.discordMute = !this.discordMute;
        this.updateDiscordButtons();

        this.socket.emit('discord_toggle_mute', (result) => {
            if (result && !result.ok) {
                this.discordMute = !this.discordMute; // revertimos si falla
                this.updateDiscordButtons();
                this.discordConnectionMessage = result?.message || 'No se pudo alternar mute';
                this.updateDiscordConnectionUI();
            }
        });
    }

    toggleDiscordDeaf() {
        if (!['connected', 'fallback'].includes(this.discordConnectionStatus)) return;
        if (navigator.vibrate) navigator.vibrate(50);

        // Optimistic UI para Discord
        this.discordDeaf = !this.discordDeaf;
        this.updateDiscordButtons();

        this.socket.emit('discord_toggle_deaf', (result) => {
            if (result && !result.ok) {
                this.discordDeaf = !this.discordDeaf; // revertimos si falla
                this.updateDiscordButtons();
                this.discordConnectionMessage = result?.message || 'No se pudo alternar ensordecer';
                this.updateDiscordConnectionUI();
            }
        });
    }

    updateDiscordConnectionUI() {
        const statusEl = document.getElementById('discord-connection-status');
        if (!statusEl) return;
        statusEl.className = `discord-status discord-status-${this.discordConnectionStatus}`;
        statusEl.textContent = this.discordConnectionMessage || 'Sin conexión con Discord';
    }

    updateDiscordButtons() {
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

    renderDiscordMixer() {
        const mixerContainer = document.getElementById('discord-mixer-container');
        if (!mixerContainer) return;

        if (this.discordConnectionStatus !== 'connected') {
            const connectMsg = this.discordConnectionStatus === 'fallback' 
                ? 'MODO BÁSICO ACTIVADO' 
                : 'ESPERANDO A DISCORD...';
            const connectIcon = this.discordConnectionStatus === 'fallback' ? '⚠️' : '📡';

            mixerContainer.innerHTML = `
                <div class="discord-empty-state" style="display:flex; flex-direction:column; align-items:center; gap:20px;">
                    <div style="font-size: 6rem; filter: drop-shadow(0 0 10px rgba(255,255,255,0.2));">${connectIcon}</div>
                    <div style="font-size: 1.8rem; font-weight: 900; letter-spacing:3px; opacity:0.8;">${connectMsg}</div>
                </div>`;
            return;
        }

        if (!Array.isArray(this.discordUsers) || this.discordUsers.length === 0) {
            mixerContainer.innerHTML = `
                <div class="discord-empty-state" style="display:flex; flex-direction:column; align-items:center; gap:20px;">
                    <div style="font-size: 6rem; opacity:0.3;">🔇</div>
                    <div style="font-size: 1.8rem; font-weight: 900; letter-spacing:3px; opacity:0.4;">CANAL VACÍO</div>
                </div>`;
            return;
        }

        // --- MOTOR DE RENDIMIENTO DISCORD (Custom Faders) ---
        const existingUsers = Array.from(mixerContainer.querySelectorAll('.user-fader-row'));
        const nextIds = new Set(this.discordUsers.map(u => u.id));

        // 1. Cleanup
        existingUsers.forEach(el => {
            if (!nextIds.has(el.dataset.userId)) {
                el.style.opacity = '0';
                el.style.transform = 'scale(0.8)';
                setTimeout(() => el.remove(), 400);
            }
        });

        // 2. Render/Update
        this.discordUsers.forEach(user => {
            const id = user.id;
            let row = mixerContainer.querySelector(`.user-fader-row[data-user-id="${id}"]`);
            
            if (!row) {
                row = document.createElement('div');
                row.className = 'user-fader-row';
                row.dataset.userId = id;
                
                const avatarHTML = user.avatar 
                    ? `<img src="${user.avatar}">`
                    : `<span>${user.username.charAt(0).toUpperCase()}</span>`;

                const initialVol = Number(user.volume);
                const fillHeight = (initialVol / 200) * 100;

                row.innerHTML = `
                    <div class="user-avatar-circle">${avatarHTML}</div>
                    <div class="slider-container" style="height: 50dvh !important;">
                        <div class="slider-fill" style="height: ${fillHeight}%; background: linear-gradient(to top, #d35400, #f1c40f) !important;"></div>
                        <div class="fader-thumb-mixer" style="bottom: ${fillHeight}%"></div>
                    </div>
                    <div class="discord-username-tag">${user.username}</div>
                `;

                const track = row.querySelector('.slider-container');
                const fill = row.querySelector('.slider-fill');
                const thumb = row.querySelector('.fader-thumb-mixer');

                let trackRect = null;
                const updateDiscordVol = (e) => {
                    if (!trackRect) trackRect = track.getBoundingClientRect();
                    const y = e.clientY - trackRect.top;
                    let percentRaw = 100 - (y / trackRect.height) * 100;
                    percentRaw = Math.max(0, Math.min(100, Math.round(percentRaw)));
                    
                    // 1. Visual
                    fill.style.height = `${percentRaw}%`;
                    thumb.style.bottom = `${percentRaw}%`;

                    // 2. Logic (Discord is 0-200)
                    const discordVol = Math.round(percentRaw * 2); 
                    if (discordVol === this[`last_d_${id}`]) return;
                    this[`last_d_${id}`] = discordVol;

                    // 3. Network (Throttled 350ms)
                    const queueKey = `discord_${id}`;
                    this.pendingVolUpdates[queueKey] = discordVol;

                    this.scheduleThrottledEmit(queueKey, () => {
                        const valToEmit = Math.round(this.pendingVolUpdates[queueKey]);
                        this.socket.emit('discord_set_user_volume', { userId: id, volume: valToEmit });
                    }, 350);
                };

                track.addEventListener('pointerdown', (e) => {
                    trackRect = track.getBoundingClientRect();
                    track.setPointerCapture(e.pointerId);
                    this.markDiscordSliderActive(id);
                    updateDiscordVol(e);
                    
                    const moveH = (m) => updateDiscordVol(m);
                    const stopH = (u) => {
                        track.releasePointerCapture(u.pointerId);
                        track.removeEventListener('pointermove', moveH);
                        track.removeEventListener('pointerup', stopH);
                        this.unmarkDiscordSliderActive(id);
                        trackRect = null;
                    };
                    track.addEventListener('pointermove', moveH);
                    track.addEventListener('pointerup', stopH);
                });

                mixerContainer.appendChild(row);
            } else {
                // Actualización externa si no se está tocando
                if (!this.activeSliders.has('discord_' + id)) {
                    const fill = row.querySelector('.slider-fill');
                    const thumb = row.querySelector('.fader-thumb-mixer');
                    const h = (user.volume / 200) * 100;
                    fill.style.height = `${h}%`;
                    thumb.style.bottom = `${h}%`;
                }
            }
        });
    }

    markDiscordSliderActive(userId) { 
        this.activeSliders.add('discord_' + userId); 
    }
    
    unmarkDiscordSliderActive(userId) { 
        setTimeout(() => {
            this.activeSliders.delete('discord_' + userId);
        }, 500); 
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

const btnFullscreen = document.createElement('div');
btnFullscreen.innerHTML = '🔲';
btnFullscreen.style.cssText = `
    position: fixed; top: 10px; right: 10px; font-size: 24px;
    opacity: 0.3; z-index: 9999; cursor: pointer;
`;
document.body.appendChild(btnFullscreen);

btnFullscreen.addEventListener('click', () => {
    let elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
        btnFullscreen.style.opacity = '0'; 
    }
});

document.addEventListener('DOMContentLoaded', () => {
    new StreamDeckClient();
});