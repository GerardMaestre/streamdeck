class PerfMonitor {
    constructor() {
        this.fps = 0;
        this.frames = 0;
        this.lastTime = performance.now();
        this.el = document.createElement('div');
        this.el.id = 'perf-monitor';
        this.el.innerHTML = `
            <span id="perf-fps">FPS: 0</span>
            <span id="perf-render">Render: 0ms</span>
            <span id="perf-ram" style="color: #f39c12">RAM: --</span>
            <span id="perf-cpu" style="color: #3498db">CPU: --</span>
            <span id="perf-ping" style="color: #e74c3c">Ping: --</span>
        `;
        /*
        document.body.appendChild(this.el);
        this.update();
        */

        
        // Ping testing
        this.lastPing = 0;
    }

    update() {
        // No-op
    }



    markRender(ms) {
        // document.getElementById('perf-render').textContent = `Render: ${ms.toFixed(1)}ms`;
    }


    updateServerStats(data) {
        // No-op
    }



    updatePing(ms) {
        // document.getElementById('perf-ping').textContent = `Ping: ${ms}ms`;
    }

}

class StreamDeckClient {
    constructor() {
        if (window.streamDeck) return window.streamDeck;
        
        window.addEventListener('error', (e) => {
            console.error('GLOBAL FRONTEND ERROR:', e.message);
            document.body.innerHTML += `<div style="position:fixed;top:0;left:0;z-index:9999;background:red;color:white;padding:10px;">${e.message}</div>`;
        });
        
        // Recuperar token de seguridad de localStorage
        this.securityToken = localStorage.getItem('streamdeck_token') || '';
        
        // Inicializar socket con autenticación
        this.socket = io({
            auth: {
                token: this.securityToken
            }
        });
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
        this.lastEmittedVol = {};
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
        this.volumeEmitIntervalMs = 50; // Red local: 50ms suficiente para respuesta instantánea
        this.mixerRefs = {}; // Caché de referencias DOM para el mixer

        // --- CARRUSEL MULTITOUCH ---
        this.carouselPages = []; // Lista de IDs de páginas del carrusel (cargada del config)
        this.carouselIndex = 0;  // Slide activo actualmente
        this._swipeTouches = null; // Estado del gesto en progreso

        // --- MODO EDICIÓN ---
        this.editMode = false;
        this._dragState = null; // Estado del drag en progreso
        this._edgeScrollTimeout = null; // Temporizador para cambio de página en borde

        // --- PERFORMANCE CACHE & BATCHING ---
        this.panels = {
            mixer: document.getElementById('panel-mixer'),
            discord: document.getElementById('panel-discord'),
            domotica: document.getElementById('panel-domotica')
        };
        this.panelsContainer = document.getElementById('panels-container');
        this.confirmModal = document.getElementById('parameter-modal');
        this.confirmTitle = document.getElementById('parameter-title');
        this.confirmDescription = document.getElementById('parameter-description');
        this.confirmInput = document.getElementById('parameter-input');
        this.confirmCancelButton = document.getElementById('parameter-cancel');
        this.confirmSubmitButton = document.getElementById('parameter-submit');
        this.confirmResolve = null;
        this.initialLoad = true;
        this.updateQueue = new Map();
        this.isBatching = false;
        
        this.perf = new PerfMonitor();
        this._setupConfirmModalListeners();
        this.init();
    }

    async init() {
        this.setupSocketListeners();
        this.setupDOMListeners();

        try {
            const fetchOptions = {
                headers: {
                    'Authorization': this.securityToken
                }
            };

            const res = await fetch(`/api/config`, fetchOptions);
            
            if (!res.ok) {
                console.warn(`Error de autenticación o red (Status: ${res.status}). Mostrando login...`);
                document.getElementById('deck-container').style.display = 'none';
                this.requestSecurityToken();
                return;
            }

            const data = await res.json();
            this.pages = data.pages || {};
            this.carouselPages = Array.isArray(data.carouselPages) && data.carouselPages.length > 0
                ? data.carouselPages
                : ['main'];

            // Cargar scripts con token
            const scriptsRes = await fetch(`/api/scripts`, fetchOptions);
            if (scriptsRes.ok) {
                this.scriptsByFolder = await scriptsRes.json();
            } else {
                this.scriptsByFolder = {};
            }

            // Una vez autenticado, pedir estados iniciales
            this.socket.emit('mixer_initial_state');
            this.socket.emit('mixer_bind_commands');
            this.socket.emit('discord_initial_state');

            // Renderizar la interfaz solo si todo ha ido bien
            this.loadAppSettings();
            this.initMainGrid();
            this.renderEditModeButton();

        } catch (e) {
            console.error('Error crítico durante la inicialización:', e);
            document.getElementById('deck-container').style.display = 'none';
            this.requestSecurityToken();
        }
    }

    requestSecurityToken() {
        if (document.querySelector('.auth-overlay')) return;

        // Crear el overlay de autenticación
        const authOverlay = document.createElement('div');
        authOverlay.className = 'auth-overlay';
        
        authOverlay.innerHTML = `
            <div class="auth-card">
                <h2>Stream Deck Pro</h2>
                <p>🔒 Acceso Protegido: Introduce el Token de Seguridad para continuar.</p>
                <input type="password" class="auth-input" id="auth-password" placeholder="••••••••" autofocus>
                <button class="auth-btn" id="auth-submit">Desbloquear Sistema</button>
            </div>
        `;

        document.body.appendChild(authOverlay);

        const input = document.getElementById('auth-password');
        const submit = document.getElementById('auth-submit');

        const doLogin = () => {
            const token = input.value.trim();
            if (token) {
                localStorage.setItem('streamdeck_token', token);
                window.location.reload();
            }
        };

        submit.addEventListener('click', doLogin);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') doLogin();
        });

        // Intentar dar foco al input (algunas tablets requieren toque previo)
        setTimeout(() => input.focus(), 100);
    }

    _setupConfirmModalListeners() {
        if (!this.confirmModal) return;

        this.confirmCancelButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._closeConfirmModal(false);
        });
        this.confirmSubmitButton?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._closeConfirmModal(true);
        });
        this.confirmModal.addEventListener('click', (event) => {
            if (event.target === this.confirmModal) {
                this._closeConfirmModal(false);
            }
        });
    }

    _closeConfirmModal(confirmed) {
        if (!this.confirmModal) return;
        this.confirmModal.classList.add('hidden');
        if (this.confirmInput) {
            this.confirmInput.style.display = '';
        }
        if (this.confirmSubmitButton) {
            this.confirmSubmitButton.textContent = 'Aceptar';
        }
        if (this.confirmCancelButton) {
            this.confirmCancelButton.style.display = '';
            this.confirmCancelButton.textContent = 'Cancelar';
        }
        if (this.confirmTitle) {
            this.confirmTitle.textContent = '';
        }
        if (this.confirmDescription) {
            this.confirmDescription.textContent = '';
        }
        if (this.confirmResolve) {
            this.confirmResolve(confirmed);
            this.confirmResolve = null;
        }
    }

    showConfirmModal(message, title = 'Confirmar acción') {
        if (!this.confirmModal) return Promise.resolve(false);

        if (this.confirmResolve) {
            this._closeConfirmModal(false);
        }

        if (this.confirmTitle) this.confirmTitle.textContent = title;
        if (this.confirmDescription) this.confirmDescription.textContent = message;
        if (this.confirmInput) this.confirmInput.style.display = 'none';
        if (this.confirmSubmitButton) this.confirmSubmitButton.textContent = 'Sí';
        if (this.confirmCancelButton) {
            this.confirmCancelButton.style.display = '';
            this.confirmCancelButton.textContent = 'Cancelar';
        }

        this.confirmModal.classList.remove('hidden');

        return new Promise((resolve) => {
            this.confirmResolve = resolve;
        });
    }

    showInfoModal(message, title = 'Información') {
        if (!this.confirmModal) return Promise.resolve(false);

        if (this.confirmResolve) {
            this._closeConfirmModal(false);
        }

        if (this.confirmTitle) this.confirmTitle.textContent = title;
        if (this.confirmDescription) this.confirmDescription.textContent = message;
        if (this.confirmInput) this.confirmInput.style.display = 'none';
        if (this.confirmSubmitButton) {
            this.confirmSubmitButton.textContent = 'Cerrar';
        }
        if (this.confirmCancelButton) {
            this.confirmCancelButton.style.display = 'none';
        }

        this.confirmModal.classList.remove('hidden');

        return new Promise((resolve) => {
            this.confirmResolve = resolve;
        });
    }

    loadAppSettings() {
        this.appSettings = {
            darkMode: localStorage.getItem('streamdeck_dark_mode') === 'true',
            compactGrid: localStorage.getItem('streamdeck_compact_grid') === 'true',
            showHelpTips: localStorage.getItem('streamdeck_show_help_tips') !== 'false'
        };
        document.body.classList.toggle('dark-mode', this.appSettings.darkMode);
        document.body.classList.toggle('compact-grid', this.appSettings.compactGrid);
    }

    saveAppSetting(key, value) {
        this.appSettings[key] = value;
        localStorage.setItem(`streamdeck_${key}`, value.toString());
        if (key === 'darkMode') {
            document.body.classList.toggle('dark-mode', value);
        }
        if (key === 'compactGrid') {
            document.body.classList.toggle('compact-grid', value);
        }
    }

    openSettingsPanel() {
        if (!this.overlay || !this.overlayContainer) return;

        const settings = this.appSettings || {
            darkMode: false,
            compactGrid: false,
            showHelpTips: true
        };

        this.overlayContainer.innerHTML = `
            <div class="settings-panel glass">
                <div class="settings-header">
                    <div>
                        <h2>Ajustes</h2>
                        <p>Configura tu Stream Deck Pro desde esta pantalla.</p>
                    </div>
                    <button id="settings-close-btn" type="button" class="footer-btn">Cerrar</button>
                </div>
                <div class="settings-content">
                    <label class="settings-row">
                        <span>Modo oscuro</span>
                        <input type="checkbox" id="setting-dark-mode" ${settings.darkMode ? 'checked' : ''} />
                    </label>
                    <label class="settings-row">
                        <span>Grid compacto</span>
                        <input type="checkbox" id="setting-compact-grid" ${settings.compactGrid ? 'checked' : ''} />
                    </label>
                    <label class="settings-row">
                        <span>Mostrar consejos</span>
                        <input type="checkbox" id="setting-show-help" ${settings.showHelpTips ? 'checked' : ''} />
                    </label>
                </div>
            </div>
        `;

        const closeBtn = this.overlayContainer.querySelector('#settings-close-btn');
        closeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.closeFolder();
        });

        const darkModeToggle = this.overlayContainer.querySelector('#setting-dark-mode');
        const compactGridToggle = this.overlayContainer.querySelector('#setting-compact-grid');
        const helpToggle = this.overlayContainer.querySelector('#setting-show-help');

        darkModeToggle?.addEventListener('change', (event) => {
            this.saveAppSetting('darkMode', event.target.checked);
        });
        compactGridToggle?.addEventListener('change', (event) => {
            this.saveAppSetting('compactGrid', event.target.checked);
        });
        helpToggle?.addEventListener('change', (event) => {
            this.saveAppSetting('showHelpTips', event.target.checked);
        });

        this.overlay.classList.remove('hidden');
    }

    _getButtonHelpText(btnData) {
        if (btnData.helpText) return btnData.helpText;

        if (btnData.type === 'folder' || btnData.targetPage) {
            return `Abre la pantalla “${btnData.label || btnData.targetPage}”.`;
        }

        if (btnData.type === 'mixer') {
            return 'Abre los controles de audio y volumen del mezclador.';
        }

        if (btnData.type === 'discord_panel') {
            return 'Abre el panel de Discord para gestionar mute y volumen.';
        }

        if (btnData.type === 'domotica_panel') {
            return 'Abre el panel de domótica para controlar tus dispositivos.';
        }

        if (btnData.type === 'action') {
            const action = btnData.action || btnData.channel;
            const normalizeKey = (text = '') => text.toString().trim().toLowerCase().replace(/[._\-]+/g, ' ').replace(/\s+/g, ' ');
            const scriptDescriptions = {
                'activar win 11': 'Activa optimizaciones y ajustes recomendados para Windows 11.',
                'quitar bloatware': 'Desinstala aplicaciones y componentes no deseados de Windows.',
                'god mode': 'Activa el menú oculto de configuración avanzada de Windows.',
                'salud disco': 'Revisa el estado del disco y corrige problemas básicos.',
                'limpiar ram': 'Libera memoria RAM cerrando procesos temporales y caché.',
                'anti stuttering': 'Reduce micro-tartamudeos en juegos cerrando tareas innecesarias.',
                'modo tryhard': 'Maximiza el rendimiento del CPU para sesiones exigentes.',
                'ping optimizer': 'Optimiza la conexión de red para reducir latencia.',
                'asesino zombies': 'Cierra procesos inactivos y aplicaciones de “zombies” que consumen recursos.',
                'mac spoofer': 'Cambia la dirección MAC para proteger tu privacidad en red.',
                'identidad falsa': 'Genera un perfil de red falso y mejora tu anonimato en línea.',
                'panic button': 'Ejecuta una acción rápida de emergencia para cerrar o proteger el sistema.',
                'limpieza extrema': 'Realiza una limpieza profunda de archivos temporales y basura del sistema.',
                'buscador dupl': 'Busca y elimina archivos duplicados para liberar espacio.',
                'organizador': 'Organiza archivos y carpetas según reglas predefinidas.',
                'servidor desc': 'Lanza el servidor de descargas para gestionar descargas locales.',
                'descargador': 'Inicia el descargador maestro para bajar archivos automáticamente.',
                'spicetify': 'Aplica temas personalizados a Spotify usando Spicetify.',
                'macros': 'Abre el gestor de macros para automatizar tareas repetitivas.',
                'cloud gaming': 'Configura accesos rápidos para servicios de gaming en la nube.',
                'purgar ram': 'Limpia la memoria RAM liberando caché y procesos temporales.',
                'purgador shaders': 'Elimina shaders temporales para forzar regeneración limpia.',
                'despertar nucleos': 'Activa todos los núcleos del procesador para alto rendimiento.',
                'limpieza extrema global': 'Ejecuta una limpieza profunda general del sistema.'
            };

            const labelKey = normalizeKey(btnData.label);
            const fileKey = normalizeKey(btnData.payload?.archivo || btnData.payload?.label || '');
            const mapKey = labelKey || fileKey;
            if (mapKey && scriptDescriptions[mapKey]) {
                return scriptDescriptions[mapKey];
            }

            switch (action) {
                case 'abrir_keep':
                    return 'Abre Google Keep en tu equipo.';
                case 'abrir_calendario':
                    return 'Abre Google Calendar en tu equipo.';
                case 'cambiar_resolucion':
                    return `Cambia la resolución de pantalla a ${btnData.payload?.width || '?'}x${btnData.payload?.height || '?'}.`;
                case 'apagar_pc':
                    return 'Apaga el equipo de forma segura.';
                case 'reiniciar_pc':
                    return 'Reinicia el equipo de forma segura.';
                case 'minimizar_todo':
                    return 'Minimiza todas las ventanas abiertas.';
                case 'ejecutar_script':
                case 'ejecutar_script_dinamico':
                    if (btnData.payload?.archivo) {
                        const scriptName = btnData.payload.archivo.replace(/[_\-]/g, ' ').replace(/\.[^.]+$/, '');
                        return `Ejecuta el script '${scriptName}' ubicado en la carpeta '${btnData.payload.carpeta || 'scripts'}'.`;
                    }
                    return `Ejecuta el script asociado a este botón: ${btnData.label || action}.`;
                case 'macro':
                    return `Ejecuta la macro ${btnData.payload || btnData.action}.`;
                default:
                    if (btnData.channel === 'tuya_command') {
                        return 'Envía un comando a tus dispositivos domóticos.';
                    }
                    if (btnData.channel === 'multimedia') {
                        return `Control multimedia: ${btnData.action || 'acción'}.`;
                    }
                    return `Ejecuta la acción ${action || btnData.label || 'desconocida'}.`;
            }
        }

        return `Botón: ${btnData.label || 'Acción desconocida'}.`;
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
        this.container.className = 'deck-view'; // Vista custom con grid + footer

        const pageData = this.getPageData(pageId);
        const shouldInjectBack = pageId !== 'main';

        // Grid principal (4x4)
        const gridEl = document.createElement('div');
        gridEl.className = 'deck-grid';

        if (shouldInjectBack) {
            gridEl.appendChild(this.createBackButton(0));
        }

        pageData.forEach((btnData, index) => {
            const visualIndex = shouldInjectBack ? index + 1 : index;
            gridEl.appendChild(this.createButton(btnData, visualIndex));
        });

        this.container.appendChild(gridEl);

        // Footer con cuatro controles (Editar / Anterior / Siguiente / Ajustes)
        // Eliminar cualquier botón flotante existente para evitar duplicados
        const existingFloating = document.getElementById('edit-mode-btn');
        if (existingFloating && !existingFloating.closest('.deck-footer')) {
            existingFloating.remove();
        }
        const footer = document.createElement('div');
        footer.className = 'deck-footer';

        const btnEditar = document.createElement('button');
        btnEditar.id = 'edit-mode-btn';
        btnEditar.className = 'footer-btn';
        btnEditar.textContent = 'Editar';
        btnEditar.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.editMode) {
                this.exitEditMode();
            } else {
                this.enterEditMode();
            }
        });

        const btnAnterior = document.createElement('button');
        btnAnterior.className = 'footer-btn';
        btnAnterior.textContent = 'Anterior';
        btnAnterior.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.carouselIndex > 0) this.renderCarouselSlide(this.carouselIndex - 1, -1);
        });

        const btnSiguiente = document.createElement('button');
        btnSiguiente.className = 'footer-btn';
        btnSiguiente.textContent = 'Siguiente';
        btnSiguiente.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.carouselIndex < this.carouselPages.length - 1) this.renderCarouselSlide(this.carouselIndex + 1, 1);
        });

        const btnAjustes = document.createElement('button');
        btnAjustes.className = 'footer-btn';
        btnAjustes.textContent = 'Ajustes';
        btnAjustes.addEventListener('click', (e) => {
            e.preventDefault();
            this.openSettingsPanel();
        });

        footer.appendChild(btnEditar);
        footer.appendChild(btnAnterior);
        footer.appendChild(btnSiguiente);
        footer.appendChild(btnAjustes);

        this.container.appendChild(footer);

        this.renderEditModeButton();
        this._setEditButtonVisibility(true);
    }

    renderDiscordPanel() {
        this.container.innerHTML = '';
        this.container.className = 'grid-container';

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
        this.currentPage = 'domotica_panel';
        
        const domoPanel = this.panels.domotica;
        if (!domoPanel.innerHTML) {
            domoPanel.className = 'panel-cache-node domotica-sketch-match-view';
            domoPanel.innerHTML = `
                <div class="domotica-master-frame">
                    <div class="domotica-sketch-content">
                        <div class="domotica-card-fader">
                            <div class="fader-track-pro">
                                <div class="fader-fill-pro"></div>
                                <div class="fader-thumb-pro"></div>
                            </div>
                        </div>
                        <div class="domotica-card-buttons">
                            <div class="domotica-sketch-grid"></div>
                        </div>
                    </div>
                </div>
            `;

            const backBtn = document.createElement('button');
            backBtn.className = 'panel-back-btn-sketch-circle';
            backBtn.innerHTML = '<span>←</span>';
            backBtn.addEventListener('pointerup', (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                
                const shield = document.createElement('div');
                shield.className = 'pointer-shield';
                document.body.appendChild(shield);
                setTimeout(() => shield.remove(), 400);

                this.hidePanels();
                this.renderCarouselSlide(this.carouselIndex, 0);
            });
            domoPanel.appendChild(backBtn);

            const faderTrack = domoPanel.querySelector('.fader-track-pro');
            const faderFill = domoPanel.querySelector('.fader-fill-pro');
            const faderThumb = domoPanel.querySelector('.fader-thumb-pro');
            const controlGrid = domoPanel.querySelector('.domotica-sketch-grid');

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

            let trackRect = null;
            let trackH = 0;
            let isRAFActive = false;

            const updateFader = (e) => {
                if (!trackRect) {
                    trackRect = faderTrack.getBoundingClientRect();
                    trackH = trackRect.height;
                }
                const y = e.clientY - trackRect.top;
                let percent = 100 - (y / trackH) * 100;
                percent = Math.max(1, Math.min(100, Math.round(percent)));
                if (percent === this.lastTuyaIntensity) return;
                this.lastTuyaIntensity = percent;

                if (!isRAFActive) {
                    isRAFActive = true;
                    requestAnimationFrame(() => {
                        const p = this.lastTuyaIntensity;
                        faderFill.style.transform = `scale3d(1, ${p / 100}, 1)`;
                        this.setThumbTransform(faderThumb, p, trackH);
                        isRAFActive = false;
                    });
                }

                const tuyaVal = Math.round(10 + (percent / 100) * 990);
                this.scheduleThrottledEmit('tuya_brightness', () => {
                    this.socket.emit('tuya_command', { deviceIds: this.tuyaDevices, code: 'bright_value_v2', value: tuyaVal });
                }, 350);
            };
            faderThumb.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                trackRect = faderTrack.getBoundingClientRect();
                trackH = trackRect.height;
                faderThumb.setPointerCapture(e.pointerId);
                document.body.classList.add('dragging-active');
                updateFader(e);
                faderThumb.addEventListener('pointermove', updateFader);
            });

            faderThumb.addEventListener('pointerup', (e) => {
                if (faderThumb.hasPointerCapture && faderThumb.hasPointerCapture(e.pointerId)) faderThumb.releasePointerCapture(e.pointerId);
                document.body.classList.remove('dragging-active');
                faderThumb.removeEventListener('pointermove', updateFader);
                // Guardar al final para evitar lag durante el movimiento
                localStorage.setItem('lastTuyaIntensity', this.lastTuyaIntensity);
            });

        }

        this.showPanel('domotica');
        
        // Fix de inicialización fader
        requestAnimationFrame(() => {
            const faderTrack = domoPanel.querySelector('.fader-track-pro');
            const faderFill = domoPanel.querySelector('.fader-fill-pro');
            const faderThumb = domoPanel.querySelector('.fader-thumb-pro');
            const trackRect = faderTrack.getBoundingClientRect();
            if (trackRect.height > 0) {
                const trackH = trackRect.height;
                faderFill.style.transform = `scale3d(1, ${this.lastTuyaIntensity / 100}, 1)`;
                this.setThumbTransform(faderThumb, this.lastTuyaIntensity, trackH);
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
                            payload: { carpeta, archivo: f.archivo },
                            helpText: f.helpText || f.description || f.descripcion || ''
                        });
                    }
                });

                // Attach detected helpText to pre-configured buttons when applicable
                for (let i = 0; i < configured.length; i++) {
                    const item = configured[i];
                    if (item && item.payload && item.payload.archivo) {
                        const found = detected.find(d => d.archivo === item.payload.archivo);
                        if (found && found.helpText) {
                            item.helpText = item.helpText || found.helpText || found.description || found.descripcion || '';
                        }
                    }
                }

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
                payload: { carpeta, archivo: f.archivo },
                helpText: f.helpText || f.description || f.descripcion || ''
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

        if (this.initialLoad) {
            btn.style.animation = 'none';
            btn.style.opacity = '1';
            btn.style.transform = 'scale(1)';
            btn.style.transition = 'none';
        } else {
            btn.style.animationDelay = `${index * 0.05}s`;
        }

        const iconEl = document.createElement('div');
        iconEl.className = 'button-icon';
        iconEl.innerHTML = btnData.icon || ''; // Los iconos pueden ser HTML/Emojis

        const labelEl = document.createElement('div');
        labelEl.className = 'button-label';
        labelEl.textContent = btnData.label || ''; // USAMOS textContent POR SEGURIDAD (Evita XSS)

        btn.appendChild(iconEl);
        btn.appendChild(labelEl);
        // === LÓGICA DE PULSACIÓN LARGA PARA MOSTRAR AYUDA ===
        let longPressTimer = null;
        let startPos = null;
        let longPressHandled = false;

        const startTimer = (e) => {
            if (this.editMode) return;
            startPos = { x: e.clientX, y: e.clientY };
            btn.classList.add('pressing');
            longPressTimer = setTimeout(async () => {
                if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
                longPressHandled = true;
                const helpText = this._getButtonHelpText(btnData);
                await this.showInfoModal(helpText, btnData.label || 'Información');
            }, 600);
        };

        const clearTimer = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            btn.classList.remove('pressing');
        };

        const handlePointerUp = (e) => {
            clearTimer();
            if (longPressHandled) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        btn.addEventListener('pointerdown', startTimer);
        btn.addEventListener('pointermove', (e) => {
            if (!startPos) return;
            const dist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);
            if (dist > 15) clearTimer();
        }, { passive: true });
        btn.addEventListener('pointerup', handlePointerUp);
        btn.addEventListener('pointercancel', handlePointerUp);
        btn.addEventListener('pointerleave', clearTimer, { passive: true });

        btn.addEventListener('click', async () => {
            // En modo edición, el drag se encarga. No ejecutar acciones.
            if (this.editMode) return;
            if (longPressHandled) {
                longPressHandled = false;
                return;
            }

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
                if (btnData.action === 'apagar_pc' || btnData.action === 'reiniciar_pc') {
                    const confirmMessage = btnData.action === 'apagar_pc'
                        ? 'Se apagará el PC. ¿Deseas continuar?'
                        : 'Se reiniciará el PC. ¿Deseas continuar?';

                    const confirmed = await this.showConfirmModal(confirmMessage, btnData.action === 'apagar_pc' ? 'Apagar equipo' : 'Reiniciar equipo');
                    if (!confirmed) return;
                }

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

    // --- PANEL CACHE MANAGER ---
    showPanel(panelId) {
        const start = performance.now();
        
        // Ocultar todos los paneles
        Object.values(this.panels).forEach(p => p.classList.add('hidden'));
        this.container.classList.add('hidden'); // Ocultar grid principal
        
        this.panelsContainer.classList.remove('hidden');
        const panel = this.panels[panelId];
        if (panel) {
            panel.classList.remove('hidden');
        }
        
        this.perf.markRender(performance.now() - start);
    }

    hidePanels() {
        this.panelsContainer.classList.add('hidden');
        Object.values(this.panels).forEach(p => p.classList.add('hidden'));
        this.container.classList.remove('hidden');
    }

    // --- BATCH UPDATE SYSTEM ---
    queueUpdate(id, fn) {
        this.updateQueue.set(id, fn);
        if (!this.isBatching) {
            this.isBatching = true;
            requestAnimationFrame(() => {
                const start = performance.now();
                this.updateQueue.forEach(fn => fn());
                this.updateQueue.clear();
                this.isBatching = false;
                this.perf.markRender(performance.now() - start);
            });
        }
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
        this.currentPage = 'mixer_panel';

        const mixerPanel = this.panels.mixer;
        if (!mixerPanel.innerHTML) {
            mixerPanel.className = 'panel-cache-node mixer-fullscreen-view';
            mixerPanel.innerHTML = `
                <div class="mixer-panel mixer-panel-fullscreen">
                    <div id="master-mixer" class="mixer-row master-row"></div>
                    <div class="mixer-divider"></div>
                    <div id="app-mixers" class="app-mixers-container"></div>
                </div>
            `;
        }

        // Siempre asegurarnos de que el botón de volver existe y está limpio
        let backBtn = document.getElementById('panel-back-button');
        if (backBtn) backBtn.remove();

        backBtn = document.createElement('button');
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
            setTimeout(() => shield.remove(), 400);

            this.hidePanels();
            this.renderCarouselSlide(this.carouselIndex, 0);
        });
        document.body.appendChild(backBtn);

        // Renderizar el estado actual ANTES de mostrar el panel para evitar el collapse visual
        if (this.lastMixerState) {
            this.renderInitialMixer();
        }

        this.showPanel('mixer');
        this.socket.emit('mixer_initial_state');
        this.socket.emit('mixer_bind_commands');
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
            <div class="mixer-icon-btn${mutedClass}">
                <div id="icon-wrapper-${id}" class="mixer-icon-wrapper${mutedWrapperClass}">
                    ${iconHTML}
                </div>
            </div>
            <div class="slider-container" data-app="${appData.name}">
                <div class="slider-fill" style="transform: scale3d(1, ${vol / 100}, 1); transform-origin: bottom;"></div>
                <div class="fader-thumb-mixer"></div>
            </div>

            <div class="mixer-label">${labelName}</div>
        `;

        const iconBtn = row.querySelector('.mixer-icon-btn');
        if (iconBtn) {
            iconBtn.addEventListener('pointerup', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleMute(id, isMaster);
            });
        }

        const container = row.querySelector('.slider-container');
        const fill = container.querySelector('.slider-fill');
        const thumb = container.querySelector('.fader-thumb-mixer');
        const wrapper = row.querySelector('.mixer-icon-wrapper');

        // Guardamos las referencias para actualizaciones en tiempo real
        this.mixerRefs[id] = { fill, thumb, wrapper, track: container, trackH: 0 };
        let containerRect = null;
        let trackH = 0;
        let isRAFActive = false;

        const updateUI = (e) => {
            if (!containerRect) {
                containerRect = container.getBoundingClientRect();
                trackH = containerRect.height;
                this.mixerRefs[id].trackH = trackH; // cachear para updateSliderUI
            }
            
            const clientY = e.clientY;
            let y = clientY - containerRect.top;
            let percent = 100 - (y / trackH) * 100;
            percent = Math.max(0, Math.min(100, Math.round(percent)));

            if (percent === this[`last_mixer_${id}`]) return;
            this[`last_mixer_${id}`] = percent;

            // 1. Visual (Optimized RAF - solo compositor, cero layout reflow)
            if (!isRAFActive) {
                isRAFActive = true;
                requestAnimationFrame(() => {
                    const p = this[`last_mixer_${id}`];
                    fill.style.transform = `scale3d(1, ${p / 100}, 1)`;
                    this.setThumbTransform(thumb, p, trackH);
                    isRAFActive = false;
                });
            }

            // 2. Network (Throttled)
            this.updateVolumeServer(id, percent, isMaster);
        };

        const onPointerDown = (e) => {
            e.preventDefault();
            const row = container.closest('.mixer-row');
            if (row) row.classList.add('dragging'); // Modo Zero Lag

            this.activeSliders.add(id);
            
            containerRect = container.getBoundingClientRect();
            trackH = containerRect.height;
            thumb.setPointerCapture(e.pointerId);
            document.body.classList.add('dragging-active');
            thumb.addEventListener('pointermove', updateUI);
            updateUI(e);
        };


        container.addEventListener('pointerdown', onPointerDown);

        const releaseSlider = (e) => {
            if (thumb.hasPointerCapture && thumb.hasPointerCapture(e.pointerId)) {
                thumb.releasePointerCapture(e.pointerId);
            }
            document.body.classList.remove('dragging-active');
            thumb.removeEventListener('pointermove', updateUI);


            const finalPercent = this[`last_mixer_${id}`];
            if (Number.isFinite(finalPercent)) {
                this.updateVolumeServer(id, finalPercent, isMaster, true);
            }

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

        // Comprobación de integridad para evitar re-renders innecesarios si nada ha cambiado
        const currentStateStr = JSON.stringify(this.lastMixerState);
        if (this._renderedMixerState === currentStateStr) return;
        this._renderedMixerState = currentStateStr;

        this.mixerRefs = {};
        masterContainer.innerHTML = '';
        appsContainer.innerHTML = '';

        const masterFragment = document.createDocumentFragment();
        masterFragment.appendChild(this.createMixerRow(this.lastMixerState.master, true));
        masterContainer.replaceChildren(masterFragment);

        const appsFragment = document.createDocumentFragment();
        const renderizadas = new Set();
        this.lastMixerState.sessions.forEach(session => {
            if (!renderizadas.has(session.name)) {
                appsFragment.appendChild(this.createMixerRow(session));
                renderizadas.add(session.name);
            }
        });
        appsContainer.replaceChildren(appsFragment);

        // --- FIX DE INICIALIZACIÓN MIXER (PREMIUM FLUIDITY) ---
        // Forzamos un reflow antes del RAF para asegurar que getBoundingClientRect tenga valores reales
        void masterContainer.offsetWidth; 

        requestAnimationFrame(() => {
            Object.keys(this.mixerRefs).forEach(id => {
                const refs = this.mixerRefs[id];
                if (!refs) return;
                
                let trackRect = refs.track.getBoundingClientRect();
                let trackH = trackRect.height;

                // Si aún es 0 (panel oculto), usamos un valor por defecto basado en clamp del CSS
                // clamp(160px, 40dvh, 300px). Calculamos el valor real aproximado.
                if (trackH === 0) {
                    const dvh = window.innerHeight * 0.4;
                    trackH = Math.max(160, Math.min(300, dvh));
                }
                
                refs.trackH = trackH;
                
                let vol = 0;
                if (id === 'global') {
                    vol = this.lastMixerState.master.volume;
                } else {
                    const sess = this.lastMixerState.sessions.find(s => s.name === id);
                    if (sess) vol = sess.volume;
                }
                
                refs.fill.style.transform = `scale3d(1, ${vol / 100}, 1)`;
                this.setThumbTransform(refs.thumb, vol, trackH);
                this[`last_mixer_${id}`] = vol;
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

    updateVolumeServer(app, value, isMaster, immediate = false) {
        const id = isMaster ? 'global' : app;
        const queueKey = isMaster ? 'mix_master' : `mix_${app}`;
        const roundedValue = Math.round(Number(value));
        if (!Number.isFinite(roundedValue)) return;
        this.pendingVolUpdates[queueKey] = roundedValue;

        if (immediate) {
            if (this.volUpdateTimers[queueKey]) {
                clearTimeout(this.volUpdateTimers[queueKey]);
                this.volUpdateTimers[queueKey] = null;
            }

            this.volUpdateTimes[queueKey] = Date.now();
            const currentVolume = this.pendingVolUpdates[queueKey];
            if (this.lastEmittedVol[queueKey] === currentVolume) return;
            this.lastEmittedVol[queueKey] = currentVolume;
            if (isMaster) {
                this.socket.emit('set_master_volume', currentVolume);
            } else {
                this.socket.emit('set_session_volume', { app, value: currentVolume });
            }
            return;
        }

        this.scheduleThrottledEmit(queueKey, () => {
            const valToEmit = this.pendingVolUpdates[queueKey];
            if (this.lastEmittedVol[queueKey] === valToEmit) return;
            this.lastEmittedVol[queueKey] = valToEmit;
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
            this.queueUpdate(`speaking_${data.userId}`, () => {
                const row = document.querySelector(`.user-fader-row[data-user-id="${data.userId}"]`);
                if (row) {
                    const avatarCircle = row.querySelector('.user-avatar-circle');
                    if (avatarCircle) {
                        avatarCircle.classList.toggle('speaking', !!data.speaking);
                    }
                }
            });
        });

        /*
        this.socket.on('performance:update', (data) => {
            if (this.perf) {
                this.perf.updateServerStats(data);
            }
        });
        */


        /*
        // Ping calculation
        setInterval(() => {
            const start = Date.now();
            this.socket.emit('ping', () => {
                const latency = Date.now() - start;
                if (this.perf) this.perf.updatePing(latency);
            });
        }, 3000);
        */


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

        this.socket.on('connect_error', (err) => {

            console.error('Socket Connection Error:', err.message);
            if (err.message.includes('Acceso denegado')) {
                localStorage.removeItem('streamdeck_token');
                this.requestSecurityToken();
            }
        });
    }

    updateSliderUI(id, data) {
        const refs = this.mixerRefs[id];
        if (!refs) return;

        this.queueUpdate(`mixer_${id}_${data.type}`, () => {
            if (data.type === 'volume') {
                if (!this.activeSliders.has(id)) {
                    const h = Number(data.value);
                    // Usar trackH cacheado; fallback a getBoundingClientRect solo si no está disponible
                    const trackH = refs.trackH || (() => {
                        const r = refs.track.getBoundingClientRect();
                        refs.trackH = r.height;
                        return r.height;
                    })();
                    refs.fill.style.transform = `scale3d(1, ${h / 100}, 1)`;
                    this.setThumbTransform(refs.thumb, h, trackH);
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

    openDiscordPanel() {
        this._setEditButtonVisibility(false);
        this.currentPage = 'discord_panel';
        
        const discordPanel = this.panels.discord;
        if (!discordPanel.innerHTML) {
            discordPanel.className = 'panel-cache-node discord-sketch-match-view';
            discordPanel.innerHTML = `
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

            const backBtn = document.createElement('button');
            backBtn.className = 'panel-back-btn-sketch-circle';
            backBtn.innerHTML = '<span>←</span>';
            backBtn.addEventListener('pointerup', (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();

                const shield = document.createElement('div');
                shield.className = 'pointer-shield';
                document.body.appendChild(shield);
                setTimeout(() => shield.remove(), 400);

                this.hidePanels();
                this.renderCarouselSlide(this.carouselIndex, 0);
            });
            discordPanel.appendChild(backBtn);

            discordPanel.querySelector('#tactical-mute-btn').addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.toggleDiscordMute();
            });
            discordPanel.querySelector('#tactical-deaf-btn').addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.toggleDiscordDeaf();
            });
        }

        // Renderizar antes de mostrar para evitar flicker
        this.updateDiscordButtons();
        this.renderDiscordMixer();
        
        this.showPanel('discord');
        this.socket.emit('discord_initial_state');
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
                        <div class="slider-fill discord-fill-warm" style="transform: scale3d(1, ${fillHeight / 100}, 1); transform-origin: bottom;"></div>
                        <div class="fader-thumb-mixer" style="bottom: 0"></div>
                    </div>
                    <div class="discord-username-tag">${user.username}</div>
                `;

                const track = row.querySelector('.slider-container');
                const fill = row.querySelector('.slider-fill');
                const thumb = row.querySelector('.fader-thumb-mixer');

                requestAnimationFrame(() => {
                    const rect = track.getBoundingClientRect();
                    if (rect.height > 0) {
                        this.setThumbTransform(thumb, fillHeight, rect.height);
                    }
                });

                let trackRect = null;
                let trackH = 0;
                let isRAFActive = false;

                const updateDiscordVol = (e) => {
                    if (!trackRect) {
                        trackRect = track.getBoundingClientRect();
                        trackH = trackRect.height;
                    }
                    const y = e.clientY - trackRect.top;
                    let percentRaw = 100 - (y / trackH) * 100;
                    percentRaw = Math.max(0, Math.min(100, Math.round(percentRaw)));

                    if (percentRaw === this[`last_discord_${id}`]) return;
                    this[`last_discord_${id}`] = percentRaw;

                    // 1. Visual (Optimized RAF)
                    if (!isRAFActive) {
                        isRAFActive = true;
                        requestAnimationFrame(() => {
                            const p = this[`last_discord_${id}`];
                            fill.style.transform = `scale3d(1, ${p / 100}, 1)`;
                            this.setThumbTransform(thumb, p, trackH);
                            isRAFActive = false;
                        });
                    }

                    // 2. Logic (Discord is 0-200)
                    const discordVol = Math.round(percentRaw * 2);
                    this.updateVolumeServer(`discord_${id}`, discordVol, false);
                };

                track.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    row.classList.add('dragging');
                    this.activeSliders.add('discord_' + id);
                    trackRect = track.getBoundingClientRect();
                    trackH = trackRect.height;
                    thumb.setPointerCapture(e.pointerId);
                    document.body.classList.add('dragging-active');
                    updateDiscordVol(e);

                    const moveH = (m) => updateDiscordVol(m);
                    const stopH = (u) => {
                        row.classList.remove('dragging'); // Fin modo Zero Lag
                        if (thumb.hasPointerCapture && thumb.hasPointerCapture(u.pointerId)) {
                            thumb.releasePointerCapture(u.pointerId);
                        }
                        document.body.classList.remove('dragging-active');
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
                if (!this.activeSliders.has('discord_' + id)) {
                    const fill = row.querySelector('.slider-fill');
                    const thumb = row.querySelector('.fader-thumb-mixer');
                    const h = (user.volume / 200) * 100;
                    this.queueUpdate(`discord_${id}_vol`, () => {
                        const track = row.querySelector('.slider-container');
                        const trackHeight = track.getBoundingClientRect().height;
                        fill.style.transform = `scale3d(1, ${h / 100}, 1)`;
                        this.setThumbTransform(thumb, h, trackHeight);
                    });
                }
                
                this.queueUpdate(`discord_${id}_speaking`, () => {
                    const avatarCircle = row.querySelector('.user-avatar-circle');
                    if (avatarCircle) {
                        avatarCircle.classList.toggle('speaking', !!user.speaking);
                    }
                });
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
        // El volumen requiere conexión avanzada (OAuth)
        if (this.discordConnectionStatus !== 'connected') {
            console.warn('Volumen individual requiere conexión avanzada de Discord');
            return;
        }
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
        this.container.className = 'deck-view';
        const useSlideAnimation = !this.initialLoad && Boolean(slideClass);
        if (useSlideAnimation) this.container.classList.add(slideClass);

        const pageData = this.getPageData(pageId);

        const gridEl = document.createElement('div');
        gridEl.className = 'deck-grid';
        pageData.forEach((btnData, i) => {
            gridEl.appendChild(this.createButton(btnData, i));
        });
        this.container.appendChild(gridEl);

        // Forzar reflow para que la animación funcione
        if (useSlideAnimation) {
            void this.container.offsetWidth;
            this.container.classList.remove(slideClass);
            this.container.classList.add('slide-active');
        }

        // Footer con controles como en renderGrid
        // Eliminar cualquier botón flotante existente para evitar duplicados
        const existingFloating = document.getElementById('edit-mode-btn');
        if (existingFloating && !existingFloating.closest('.deck-footer')) {
            existingFloating.remove();
        }

        const footer = document.createElement('div');
        footer.className = 'deck-footer';

        const btnEditar = document.createElement('button');
        btnEditar.id = 'edit-mode-btn';
        btnEditar.type = 'button';
        btnEditar.className = 'footer-btn';
        btnEditar.textContent = 'Editar';
        btnEditar.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.editMode) {
                this.exitEditMode();
            } else {
                this.enterEditMode();
            }
        });

        const btnAnterior = document.createElement('button');
        btnAnterior.type = 'button';
        btnAnterior.className = 'footer-btn';
        btnAnterior.textContent = 'Anterior';
        btnAnterior.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.carouselIndex > 0) this.renderCarouselSlide(this.carouselIndex - 1, -1);
        });

        const btnSiguiente = document.createElement('button');
        btnSiguiente.type = 'button';
        btnSiguiente.className = 'footer-btn';
        btnSiguiente.textContent = 'Siguiente';
        btnSiguiente.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.carouselIndex < this.carouselPages.length - 1) this.renderCarouselSlide(this.carouselIndex + 1, 1);
        });

        const btnAjustes = document.createElement('button');
        btnAjustes.type = 'button';
        btnAjustes.className = 'footer-btn';
        btnAjustes.textContent = 'Ajustes';
        btnAjustes.addEventListener('click', (e) => {
            e.preventDefault();
            this.openSettingsPanel();
        });

        footer.appendChild(btnEditar);
        footer.appendChild(btnAnterior);
        footer.appendChild(btnSiguiente);
        footer.appendChild(btnAjustes);

        this.container.appendChild(footer);
        this.renderEditModeButton();

        this._setEditButtonVisibility(true);

        // Si estamos en modo edición, reactivar drag en los nuevos botones
        if (this.editMode) {
            this._applyEditModeToButtons();
        }

        if (this.initialLoad) {
            this.initialLoad = false;
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
        const fragment = document.createDocumentFragment();
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
            fragment.appendChild(dot);
        });
        dots.appendChild(fragment);
    }

    renderCarouselNavigationButtons() {
        let nav = document.getElementById('carousel-nav-buttons');
        if (!nav) {
            nav = document.createElement('div');
            nav.id = 'carousel-nav-buttons';
            document.body.appendChild(nav);
        }

        if (!this.carouselPages || this.carouselPages.length <= 1) {
            nav.style.display = 'none';
            return;
        }

        nav.style.display = 'flex';
        nav.innerHTML = '';

        const createNavButton = (label, disabled, handler) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'carousel-nav-btn';
            btn.textContent = label;
            btn.disabled = disabled;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (disabled || this.editMode) return;
                handler();
            });
            return btn;
        };

        const prevBtn = createNavButton('← Anterior', this.carouselIndex <= 0, () => {
            if (this.carouselIndex > 0) {
                this.renderCarouselSlide(this.carouselIndex - 1, -1);
            }
        });

        const nextBtn = createNavButton('Siguiente →', this.carouselIndex >= this.carouselPages.length - 1, () => {
            if (this.carouselIndex < this.carouselPages.length - 1) {
                this.renderCarouselSlide(this.carouselIndex + 1, 1);
            }
        });

        nav.appendChild(prevBtn);
        nav.appendChild(nextBtn);
    }

    // ================================================================
    // ✏️ MODO EDICIÓN (DRAG & DROP)
    // ================================================================

    /** Crea el botón flotante de edición y lo añade al body */
    renderEditModeButton() {
        // Only update an existing `edit-mode-btn` (now provided by the footer).
        // Do NOT create a floating fallback button to avoid duplicate controls.
        const existing = document.getElementById('edit-mode-btn');
        if (!existing) return;

        if (this.editMode) {
            existing.classList.add('active');
            existing.textContent = 'Listo';
        } else {
            existing.classList.remove('active');
            existing.textContent = 'Editar';
        }
    }

    /** Muestra u oculta el botón de edición y los dots del carrusel */
    _setEditButtonVisibility(visible) {
        const btn = document.getElementById('edit-mode-btn');
        if (btn) btn.style.display = visible ? 'flex' : 'none';

        const dots = document.getElementById('carousel-dots');
        if (dots) {
            dots.style.display = 'none';
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

        let lastTargetBtn = null;

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
            if (targetBtn !== lastTargetBtn) {
                if (lastTargetBtn) {
                    lastTargetBtn.classList.remove('drag-over');
                }
                if (targetBtn) {
                    targetBtn.classList.add('drag-over');
                    this._dragState.lastOverIndex = parseInt(targetBtn.dataset.editIndex);
                } else {
                    this._dragState.lastOverIndex = sourceIndex;
                }
                lastTargetBtn = targetBtn;
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
            const res = await fetch(`/api/config`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': this.securityToken
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
        } catch (err) {
            console.warn('No se pudo guardar config:', err);
        }
    }

    // Helper: posiciona el thumb usando SOLO transform (compositor-only, sin layout reflow)
    // Formula: translate3d(-50%, offset - (p/100)*H, 0)
    setThumbTransform(thumbEl, p, h) {
        if (!thumbEl) return;
        // Si el thumb es el de Domótica (110px), el offset es 55px.
        // Si es el de Mixer/Discord (64px), el offset es 32px.
        const isDomo = thumbEl.classList.contains('fader-thumb-pro');
        const offset = isDomo ? 55 : 32;
        const ty = offset - (p / 100) * h;
        thumbEl.style.transform = `translate3d(-50%, ${ty}px, 0)`;
    }
}

const btnFullscreen = document.createElement('div');
btnFullscreen.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
</svg>`;
btnFullscreen.className = 'btn-fullscreen';
btnFullscreen.title = 'Pantalla Completa';
document.body.appendChild(btnFullscreen);

btnFullscreen.addEventListener('click', () => {
    let elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
    }
});

// Mostrar/Ocultar botón según el estado de pantalla completa
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        btnFullscreen.classList.add('btn-fullscreen--hidden');
    } else {
        btnFullscreen.classList.remove('btn-fullscreen--hidden');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    new StreamDeckClient();
});