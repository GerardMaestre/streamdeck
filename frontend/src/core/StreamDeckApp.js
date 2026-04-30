/**
 * StreamDeckApp — Main orchestrator.
 * Wires up all modules, services, and UI components.
 * This file replaces the monolithic StreamDeckClient class.
 */
import { EventBus } from './EventBus.js';
import { ThrottleScheduler } from '../utils/throttle.js';
import { setQueuePerfCallback } from '../utils/dom.js';
import { PerfMonitor, shouldUseLowPerformanceMode } from '../services/PerfService.js';
import { StateService } from '../services/StateService.js';
import { PanelManager } from '../ui/PanelManager.js';
import { ModalManager } from '../ui/ModalManager.js';
import { getButtonHelpText } from '../ui/ButtonFactory.js';
import { MixerModule } from '../modules/MixerModule.js';
import { DiscordModule } from '../modules/DiscordModule.js';
import { DomoticaModule } from '../modules/DomoticaModule.js';
import { AutoClickerModule } from '../modules/AutoClickerModule.js';
import { CarouselModule } from '../modules/CarouselModule.js';
import { EditModeModule } from '../modules/EditModeModule.js';
import { NotificationToast } from '../ui/NotificationToast.js';

export class StreamDeckApp {
    constructor() {
        if (window.streamDeck) return;
        window.streamDeck = this;

        // --- Global error handler ---
        window.addEventListener('error', (e) => {
            console.error('GLOBAL FRONTEND ERROR:', e.message);
            if (this.toast) {
                this.toast.show(`Error: ${e.message}`, 'error', 5000);
            }
        });

        // --- Security token ---
        this.securityToken = localStorage.getItem('streamdeck_token') || '';

        // --- Socket ---
        this.socket = io({
            auth: { token: this.securityToken },
            transports: ['websocket']
        });

        // --- Core ---
        this.events = new EventBus();
        this.perf = new PerfMonitor();
        this.throttle = new ThrottleScheduler(50);
        this.state = new StateService(this.securityToken);
        this.modals = new ModalManager();
        this.toast = new NotificationToast();

        // --- Shared state ---
        this.pages = {};
        this.scriptsByFolder = {};
        this._scriptsLoadPromise = null;
        this.buttonState = new WeakMap();
        this.activeSliders = new Set();
        this.activeMutes = new Set();
        this.wakeLock = null;
        this.serverVersion = null;

        // --- DOM refs ---
        this.container = document.getElementById('deck-container');
        this.overlay = document.getElementById('overlay');
        this.overlayContainer = document.getElementById('overlay-container');

        // Wire perf callback
        setQueuePerfCallback((ms) => this.perf.markRender(ms));

        // --- Panel Manager ---
        this.panelManager = new PanelManager({
            container: this.container,
            panelsContainer: document.getElementById('panels-container'),
            panels: {
                mixer: document.getElementById('panel-mixer'),
                discord: document.getElementById('panel-discord'),
                domotica: document.getElementById('panel-domotica'),
                autoclicker: document.getElementById('panel-autoclicker')
            },
            onPanelChange: (panelId, previousPanel) => {
                if (previousPanel === 'mixer' && panelId !== 'mixer') {
                    this.socket.emit('mixer_panel_closed');
                }
                if (panelId === 'mixer' && previousPanel !== 'mixer') {
                    this.socket.emit('mixer_panel_open');
                }
            }
        });

        // --- Shared context for modules ---
        const ctx = {
            socket: this.socket,
            events: this.events,
            panelManager: this.panelManager,
            throttle: this.throttle,
            activeSliders: this.activeSliders,
            activeMutes: this.activeMutes,
            container: this.container,
            overlay: this.overlay,
            overlayContainer: this.overlayContainer,
            buttonStateMap: this.buttonState,
            getPages: () => this.pages,
            getPageData: (id) => this.getPageData(id)
        };

        // --- Carousel Module ---
        this.carousel = new CarouselModule({
            ...ctx,
            onPageChange: (pageId) => {
                this.state.persistAppState({ ui: { lastPage: pageId } });
            },
            onEditToggle: () => this.editMode.toggle(),
            onSettingsOpen: () => this.openSettingsPanel()
        });

        // --- Edit Mode Module ---
        this.editMode = new EditModeModule({
            ...ctx,
            getCurrentPage: () => this.carousel.getCurrentPage(),
            getCarouselIndex: () => this.carousel.getCarouselIndex(),
            getCarouselPages: () => this.carousel.carouselPages,
            renderSlide: (i, d) => this.carousel.renderSlide(i, d),
            invalidateCache: (pageId) => {
                if (pageId) {
                    this.carousel.invalidateCache(pageId);
                } else {
                    this.carousel.clearCache();
                }
            },
            saveConfig: () => this._saveConfig()
        });

        // --- Feature Modules ---
        this.mixer = new MixerModule(ctx);
        this.discord = new DiscordModule(ctx);
        this.domotica = new DomoticaModule(ctx);
        this.autoclicker = new AutoClickerModule(ctx);

        // --- Wire editmode state to carousel ---
        this.events.on('editmode:changed', (active) => {
            this.carousel.setEditMode(active);
        });

        // --- Init ---
        this.init();
    }

    async init() {
        if (shouldUseLowPerformanceMode()) {
            document.body.classList.add('low-perf');
        }

        // Socket listeners
        this.mixer.setupSocketListeners();
        this.discord.setupSocketListeners();
        this.autoclicker.setupSocketListeners();
        this._setupCoreSocketListeners();
        this._setupButtonDelegation();
        this.carousel.setupDelegation();
        this._setupConnectivity();
        this._registerServiceWorker();

        try {
            const fetchOptions = { headers: { 'Authorization': this.securityToken } };

            const res = await fetch('/api/config', fetchOptions);
            if (!res.ok) {
                console.warn(`Auth/network error (Status: ${res.status}). Showing login...`);
                this.container.style.display = 'none';

                // Evitar reintentos automáticos cuando el servidor responde 429.
                // En ese caso, el problema suele ser un token viejo o una sesión
                // del navegador que está generando demasiadas cargas seguidas.
                if (res.status === 429) {
                    this._showRateLimitMessage();
                    return;
                }

                this._requestSecurityToken();
                return;
            }

            const data = await res.json();
            this.pages = data.pages || {};
            this.carousel.setCarouselPages(
                Array.isArray(data.carouselPages) && data.carouselPages.length > 0
                    ? data.carouselPages
                    : ['main']
            );

            // Request initial states
            this.socket.emit('mixer_initial_state');
            this.socket.emit('mixer_bind_commands');
            this.socket.emit('discord_initial_state');

            // Load settings and render
            await this.state.loadSettings();
            const lastPage = this.state.getLastPage();
            if (lastPage && lastPage !== 'main') {
                const idx = this.carousel.carouselPages.indexOf(lastPage);
                if (idx >= 0) this.carousel.carouselIndex = idx;
            }
            this.carousel.initMainGrid();
            this._loadScriptsInBackground(fetchOptions);

        } catch (e) {
            console.error('Error crítico durante la inicialización:', e);
            this.container.style.display = 'none';
            this._requestSecurityToken();
        }
    }

    _showRateLimitMessage() {
        if (document.querySelector('.rate-limit-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'rate-limit-overlay';
        overlay.innerHTML = `
            <div class="auth-card">
                <h2>Stream Deck Pro</h2>
                <p>Se han hecho demasiadas peticiones seguidas. Cierra la pestaña, espera 1 minuto y vuelve a abrir la app.</p>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    // --- Page Data ---
    getPageData(pageId) {
        let pageData = this.pages[pageId];

        if (Array.isArray(pageData) && pageData.length > 0) {
            const anyWithCarpeta = pageData.find(item => item?.payload?.carpeta);
            if (anyWithCarpeta) {
                const carpeta = anyWithCarpeta.payload.carpeta;
                const detected = this.scriptsByFolder?.[carpeta]?.archivos || [];
                const configured = pageData.slice();
                const existingFiles = new Set(configured.filter(i => i.payload?.archivo).map(i => i.payload.archivo));

                detected.forEach(f => {
                    if (!existingFiles.has(f.archivo)) {
                        configured.push({
                            label: f.label, icon: '⚙️',
                            color: 'linear-gradient(145deg, #2980b9, #3498db)',
                            type: 'action', action: 'ejecutar_script_dinamico',
                            payload: { carpeta, archivo: f.archivo },
                            helpText: f.helpText || f.description || ''
                        });
                    }
                });

                for (let i = 0; i < configured.length; i++) {
                    const item = configured[i];
                    if (item?.payload?.archivo) {
                        const found = detected.find(d => d.archivo === item.payload.archivo);
                        if (found?.helpText) {
                            item.helpText = item.helpText || found.helpText || '';
                        }
                    }
                }
                pageData = configured;
            }
        }

        if ((!pageData || pageData.length === 0) && this.scriptsByFolder?.[pageId]) {
            pageData = this.scriptsByFolder[pageId].archivos.map(f => ({
                label: f.label, icon: '⚙️',
                color: 'linear-gradient(145deg, #2980b9, #3498db)',
                type: 'action', action: 'ejecutar_script_dinamico',
                payload: { carpeta: pageId, archivo: f.archivo },
                helpText: f.helpText || f.description || ''
            }));
        }

        return Array.isArray(pageData) ? pageData : [];
    }

    // --- Core socket listeners ---
    _setupCoreSocketListeners() {
        this.socket.on('connect', () => {
            this.socket.emit('mixer_bind_commands');
            this.socket.emit('mixer_initial_state');
            this.socket.emit('discord_initial_state');
            if (this.panelManager.isActive('mixer')) {
                this.socket.emit('mixer_panel_open');
            }
            this.toast.show('Conectado al servidor', 'success', 2000);
        });

        this.socket.on('disconnect', () => {
            this.toast.show('Se ha perdido la conexión', 'error', 0);
        });

        this.socket.on('connect_error', (err) => {
            console.error('Socket Connection Error:', err.message);
            this.toast.show(`Error de conexión: ${err.message}`, 'error');
            if (err.message.includes('Acceso denegado')) {
                localStorage.removeItem('streamdeck_token');
                this._requestSecurityToken();
            }
        });

        this.socket.on('notification', (payload) => {
            if (payload && payload.message) {
                this.toast.show(payload.message, payload.type || 'info', payload.duration || 3000);
            }
        });

        this.socket.on('server_version', (payload) => {
            if (payload && payload.version) {
                if (this.serverVersion && this.serverVersion !== payload.version) {
                    console.log('[Version] Nueva versión detectada, recargando...');
                    window.location.reload(true);
                }
                this.serverVersion = payload.version;
            }
        });
    }

    // --- Button click delegation ---
    _setupButtonDelegation() {
        const onPointerDown = (e) => {
            const btn = e.target.closest('.boton');
            if (!btn || !this.buttonState.has(btn) || this.editMode.isActive()) return;

            const state = this.buttonState.get(btn);
            state.startPos = { x: e.clientX, y: e.clientY };
            state.longPressHandled = false;
            btn.classList.add('pressing');

            state.longPressTimer = setTimeout(async () => {
                if (!this.buttonState.has(btn)) return;
                state.longPressHandled = true;
                if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
                const helpText = getButtonHelpText(state.btnData);
                await this.modals.showInfo(helpText, state.btnData.label || 'Información');
            }, 600);
        };

        const clearTimer = (btn, state) => {
            if (!state) return;
            if (state.longPressTimer) {
                clearTimeout(state.longPressTimer);
                state.longPressTimer = null;
            }
            btn.classList.remove('pressing');
        };

        const onPointerMove = (e) => {
            const btn = e.target.closest('.boton');
            if (!btn || !this.buttonState.has(btn)) return;
            const state = this.buttonState.get(btn);
            if (!state.startPos) return;
            if (Math.hypot(e.clientX - state.startPos.x, e.clientY - state.startPos.y) > 15) {
                clearTimer(btn, state);
                state.startPos = null;
            }
        };

        const onPointerUp = (e) => {
            const btn = e.target.closest('.boton');
            if (!btn || !this.buttonState.has(btn)) return;
            const state = this.buttonState.get(btn);
            const handled = state.longPressHandled;
            clearTimer(btn, state);
            state.startPos = null;
            if (handled) { e.preventDefault(); e.stopPropagation(); }
        };

        const onClick = async (e) => {
            const btn = e.target.closest('.boton');
            if (!btn || !this.buttonState.has(btn)) return;
            const state = this.buttonState.get(btn);
            if (this.editMode.isActive()) return;
            if (state.longPressHandled) {
                state.longPressHandled = false;
                e.preventDefault(); e.stopPropagation();
                return;
            }

            if (navigator.vibrate) navigator.vibrate(50);
            const btnData = state.btnData;

            if (btnData.type === 'folder' || Boolean(btnData.targetPage)) {
                this.carousel.renderGrid(btnData.targetPage || 'main');
            } else if (btnData.type === 'mixer') {
                this._openMixer();
            } else if (btnData.type === 'discord_panel') {
                this._openDiscord();
            } else if (btnData.type === 'domotica_panel') {
                this._openDomotica();
            } else if (btnData.type === 'autoclicker_panel') {
                this._openAutoClicker();
            } else if (btnData.type === 'quick_action') {
                this._processQuickAction(btnData);
            } else if (btnData.type === 'action') {
                if (btnData.action === 'apagar_pc' || btnData.action === 'reiniciar_pc') {
                    const msg = btnData.action === 'apagar_pc'
                        ? 'Se apagará el PC. ¿Deseas continuar?'
                        : 'Se reiniciará el PC. ¿Deseas continuar?';
                    const confirmed = await this.modals.showConfirm(msg, btnData.action === 'apagar_pc' ? 'Apagar equipo' : 'Reiniciar equipo');
                    if (!confirmed) return;
                }

                if (btnData.payload) {
                    this.socket.emit(btnData.action, btnData.payload);
                } else {
                    this.socket.emit(btnData.channel, btnData.action);
                }
            }
        };

        if (this.container) {
            this.container.addEventListener('pointerdown', onPointerDown);
            this.container.addEventListener('pointermove', onPointerMove, { passive: true });
            this.container.addEventListener('pointerup', onPointerUp);
            this.container.addEventListener('pointercancel', onPointerUp);
            this.container.addEventListener('pointerout', onPointerUp);
            this.container.addEventListener('click', onClick);
        }
    }

    // --- Quick Actions Processor ---
    async _processQuickAction(btnData) {
        if (!btnData.sequence || !Array.isArray(btnData.sequence)) {
            this.toast.show('Acción rápida inválida', 'error');
            return;
        }

        const total = btnData.sequence.length;
        this.toast.show(`Ejecutando Macro: ${btnData.label || 'Secuencia'}...`, 'info', 2000);

        for (let i = 0; i < total; i++) {
            const step = btnData.sequence[i];
            
            // Execute step
            if (step.action) {
                if (step.payload) {
                    this.socket.emit(step.action, step.payload);
                } else if (step.channel) {
                    this.socket.emit(step.channel, step.action);
                }
            }

            // Wait for delay if specified and not the last step
            if (step.delay && i < total - 1) {
                await new Promise(resolve => setTimeout(resolve, step.delay));
            } else if (i < total - 1) {
                // Default delay between actions to prevent flooding
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        this.toast.show(`Macro "${btnData.label || 'Secuencia'}" finalizada`, 'success');
    }

    // --- Panel openers ---
    _openMixer() {
        this.carousel.setEditButtonVisibility(false);
        this.mixer.open(
            this.panelManager.panels.mixer,
            () => {
                this.panelManager.hidePanels();
                this.carousel.renderSlide(this.carousel.getCarouselIndex(), 0);
            }
        );
    }

    _openDiscord() {
        this.carousel.setEditButtonVisibility(false);
        this.discord.open(
            this.panelManager.panels.discord,
            () => {
                this.panelManager.hidePanels();
                this.carousel.renderSlide(this.carousel.getCarouselIndex(), 0);
            }
        );
    }

    _openDomotica() {
        this.carousel.setEditButtonVisibility(false);
        this.domotica.open(
            this.panelManager.panels.domotica,
            () => {
                this.panelManager.hidePanels();
                this.carousel.renderSlide(this.carousel.getCarouselIndex(), 0);
            }
        );
    }

    _openAutoClicker() {
        this.carousel.setEditButtonVisibility(false);
        this.autoclicker.open(
            this.panelManager.panels.autoclicker,
            () => {
                this.panelManager.hidePanels();
                this.carousel.renderSlide(this.carousel.getCarouselIndex(), 0);
            }
        );
    }

    // --- Settings panel ---
    openSettingsPanel() {
        if (!this.overlay || !this.overlayContainer) return;
        const settings = this.state.appSettings;
        const isLowPerf = document.body.classList.contains('low-perf');

        this.overlayContainer.innerHTML = `
            <div class="settings-panel glass">
                <div class="settings-header">
                    <div><h2>Ajustes</h2><p>Configura tu Stream Deck Pro desde esta pantalla.</p></div>
                    <button id="settings-close-btn" type="button" class="footer-btn">Cerrar</button>
                </div>
                <div class="settings-content">
                    <label class="settings-row"><span>Modo oscuro</span><input type="checkbox" id="setting-dark-mode" ${settings.darkMode ? 'checked' : ''} /></label>
                    <label class="settings-row"><span>Grid compacto</span><input type="checkbox" id="setting-compact-grid" ${settings.compactGrid ? 'checked' : ''} /></label>
                    <label class="settings-row"><span>Mostrar consejos</span><input type="checkbox" id="setting-show-help" ${settings.showHelpTips ? 'checked' : ''} /></label>
                    <label class="settings-row"><span>Modo rendimiento bajo</span><input type="checkbox" id="setting-low-perf" ${isLowPerf ? 'checked' : ''} /></label>
                </div>
            </div>
        `;

        this.overlayContainer.querySelector('#settings-close-btn')?.addEventListener('click', () => this._closeFolder());
        this.overlayContainer.querySelector('#setting-dark-mode')?.addEventListener('change', (e) => this.state.saveSetting('darkMode', e.target.checked));
        this.overlayContainer.querySelector('#setting-compact-grid')?.addEventListener('change', (e) => this.state.saveSetting('compactGrid', e.target.checked));
        this.overlayContainer.querySelector('#setting-show-help')?.addEventListener('change', (e) => this.state.saveSetting('showHelpTips', e.target.checked));
        this.overlayContainer.querySelector('#setting-low-perf')?.addEventListener('change', (e) => {
            document.body.classList.toggle('low-perf', e.target.checked);
            localStorage.setItem('streamdeck_lowPerf', e.target.checked.toString());
        });

        this.overlay.classList.remove('hidden');
    }

    _closeFolder() {
        this.overlay.classList.add('hidden');
        setTimeout(() => {
            if (this.overlay.classList.contains('hidden')) this.overlayContainer.replaceChildren();
        }, 300);
    }

    // --- Auth ---
    _requestSecurityToken() {
        if (document.querySelector('.auth-overlay')) return;
        const authOverlay = document.createElement('div');
        authOverlay.className = 'auth-overlay';
        authOverlay.innerHTML = `
            <div class="auth-card">
                <h2>Stream Deck Pro</h2>
                <p>🔒 Acceso Protegido: Introduce el Token de Seguridad para continuar.</p>
                <input type="password" class="auth-input" id="auth-password" placeholder="••••••••" autofocus>
                <button class="auth-btn" id="auth-submit">Desbloquear Sistema</button>
                <p id="auth-error-msg" style="display:none;color:#ff7a7a;font-size:.9rem;margin-top:10px;"></p>
            </div>
        `;
        document.body.appendChild(authOverlay);

        const input = document.getElementById('auth-password');
        const submit = document.getElementById('auth-submit');
        const errorMsg = document.getElementById('auth-error-msg');

        const setError = (message) => {
            if (!errorMsg) return;
            errorMsg.textContent = message;
            errorMsg.style.display = message ? 'block' : 'none';
        };

        const doLogin = async () => {
            const token = input.value.replace(/\s+/g, ' ').trim();
            if (!token) {
                setError('Introduce un token válido.');
                return;
            }

            submit.disabled = true;
            submit.textContent = 'Verificando...';
            setError('');

            try {
                const res = await fetch('/api/config', { headers: { 'Authorization': token } });
                if (!res.ok) {
                    let serverMessage = '';
                    try {
                        const body = await res.json();
                        serverMessage = body?.error ? ` (${body.error})` : '';
                    } catch (_) { /* ignore non-json responses */ }

                    if (res.status === 403) {
                        setError(`Token incorrecto. Revisa el valor y vuelve a intentarlo.${serverMessage}`);
                    } else if (res.status === 429) {
                        setError(`Demasiados intentos. Espera 1 minuto e inténtalo de nuevo.${serverMessage}`);
                    } else {
                        setError(`No se pudo validar el acceso (HTTP ${res.status})${serverMessage}.`);
                    }
                    return;
                }

                localStorage.setItem('streamdeck_token', token);
                window.location.reload();
            } catch (error) {
                console.error('Error validando token:', error);
                setError('Error de red al validar token. Verifica conexión con el servidor.');
            } finally {
                submit.disabled = false;
                submit.textContent = 'Desbloquear Sistema';
            }
        };
        submit.addEventListener('click', doLogin);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
        setTimeout(() => input.focus(), 100);
    }

    // --- Connectivity ---
    _setupConnectivity() {
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this._closeFolder(); });
        document.body.addEventListener('click', () => {
            if (!this.wakeLock) this._requestWakeLock();
        }, { once: true });
        document.addEventListener('visibilitychange', () => {
            if (this.wakeLock !== null && document.visibilityState === 'visible') this._requestWakeLock();
        });
    }

    async _requestWakeLock() {
        try {
            if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
        } catch (_) { }
    }

    _registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', async () => {
            try {
                const reg = await navigator.serviceWorker.register('/sw.js');
                if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                console.log('[PWA] Service worker registrado con éxito.');
            } catch (err) {
                console.warn('[PWA] Error registrando service worker:', err);
            }
        });
    }

    _loadScriptsInBackground(fetchOptions) {
        if (this._scriptsLoadPromise) return this._scriptsLoadPromise;
        this._scriptsLoadPromise = fetch('/api/scripts', fetchOptions)
            .then(res => res.ok ? res.json() : {})
            .then(scripts => {
                this.scriptsByFolder = scripts || {};
                this.carousel.clearCache();
                if (this.carousel.carouselPages.includes(this.carousel.getCurrentPage())) {
                    this.carousel.renderSlide(this.carousel.getCarouselIndex(), 0);
                }
            })
            .catch(error => {
                console.warn('No se pudieron cargar scripts en segundo plano:', error);
                this.scriptsByFolder = {};
            });
        return this._scriptsLoadPromise;
    }

    async _saveConfig() {
        try {
            const payload = { carouselPages: this.carousel.carouselPages, pages: this.pages };
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': this.securityToken },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
        } catch (err) {
            console.warn('No se pudo guardar config:', err);
        }
    }
}
