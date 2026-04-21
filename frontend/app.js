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

        this.pendingScriptData = null;
        this.wakeLock = null;
        this.volumeEmitIntervalMs = 350; // Mismo que Domótica para consistency
        this.mixerRefs = {}; // Caché de referencias DOM para el mixer

        // --- CARRUSEL MULTITOUCH ---
        this.carouselPages = []; // Lista de IDs de páginas del carrusel (cargada del config)
        this.carouselIndex = 0;  // Slide activo actualmente
        this._swipeTouches = null; // Estado del gesto en progreso

        // --- MODO EDICIÓN ---
        this.editMode = false;
        this._dragState = null; // Estado del drag en progreso
        this._edgeScrollTimeout = null; // Temporizador para cambio de página en borde

        this.init();
    }

    async init() {
        this.setupSocketListeners();
        this.setupDOMListeners();

        // Solicitar estados iniciales al conectar
        this.socket.emit('mixer_initial_state');
        this.socket.emit('mixer_bind_commands');
        this.socket.emit('discord_initial_state');

        try {
            const res = await fetch('/api/config');
            const data = await res.json();
            this.pages = data.pages || {};
            this.carouselPages = Array.isArray(data.carouselPages) && data.carouselPages.length > 0
                ? data.carouselPages
                : ['main'];
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
        } catch (e) { }

        this.initMainGrid();
        this.setupCarouselSwipe();
        this.renderEditModeButton();
    }

    initMainGrid() {
        if (this.carouselPages && this.carouselPages.length > 0) {
            this.renderCarouselSlide(0, 0);
        } else {
            this.renderGrid('main');
        }
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

        this._setEditButtonVisibility(true);
    }
    // --- DISCORD PANEL ---
    renderDiscordPanel() {
        this.container.innerHTML = '';
        this.container.className = 'grid-container';

        // Botón Volver Premium (Cuerpo del Documento para evitar caché/interferencias)
        const oldBtn = document.getElementById('panel-back-button');
        if (oldBtn) oldBtn.remove();

        const backBtn = document.createElement('button');
        backBtn.id = 'panel-back-button';
        backBtn.className = 'panel-back-btn-sketch-circle';
        backBtn.innerHTML = '<span>←</span>';
        backBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            backBtn.remove();

            const shield = document.createElement('div');
            shield.className = 'pointer-shield';
            document.body.appendChild(shield);
            setTimeout(() => shield.remove(), 500);

            setTimeout(() => {
                this.renderCarouselSlide(this.carouselIndex, 0);
            }, 100);
        });
        document.body.appendChild(backBtn);

        const fragment = document.createDocumentFragment();

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
        this._setEditButtonVisibility(false);
        this.currentPage = 'domotica_panel'; // Bloquea gestos de carrusel
        this.container.innerHTML = '';
        this.container.className = 'grid-container domotica-sketch-match-view';

        // 0. Marco maestro del dibujo
        const masterFrame = document.createElement('div');
        masterFrame.className = 'domotica-master-frame';

        // Botón Volver Premium (Cuerpo del Documento para evitar caché/interferencias)
        const oldBtn = document.getElementById('panel-back-button');
        if (oldBtn) oldBtn.remove();

        const backBtn = document.createElement('button');
        backBtn.id = 'panel-back-button';
        backBtn.className = 'panel-back-btn-sketch-circle';
        backBtn.innerHTML = '<span>←</span>';
        backBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            backBtn.remove();

            const shield = document.createElement('div');
            shield.className = 'pointer-shield';
            document.body.appendChild(shield);
            setTimeout(() => shield.remove(), 500);

            setTimeout(() => {
                this.renderCarouselSlide(this.carouselIndex, 0);
            }, 100);
        });
        document.body.appendChild(backBtn);

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
        faderFill.style.transform = `scaleY(${this.lastTuyaIntensity / 100})`;

        const faderThumb = document.createElement('div');
        faderThumb.className = 'fader-thumb-pro';
        // Inicialización aproximada (se corregirá en el primer movimiento o resize)
        faderThumb.style.transform = `translate(-50%, -${this.lastTuyaIntensity}%)`;

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

            // Visual instantáneo (GPU Accelerado)
            requestAnimationFrame(() => {
                faderFill.style.transform = `scaleY(${percent / 100})`;
                // Usamos 50% para que el centro de la bola coincida con el valor
                faderThumb.style.transform = `translate(-50%, calc(50% - ${(percent / 100) * trackRect.height}px))`;
            });

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

        faderThumb.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            trackRect = faderTrack.getBoundingClientRect();
            faderThumb.setPointerCapture(e.pointerId);
            updateFader(e);
            faderThumb.addEventListener('pointermove', updateFader);
        });

        faderThumb.addEventListener('pointerup', (e) => {
            if (faderThumb.hasPointerCapture && faderThumb.hasPointerCapture(e.pointerId)) {
                faderThumb.releasePointerCapture(e.pointerId);
            }
            faderThumb.removeEventListener('pointermove', updateFader);
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

        // --- FIX DE INICIALIZACIÓN (PREMIUM FLUIDITY) ---
        // Esperamos al siguiente frame para medir el track y posicionar la bola correctamente
        requestAnimationFrame(() => {
            const trackRect = faderTrack.getBoundingClientRect();
            if (trackRect.height > 0) {
                faderThumb.style.transform = `translate(-50%, calc(50% - ${(this.lastTuyaIntensity / 100) * trackRect.height}px))`;
            }
        });
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
        backBtn.classList.add('btn-back-gradient');
        backBtn.style.animationDelay = `${index * 0.05}s`;
        backBtn.innerHTML = '<span class="icon">⬅️</span>Volver';

        backBtn.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(50);
            this.renderCarouselSlide(this.carouselIndex, 0);
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
        if (btnData.color) btn.style.background = btnData.color;
        btn.style.animationDelay = `${index * 0.05}s`;

        btn.innerHTML = `<span class="icon">${btnData.icon}</span>${btnData.label}`;

        // === LÓGICA DE PULSACIÓN LARGA PARA EDITAR ===
        let longPressTimer = null;
        let startPos = null;

        const startTimer = (e) => {
            if (this.editMode) return;
            startPos = { x: e.clientX, y: e.clientY };
            longPressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
                this.enterEditMode();
                // Forzamos el inicio del drag con el evento actual
                this._onEditPointerDown(e);
            }, 600);
        };

        const clearTimer = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        btn.addEventListener('pointerdown', startTimer);
        btn.addEventListener('pointermove', (e) => {
            if (!startPos) return;
            const dist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);
            if (dist > 15) clearTimer(); // Si se mueve mucho, cancelamos la detección de long-press
        });
        btn.addEventListener('pointerup', clearTimer);
        btn.addEventListener('pointercancel', clearTimer);
        btn.addEventListener('pointerleave', clearTimer);

        btn.addEventListener('click', () => {
            // En modo edición, el drag se encarga. No ejecutar acciones.
            if (this.editMode) return;

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
                const isScript = btnData.channel === 'ejecutar_script' || btnData.action === 'ejecutar_script_dinamico';
                if (isScript && btnData.payload && btnData.payload.requiresParams) {
                    // Delegamos al servidor para que pida los parámetros en el PC
                    this.socket.emit(btnData.action, btnData.payload);
                } else {
                    if (btnData.payload) {
                        this.socket.emit(btnData.action, btnData.payload);
                    } else {
                        this.socket.emit(btnData.channel, btnData.action);
                    }
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
        } catch (err) { }
    }

    getIconForApp(appName, isMaster) {
        const shadowClass = 'mixer-icon-shadow';
        
        // Icono Maestro (Premium look, escala 3.2rem para impacto visual)
        if (isMaster) return `<span class="${shadowClass}" style="font-size:3.2rem; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));">🎧</span>`;

        const name = appName.toLowerCase();

        // Fallback Premium SVG (Incrustado directamente para evitar problemas de CSP/DataURI)
        // Usamos comillas dobles para los atributos de forma estándar
        const fallbackSVG = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7;"><rect x="2" y="3" width="20" height="14" rx="3" ry="3"></rect><line x1="2" y1="9" x2="22" y2="9"></line><circle cx="6" cy="6" r="1" fill="white" stroke="none"></circle><circle cx="10" cy="6" r="1" fill="white" stroke="none"></circle></svg>`;

        // Para el atributo onerror del HTML, debemos asegurar que las comillas no rompan el atributo.
        // Escapamos las comillas dobles del SVG para que no cierren el atributo onerror="...".
        const svgForOnerror = fallbackSVG.replace(/"/g, '&quot;');

        const iconMap = {
            'spotify': 'spotify/1DB954',
            'discord': 'discord/5865F2',
            'chrome': 'googlechrome/4285F4',
            'edge': 'microsoftedge/0078D7',
            'microsoft edge': 'microsoftedge/0078D7',
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
            'ea': 'electronicarts/FFFFFF',
            'origin': 'origin/FFFFFF',
            'ubisoft': 'ubisoft/FFFFFF',
            'powertoys': 'microsoft/FFFFFF',
            'sonidos del sistema': 'windows11/0078D4',
            'system sounds': 'windows11/0078D4',
            'league of legends': 'leagueoflegends/C89B3C',
            'valorant': 'valorant/FF4655',
            'minecraft': 'minecraft/118C4E',
            'roblox': 'roblox/FFFFFF',
            'itunes': 'itunes/FB5EC9',
            'opera gx': 'operagx/FF0000',
            'opera': 'opera/FF1B2D',
            'slack': 'slack/4A154B',
            'nvidia': 'nvidia/76B900',
            'amd': 'amd/ED1C24',
            'visual studio': 'visualstudiocode/007ACC',
            'twitch': 'twitch/9146FF',
            'youtube': 'youtube/FF0000',
            'battle.net': 'battlenet/00AEFF',
            'riot': 'riotgames/D32936',
            'rockstar': 'rockstargames/FFFFFF'
        };

        // Categorías por Emojis con tamaño máximo (3.2rem)
        if (name.includes('qemu') || name.includes('game') || name.includes('juego') || name.includes('emulator')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🎮</span>`;
        if (name.includes('wallpaper')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🖼️</span>`;
        if (name.includes('sunshine') || name.includes('stream')) return `<span class="${shadowClass}" style="font-size:3.2rem;">☀️</span>`;
        if (name.includes('music') || name.includes('audio') || name.includes('player')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🎵</span>`;
        if (name.includes('video') || name.includes('movie') || name.includes('media')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🎬</span>`;
        if (name.includes('web') || name.includes('browser') || name.includes('internet')) return `<span class="${shadowClass}" style="font-size:3.2rem;">🌐</span>`;
        if (name.includes('driver') || name.includes('system') || name.includes('host') || name.includes('update')) return `<span class="${shadowClass}" style="font-size:3.2rem;">⚙️</span>`;

        for (const key in iconMap) {
            if (name.includes(key)) {
                // El onerror ahora es seguro al usar &quot; para el SVG y comillas simples para el JS interno del atributo
                return `<img src="https://cdn.simpleicons.org/${iconMap[key]}" class="${shadowClass}" style="width: 48px; height: 48px; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.35));" onerror="this.onerror=null; this.parentElement.innerHTML='${svgForOnerror}';" />`;
            }
        }

        // Si no hay icono en el mapa, devolvemos el SVG incrustado directamente en un wrapper
        return `<div class="${shadowClass}" style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));">${fallbackSVG}</div>`;
    }

    openMixer() {
        this._setEditButtonVisibility(false);
        this.currentPage = 'mixer_panel'; // Bloquea gestos de carrusel
        this.container.innerHTML = '';
        this.container.className = 'mixer-fullscreen-view';

        const mixerPanel = document.createElement('div');
        mixerPanel.className = 'mixer-panel mixer-panel-fullscreen';
        mixerPanel.id = 'mixer-interface';

        mixerPanel.innerHTML = `
            <div id="master-mixer" class="mixer-row master-row"></div>
            <div class="mixer-divider"></div>
            <div id="app-mixers" class="app-mixers-container"></div>
        `;

        // Botón Volver Premium (Cuerpo del Documento para evitar caché/interferencias)
        const oldBtn = document.getElementById('panel-back-button');
        if (oldBtn) oldBtn.remove();

        const backBtn = document.createElement('button');
        backBtn.id = 'panel-back-button';
        backBtn.className = 'panel-back-btn-sketch-circle';
        backBtn.innerHTML = '<span>←</span>';
        backBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            backBtn.remove();

            const shield = document.createElement('div');
            shield.className = 'pointer-shield';
            document.body.appendChild(shield);
            setTimeout(() => shield.remove(), 500);

            setTimeout(() => {
                this.renderCarouselSlide(this.carouselIndex, 0);
            }, 100);
        });
        document.body.appendChild(backBtn);

        this.container.appendChild(mixerPanel);

        // Pedir estado actualizado al servidor cada vez que abrimos el panel
        this.socket.emit('mixer_initial_state');
        this.socket.emit('mixer_bind_commands');

        if (this.lastMixerState) {
            this.renderInitialMixer();
        }
    }

    createMixerRow(appData, isMaster = false) {
        const id = isMaster ? 'global' : appData.name;
        const labelName = isMaster ? 'Master' : appData.name;

        const iconHTML = this.getIconForApp(labelName, isMaster);
        const mutedWrapperClass = appData.mute ? ' mixer-icon-wrapper--muted' : '';
        const vol = Number(appData.volume);
        const mutedClass = appData.mute ? ' muted-active' : '';

        const row = document.createElement('div');
        row.className = 'mixer-row';
        row.id = `mixer-row-${id}`;

        row.innerHTML = `
            <div class="mixer-icon-btn${mutedClass}" onpointerup="window.streamDeck.toggleMute('${id}', ${isMaster})">
                <div id="icon-wrapper-${id}" class="mixer-icon-wrapper${mutedWrapperClass}">
                    ${iconHTML}
                </div>
            </div>
            <div class="slider-container" data-app="${appData.name}">
                <div class="slider-fill" style="transform: scaleY(${vol / 100})"></div>
                <div class="fader-thumb-mixer" style="bottom: ${vol}%"></div>
            </div>
            <div class="mixer-label">${labelName}</div>
        `;

        const container = row.querySelector('.slider-container');
        const fill = container.querySelector('.slider-fill');
        const thumb = container.querySelector('.fader-thumb-mixer');
        const wrapper = row.querySelector('.mixer-icon-wrapper');

        // Guardamos las referencias para actualizaciones en tiempo real
        this.mixerRefs[id] = { fill, thumb, wrapper, track: container };

        fill.style.height = `${vol}%`;
        thumb.style.bottom = `${vol}%`;

        let containerRect = null;

        const updateUI = (e) => {
            if (!containerRect) containerRect = container.getBoundingClientRect();
            let y = e.clientY - containerRect.top;
            let percent = 100 - (y / containerRect.height) * 100;
            percent = Math.max(0, Math.min(100, Math.round(percent)));

            // 1. Visual (SIN LATENCIA)
            fill.style.transform = `scaleY(${percent / 100})`;
            thumb.style.bottom = `${percent}%`;
            this[`last_mixer_${id}`] = percent;

            // 2. Network (Throttled)
            this.pendingVolUpdates[id] = percent;
            this.scheduleThrottledEmit(id, () => {
                const val = Math.round(this.pendingVolUpdates[id]);
                if (isMaster) {
                    this.socket.emit('set_master_volume', val);
                } else {
                    this.socket.emit('set_session_volume', { app: id, value: val });
                }
            }, 100);
        };

        const onPointerDown = (e) => {
            e.preventDefault();
            const row = container.closest('.mixer-row');
            if (row) row.classList.add('dragging'); // Modo Zero Lag
            
            containerRect = container.getBoundingClientRect();
            thumb.setPointerCapture(e.pointerId);
            thumb.addEventListener('pointermove', updateUI);
            updateUI(e);
        };

        thumb.addEventListener('pointerdown', onPointerDown);

        const releaseSlider = (e) => {
            if (thumb.hasPointerCapture && thumb.hasPointerCapture(e.pointerId)) {
                thumb.releasePointerCapture(e.pointerId);
            }
            thumb.removeEventListener('pointermove', updateUI);

            // Grace period: permite que el último update se procese
            setTimeout(() => {
                this.activeSliders.delete(id); // DESBLOQUEA updates después
            }, 150);
            containerRect = null;
        };

        thumb.addEventListener('pointerup', releaseSlider);
        thumb.addEventListener('pointercancel', releaseSlider);

        return row;
    }

    renderInitialMixer() {
        const masterContainer = document.getElementById('master-mixer');
        const appsContainer = document.getElementById('app-mixers');
        if (!masterContainer || !appsContainer || !this.lastMixerState) return;

        this.mixerRefs = {}; // Limpiamos referencias viejas
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

        // --- FIX DE INICIALIZACIÓN MIXER (PREMIUM FLUIDITY) ---
        requestAnimationFrame(() => {
            Object.keys(this.mixerRefs).forEach(id => {
                const refs = this.mixerRefs[id];
                if (!refs) return;
                const trackRect = refs.track.getBoundingClientRect();
                if (trackRect.height > 0) {
                    let vol = 0;
                    if (id === 'global') {
                        vol = this.lastMixerState.master.volume;
                    } else {
                        const sess = this.lastMixerState.sessions.find(s => s.name === id);
                        if (sess) vol = sess.volume;
                    }
                    refs.fill.style.transform = `scaleY(${vol / 100})`;
                    refs.thumb.style.bottom = `${vol}%`;
                }
            });
        });
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
            wrapper.classList.add('mixer-icon-wrapper--muted');
        } else {
            iconContainer.classList.remove('muted-active');
            wrapper.classList.remove('mixer-icon-wrapper--muted');
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

    // Parameter modals are now handled by the PC (Electron) for better keyboard access.

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

        this.socket.on('discord_user_speaking', (data) => {
            const row = document.querySelector(`.user-fader-row[data-user-id="${data.userId}"]`);
            if (row) {
                const avatarCircle = row.querySelector('.user-avatar-circle');
                if (avatarCircle) {
                    avatarCircle.classList.toggle('speaking', !!data.speaking);
                }
            }
        });

        this.socket.on('mixer_initial_state', (state) => {
            this.lastMixerState = state;
            this.renderInitialMixer();
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

        // Removed script_log, script_success, and script_error listeners as execution
        // is now handled via external detached CMD windows.
    }

    updateSliderUI(id, data) {
        const refs = this.mixerRefs[id];
        if (!refs) return;

        if (data.type === 'volume') {
            if (!this.activeSliders.has(id)) {
                const h = Number(data.value);
                refs.fill.style.transform = `scaleY(${h / 100})`;
                refs.thumb.style.bottom = `${h}%`;
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
    }

    openDiscordPanel() {
        this._setEditButtonVisibility(false);
        this.currentPage = 'discord_panel'; // Bloquea gestos de carrusel
        this.overlayContainer.innerHTML = '';
        this.overlayContainer.className = 'discord-sketch-match-view';

        // 1. HEADER (Status + Close)
        const header = document.createElement('div');
        header.className = 'discord-sketch-header';

        const statusPill = document.createElement('div');
        statusPill.id = 'discord-status-pill';
        const isConnected = ['connected', 'fallback'].includes(this.discordConnectionStatus);
        statusPill.className = `discord-status-pill ${isConnected ? 'connected' : 'disconnected'}`;
        statusPill.textContent = isConnected ? 'CONECTADO' : 'DESCONECTADO';

        // Botón Volver Premium (Cuerpo del Documento para evitar caché/interferencias)
        const oldBtn = document.getElementById('panel-back-button');
        if (oldBtn) oldBtn.remove();

        const backBtn = document.createElement('button');
        backBtn.id = 'panel-back-button';
        backBtn.className = 'panel-back-btn-sketch-circle';
        backBtn.innerHTML = '<span>←</span>';
        backBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (backBtn.parentNode) backBtn.remove();
            
            // ESCUDO ANTI-PENETRACIÓN TOTAL (Huawei Tablet Fix)
            const shield = document.createElement('div');
            shield.className = 'pointer-shield';
            document.body.appendChild(shield);
            setTimeout(() => shield.remove(), 500);

            // Feedback visual + Delay para que el evento no traspase
            setTimeout(() => {
                this.overlay.classList.add('hidden');
                this.renderCarouselSlide(this.carouselIndex, 0); // Restaurar carrusel, dots y botón editar
            }, 100);
        });
        document.body.appendChild(backBtn);

        header.appendChild(statusPill);
        // header.appendChild(backBtn); // Ya no se añade al header, sino al overlayContainer directamente

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

        // Pedir estado actualizado de Discord
        this.socket.emit('discord_initial_state');

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
        const statusEl = document.getElementById('discord-status-pill');
        if (!statusEl) return;
        
        const isConnected = ['connected', 'fallback'].includes(this.discordConnectionStatus);
        statusEl.textContent = isConnected ? 'CONECTADO' : 'DESCONECTADO';
        statusEl.className = `discord-status-pill ${isConnected ? 'connected' : 'disconnected'}`;
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
                <div class="discord-empty-state">
                    <div class="discord-empty-icon">${connectIcon}</div>
                    <div class="discord-empty-text">${connectMsg}</div>
                </div>`;
            return;
        }

        if (!Array.isArray(this.discordUsers) || this.discordUsers.length === 0) {
            mixerContainer.innerHTML = `
                <div class="discord-empty-state">
                    <div class="discord-empty-icon discord-empty-icon--dim">🔇</div>
                    <div class="discord-empty-text discord-empty-text--dim">CANAL VACÍO</div>
                </div>`;
            return;
        }

        // 0. Limpiar estado vacío si hay usuarios
        const emptyState = mixerContainer.querySelector('.discord-empty-state');
        if (emptyState) {
            mixerContainer.innerHTML = '';
        }

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
                const isSpeaking = user.speaking ? ' speaking' : '';

                row.innerHTML = `
                    <div class="user-avatar-circle${isSpeaking}">${avatarHTML}</div>
                    <div class="slider-container discord-slider-tall">
                        <div class="slider-fill discord-fill-warm" style="transform: scaleY(${fillHeight / 100})"></div>
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

                    // 1. Visual (SIN LATENCIA)
                    fill.style.transform = `scaleY(${percentRaw / 100})`;
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

                thumb.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    row.classList.add('dragging'); // Inicia modo Zero Lag
                    trackRect = track.getBoundingClientRect();
                    thumb.setPointerCapture(e.pointerId);
                    this.markDiscordSliderActive(id);
                    updateDiscordVol(e);

                    const moveH = (m) => updateDiscordVol(m);
                    const stopH = (u) => {
                        row.classList.remove('dragging'); // Fin modo Zero Lag
                        if (thumb.hasPointerCapture && thumb.hasPointerCapture(u.pointerId)) {
                            thumb.releasePointerCapture(u.pointerId);
                        }
                        thumb.removeEventListener('pointermove', moveH);
                        thumb.removeEventListener('pointerup', stopH);
                        this.unmarkDiscordSliderActive(id);
                        trackRect = null;
                    };
                    thumb.addEventListener('pointermove', moveH);
                    thumb.addEventListener('pointerup', stopH);
                });

                mixerContainer.appendChild(row);
            } else {
                // Actualización externa si no se está tocando
                const avatarCircle = row.querySelector('.user-avatar-circle');
                if (avatarCircle) {
                    avatarCircle.classList.toggle('speaking', !!user.speaking);
                }

                if (!this.activeSliders.has('discord_' + id)) {
                    const fill = row.querySelector('.slider-fill');
                    const thumb = row.querySelector('.fader-thumb-mixer');
                    const h = (user.volume / 200) * 100;
                    fill.style.transform = `scaleY(${h / 100})`;
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

    // ================================================================
    // 🎠 SISTEMA DE CARRUSEL MULTITOUCH
    // ================================================================

    /** Renderiza la slide activa del carrusel en el container principal */
    renderCarouselSlide(index, direction = 0) {
        if (!this.carouselPages || this.carouselPages.length === 0) {
            this.renderGrid('main');
            return;
        }

        this.carouselIndex = Math.max(0, Math.min(index, this.carouselPages.length - 1));
        const pageId = this.carouselPages[this.carouselIndex];
        this.currentPage = pageId;

        // Animación de entrada desde izquierda/derecha
        const slideClass = direction > 0 ? 'slide-enter-right' : direction < 0 ? 'slide-enter-left' : '';

        this.container.innerHTML = '';
        this.container.className = 'grid-container';
        if (slideClass) this.container.classList.add(slideClass);

        const pageData = this.getPageData(pageId);

        pageData.forEach((btnData, i) => {
            this.container.appendChild(this.createButton(btnData, i));
        });

        // Forzar reflow para que la animación funcione
        if (slideClass) {
            void this.container.offsetWidth;
            this.container.classList.remove(slideClass);
            this.container.classList.add('slide-active');
        }

        this.renderCarouselDots();

        this._setEditButtonVisibility(true);

        // Si estamos en modo edición, reactivar drag en los nuevos botones
        if (this.editMode) {
            this._applyEditModeToButtons();
        }
    }

    /** Crea/actualiza el indicador de dots en la parte inferior */
    renderCarouselDots() {
        let dots = document.getElementById('carousel-dots');
        if (!dots) {
            dots = document.createElement('div');
            dots.id = 'carousel-dots';
            document.body.appendChild(dots);
        }

        if (this.carouselPages.length <= 1) {
            dots.style.display = 'none';
            return;
        }

        dots.style.display = 'flex';
        dots.innerHTML = '';
        this.carouselPages.forEach((_, i) => {
            const dot = document.createElement('div');
            dot.className = 'carousel-dot' + (i === this.carouselIndex ? ' active' : '');
            const navigateTo = () => {
                if (this.editMode) return;
                if (i === this.carouselIndex) return;
                const dir = i > this.carouselIndex ? 1 : -1;
                this.renderCarouselSlide(i, dir);
            };
            dot.addEventListener('pointerup', navigateTo);
            dot.addEventListener('click', navigateTo);
            dots.appendChild(dot);
        });
    }

    /** Detecta swipe de 1 o 2 dedos para navegar entre slides */
    setupCarouselSwipe() {
        let t0 = null; // Punto inicial del toque

        this.container.addEventListener('touchstart', (e) => {
            // Ahora permitimos el swipe con un solo dedo (o más)
            if (e.touches.length >= 1) {
                t0 = { 
                    x: e.touches[0].clientX, 
                    y: e.touches[0].clientY 
                };
            }
        }, { passive: true });

        this.container.addEventListener('touchend', (e) => {
            // --- VALIDACIONES DE SEGURIDAD ---
            if (!t0 || this.editMode) return;

            // 1. Bloquear si el overlay está abierto (Discord táctico, etc)
            if (this.overlay && !this.overlay.classList.contains('hidden')) return;

            // 2. Bloquear si estamos en una página que no es del carrusel (Domótica, Mixer, Subcarpetas)
            if (!this.carouselPages || !this.carouselPages.includes(this.currentPage)) return;

            // 3. Bloquear si hay algún slider activo (previniendo saltos mientras se ajusta el volumen)
            if (this.activeSliders && this.activeSliders.size > 0) return;

            // 4. Bloqueo extra por clase de contenedor (Doble seguridad para Mixer/Domótica)
            if (this.container.classList.contains('mixer-fullscreen-view') || 
                this.container.classList.contains('domotica-sketch-match-view')) return;
            
            const changed = e.changedTouches;
            if (changed.length < 1) return;

            const dx = changed[0].clientX - t0.x;
            const dy = changed[0].clientY - t0.y;

            // Threshold: movimiento horizontal > 70px y vertical < 80px para evitar swipes diagonales accidentales
            if (Math.abs(dx) > 70 && Math.abs(dy) < 80) {
                if (dx < 0 && this.carouselIndex < this.carouselPages.length - 1) {
                    // Swipe hacia la izquierda (dedo se mueve a la izquierda) -> Siguiente página
                    if (navigator.vibrate) navigator.vibrate(30);
                    this.renderCarouselSlide(this.carouselIndex + 1, 1);
                } else if (dx > 0 && this.carouselIndex > 0) {
                    // Swipe hacia la derecha (dedo se mueve a la derecha) -> Página anterior
                    if (navigator.vibrate) navigator.vibrate(30);
                    this.renderCarouselSlide(this.carouselIndex - 1, -1);
                }
            }
            t0 = null;
        }, { passive: true });
    }

    // ================================================================
    // ✏️ MODO EDICIÓN (DRAG & DROP)
    // ================================================================

    /** Crea el botón flotante de edición y lo añade al body */
    renderEditModeButton() {
        const existing = document.getElementById('edit-mode-btn');
        if (existing) existing.remove();

        const btn = document.createElement('button');
        btn.id = 'edit-mode-btn';
        btn.innerHTML = '<span class="edit-btn-icon">✏️</span><span class="edit-btn-label">Editar</span>';
        btn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.editMode) {
                this.exitEditMode();
            } else {
                this.enterEditMode();
            }
        });
        document.body.appendChild(btn);
    }

    /** Muestra u oculta el botón de edición y los dots del carrusel */
    _setEditButtonVisibility(visible) {
        const btn = document.getElementById('edit-mode-btn');
        if (btn) btn.style.display = visible ? 'flex' : 'none';

        const dots = document.getElementById('carousel-dots');
        if (dots) {
            // Solo mostramos los dots si hay más de una página
            if (visible && this.carouselPages.length > 1) {
                dots.style.display = 'flex';
            } else {
                dots.style.display = 'none';
            }
        }
    }

    /** Activa el modo edición en la slide actual */
    enterEditMode() {
        if (this.editMode) return;
        // Sólo funciona en páginas del carrusel, no en paneles especiales
        if (!this.carouselPages.includes(this.currentPage)) return;

        this.editMode = true;
        const btn = document.getElementById('edit-mode-btn');
        if (btn) {
            btn.classList.add('active');
            btn.innerHTML = '<span class="edit-btn-icon">✅</span><span class="edit-btn-label">Listo</span>';
        }

        this._applyEditModeToButtons();
    }

    /** Aplica las clases wiggle y los listeners de drag a los botones actuales */
    _applyEditModeToButtons() {
        const buttons = this.container.querySelectorAll('.boton');
        buttons.forEach((btn, i) => {
            btn.classList.add('wiggle');
            btn.dataset.editIndex = i;
            // Usamos { capture: true } para que el modo edición intercepte eventos antes que la acción normal (click)
            btn.addEventListener('pointerdown', this._onEditPointerDown, { capture: true });
        });
    }

    /** Sale del modo edición y guarda el nuevo orden */
    exitEditMode() {
        this.editMode = false;
        const btn = document.getElementById('edit-mode-btn');
        if (btn) {
            btn.classList.remove('active');
            btn.innerHTML = '<span class="edit-btn-icon">✏️</span><span class="edit-btn-label">Editar</span>';
        }

        const buttons = this.container.querySelectorAll('.boton');
        buttons.forEach(b => {
            b.classList.remove('wiggle', 'drag-source');
            b.removeEventListener('pointerdown', this._onEditPointerDown, { capture: true });
        });

        this._saveConfig();
    }

    /** Handler de pointerdown durante el modo edición (debe ser arrow fn para poder desregistrarlo) */
    _onEditPointerDown = (e) => {
        if (!this.editMode) return;
        e.preventDefault();
        e.stopImmediatePropagation();

        const sourceBtn = e.currentTarget;
        const sourceIndex = parseInt(sourceBtn.dataset.editIndex);
        const originPageId = this.currentPage;
        if (isNaN(sourceIndex)) return;

        sourceBtn.classList.add('drag-source');

        // Clonar como ghost visual
        const ghost = sourceBtn.cloneNode(true);
        ghost.id = 'drag-ghost';
        ghost.classList.remove('wiggle', 'drag-source');
        ghost.classList.add('drag-ghost');
        const rect = sourceBtn.getBoundingClientRect();
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        document.body.appendChild(ghost);

        this._dragState = { 
            sourceIndex, 
            sourceBtn, 
            ghost, 
            lastOverIndex: sourceIndex,
            originPageId
        };

        const onMove = (me) => {
            // Mover el ghost
            ghost.style.left = (me.clientX - rect.width / 2) + 'px';
            ghost.style.top = (me.clientY - rect.height / 2) + 'px';

            // --- DETECCIÓN DE BORDES PARA CAMBIO DE PÁGINA ---
            const edgeWidth = 60;
            const canPrev = this.carouselIndex > 0;
            const canNext = this.carouselIndex < this.carouselPages.length - 1;
            
            if (me.clientX < edgeWidth && canPrev) {
                this._startEdgeScroll(-1);
                document.body.classList.add('edge-hover-left');
                document.body.classList.remove('edge-hover-right');
            } else if (me.clientX > window.innerWidth - edgeWidth && canNext) {
                this._startEdgeScroll(1);
                document.body.classList.add('edge-hover-right');
                document.body.classList.remove('edge-hover-left');
            } else {
                this._stopEdgeScroll();
                document.body.classList.remove('edge-hover-left', 'edge-hover-right');
            }

            // Detectar sobre qué botón está el ghost (solo si no estamos cambiando de página)
            ghost.style.pointerEvents = 'none';
            const el = document.elementFromPoint(me.clientX, me.clientY);
            ghost.style.pointerEvents = '';

            const targetBtn = el ? el.closest('.boton') : null;
            const allBtns = [...this.container.querySelectorAll('.boton')];
            allBtns.forEach(b => b.classList.remove('drag-over'));

            if (targetBtn) {
                targetBtn.classList.add('drag-over');
                this._dragState.lastOverIndex = parseInt(targetBtn.dataset.editIndex);
            }
        };

        const onUp = (ue) => {
            this._stopEdgeScroll();
            document.body.classList.remove('edge-hover-left', 'edge-hover-right');

            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);

            ghost.remove();
            sourceBtn.classList.remove('drag-source');

            const targetIndex = this._dragState.lastOverIndex;
            const originPageId = this._dragState.originPageId;
            const targetPageId = this.currentPage;
            
            this._dragState = null;

            // Limpiar drag-over
            this.container.querySelectorAll('.drag-over').forEach(b => b.classList.remove('drag-over'));

            if (targetPageId !== originPageId || targetIndex !== sourceIndex) {
                this._moveOrSwapButton(originPageId, sourceIndex, targetPageId, targetIndex);
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }

    _startEdgeScroll(direction) {
        if (this._edgeScrollTimeout) return;
        this._edgeScrollTimeout = setTimeout(() => {
            if (direction === 1 && this.carouselIndex < this.carouselPages.length - 1) {
                if (navigator.vibrate) navigator.vibrate(40);
                this.renderCarouselSlide(this.carouselIndex + 1, 1);
            } else if (direction === -1 && this.carouselIndex > 0) {
                if (navigator.vibrate) navigator.vibrate(40);
                this.renderCarouselSlide(this.carouselIndex - 1, -1);
            }
            this._edgeScrollTimeout = null;
        }, 750);
    }

    _stopEdgeScroll() {
        if (this._edgeScrollTimeout) {
            clearTimeout(this._edgeScrollTimeout);
            this._edgeScrollTimeout = null;
        }
    }

    /** Mueve un botón de una página/posición a otra y re-renderiza */
    _moveOrSwapButton(originPageId, sourceIndex, targetPageId, targetIndex) {
        const originArr = this.pages[originPageId];
        const targetArr = this.pages[targetPageId];
        if (!originArr || !targetArr) return;

        // Extraer
        const [item] = originArr.splice(sourceIndex, 1);
        
        // Insertar en destino
        targetArr.splice(targetIndex, 0, item);

        if (navigator.vibrate) navigator.vibrate([20, 10, 20]);

        // Re-renderizar slide actual manteniendo editMode
        this.renderCarouselSlide(this.carouselIndex, 0);
    }

    /** Guarda `this.pages` + `this.carouselPages` en el servidor */
    async _saveConfig() {
        try {
            const payload = { carouselPages: this.carouselPages, pages: this.pages };
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
        } catch (err) {
            console.warn('No se pudo guardar config:', err);
        }
    }
}

const btnFullscreen = document.createElement('div');
btnFullscreen.innerHTML = '🔲';
btnFullscreen.className = 'btn-fullscreen';
document.body.appendChild(btnFullscreen);

btnFullscreen.addEventListener('click', () => {
    let elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
        btnFullscreen.classList.add('btn-fullscreen--hidden');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    new StreamDeckClient();
});