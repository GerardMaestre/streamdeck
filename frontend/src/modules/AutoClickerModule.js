/**
 * AutoClickerModule — Panel UI for the AutoClicker feature.
 * Allows configuring position, interval, click type, monitor, and start/stop.
 */
import { createPanelBackButton } from '../ui/ButtonFactory.js';

export class AutoClickerModule {
    constructor(ctx) {
        this.socket = ctx.socket;
        this.panelManager = ctx.panelManager;
        this.state = {
            running: false,
            x: 0, y: 0,
            interval: 100,
            clickType: 'left',
            monitorIndex: 0,
            totalClicks: 0,
            monitors: []
        };
    }

    setupSocketListeners() {
        this.socket.on('autoclicker_state', (s) => {
            this.state = { ...this.state, ...s };
            this._updateUI();
        });

        this.socket.on('autoclicker_position_picked', (pos) => {
            this.state.x = pos.x;
            this.state.y = pos.y;
            this._updateUI();
        });

        this.socket.on('autoclicker_error', (err) => {
            const el = document.getElementById('ac-error');
            if (el) {
                el.textContent = err.message;
                el.style.display = 'block';
                setTimeout(() => { el.style.display = 'none'; }, 4000);
            }
        });
    }

    open(panelEl, onBack) {
        panelEl.className = 'panel-cache-node autoclicker-fullscreen-view';
        panelEl.innerHTML = this._buildHTML();

        this.panelManager.showPanel('autoclicker');

        let backBtn = document.getElementById('panel-back-button');
        if (backBtn) backBtn.remove();
        
        backBtn = createPanelBackButton(() => { 
            this.socket.emit('autoclicker_stop'); // Parar el clicker al salir
            if (onBack) onBack(); 
        });
        backBtn.id = 'panel-back-button';
        backBtn.style.zIndex = '20000'; // Super-top
        document.body.appendChild(backBtn);

        this.socket.emit('autoclicker_get_state');
        this._bindEvents();
    }

    _buildHTML() {
        const s = this.state;
        return `
        <div class="ac-panel" id="ac-panel">
            <div class="ac-header">
                <div class="ac-title-row">
                    <span class="ac-icon">🖱️</span>
                    <h2 class="ac-title">AutoClicker</h2>
                </div>
                <div class="ac-status" id="ac-status">
                    <span class="ac-status-dot ${s.running ? 'active' : ''}"></span>
                    <span id="ac-status-text">${s.running ? 'Activo' : 'Detenido'}</span>
                </div>
            </div>

            <div id="ac-error" class="ac-error" style="display:none;"></div>

            <!-- Position Card -->
            <div class="ac-card">
                <div class="ac-card-header">
                    <span>📍</span> Posición del click
                </div>
                <div class="ac-position-display" id="ac-position">
                    <div class="ac-coord">
                        <span class="ac-coord-label">X</span>
                        <span class="ac-coord-value" id="ac-pos-x">${s.x}</span>
                    </div>
                    <div class="ac-coord">
                        <span class="ac-coord-label">Y</span>
                        <span class="ac-coord-value" id="ac-pos-y">${s.y}</span>
                    </div>
                </div>
                <button class="ac-btn ac-btn-pick" id="ac-btn-pick">
                    🎯 Seleccionar en pantalla
                </button>
            </div>

            <!-- Settings Card -->
            <div class="ac-card">
                <div class="ac-card-header">
                    <span>⚙️</span> Configuración
                </div>

                <div class="ac-setting-row">
                    <label class="ac-setting-label">Intervalo (ms)</label>
                    <div class="ac-setting-control">
                        <input type="range" id="ac-interval" class="ac-range"
                               min="10" max="2000" step="10" value="${s.interval}">
                        <span class="ac-range-value" id="ac-interval-val">${s.interval}ms</span>
                    </div>
                </div>

                <div class="ac-setting-row">
                    <label class="ac-setting-label">Tipo de click</label>
                    <div class="ac-toggle-group" id="ac-click-type">
                        <button class="ac-toggle ${s.clickType === 'left' ? 'active' : ''}" data-value="left">Izquierdo</button>
                        <button class="ac-toggle ${s.clickType === 'right' ? 'active' : ''}" data-value="right">Derecho</button>
                    </div>
                </div>

                <div class="ac-setting-row">
                    <label class="ac-setting-label">Monitor</label>
                    <select class="ac-select" id="ac-monitor">
                        ${(s.monitors || []).map(m =>
                            `<option value="${m.index}" ${m.index === s.monitorIndex ? 'selected' : ''}>${m.label}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>

            <!-- Action Area -->
            <div class="ac-action-area">
                <div class="ac-clicks-counter" id="ac-clicks">
                    <span class="ac-clicks-label">Clicks realizados</span>
                    <span class="ac-clicks-value" id="ac-clicks-val">${s.totalClicks.toLocaleString()}</span>
                </div>
                <button class="ac-btn ac-btn-main ${s.running ? 'ac-btn-stop' : 'ac-btn-start'}" id="ac-btn-toggle">
                    ${s.running ? '⏹ Detener' : '▶ Iniciar'}
                </button>
            </div>
        </div>
        `;
    }

    _bindEvents() {
        const pickBtn = document.getElementById('ac-btn-pick');
        const toggleBtn = document.getElementById('ac-btn-toggle');
        const intervalSlider = document.getElementById('ac-interval');
        const clickTypeGroup = document.getElementById('ac-click-type');
        const monitorSelect = document.getElementById('ac-monitor');

        if (pickBtn) {
            pickBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.socket.emit('autoclicker_pick_position');
                pickBtn.textContent = '⏳ Esperando selección en PC...';
                pickBtn.classList.add('ac-btn-waiting');
            });
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.socket.emit('autoclicker_toggle');
            });
        }

        if (intervalSlider) {
            intervalSlider.addEventListener('input', () => {
                const val = parseInt(intervalSlider.value, 10);
                document.getElementById('ac-interval-val').textContent = val + 'ms';
                this.state.interval = val;
                this._sendConfig();
            });
        }

        if (clickTypeGroup) {
            clickTypeGroup.querySelectorAll('.ac-toggle').forEach(btn => {
                btn.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    clickTypeGroup.querySelectorAll('.ac-toggle').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.state.clickType = btn.dataset.value;
                    this._sendConfig();
                });
            });
        }

        if (monitorSelect) {
            monitorSelect.addEventListener('change', () => {
                this.state.monitorIndex = parseInt(monitorSelect.value, 10);
                this._sendConfig();
            });
        }
    }

    _sendConfig() {
        this.socket.emit('autoclicker_set_config', {
            x: this.state.x,
            y: this.state.y,
            interval: this.state.interval,
            clickType: this.state.clickType,
            monitorIndex: this.state.monitorIndex
        });
    }

    _updateUI() {
        const s = this.state;

        // Status
        const statusDot = document.querySelector('.ac-status-dot');
        const statusText = document.getElementById('ac-status-text');
        if (statusDot) statusDot.classList.toggle('active', s.running);
        if (statusText) statusText.textContent = s.running ? 'Activo' : 'Detenido';

        // Position
        const posX = document.getElementById('ac-pos-x');
        const posY = document.getElementById('ac-pos-y');
        if (posX) posX.textContent = s.x;
        if (posY) posY.textContent = s.y;

        // Pick button reset
        const pickBtn = document.getElementById('ac-btn-pick');
        if (pickBtn) {
            pickBtn.textContent = '🎯 Seleccionar en pantalla';
            pickBtn.classList.remove('ac-btn-waiting');
        }

        // Interval
        const slider = document.getElementById('ac-interval');
        const sliderVal = document.getElementById('ac-interval-val');
        if (slider && !document.activeElement?.isSameNode(slider)) slider.value = s.interval;
        if (sliderVal) sliderVal.textContent = s.interval + 'ms';

        // Clicks counter
        const clicksVal = document.getElementById('ac-clicks-val');
        if (clicksVal) clicksVal.textContent = s.totalClicks.toLocaleString();

        // Toggle button
        const toggleBtn = document.getElementById('ac-btn-toggle');
        if (toggleBtn) {
            toggleBtn.className = `ac-btn ac-btn-main ${s.running ? 'ac-btn-stop' : 'ac-btn-start'}`;
            toggleBtn.innerHTML = s.running ? '⏹ Detener' : '▶ Iniciar';
        }

        // Monitor select
        const monitorSelect = document.getElementById('ac-monitor');
        if (monitorSelect && s.monitors && s.monitors.length > 0) {
            const currentOpts = monitorSelect.options.length;
            if (currentOpts !== s.monitors.length) {
                monitorSelect.innerHTML = s.monitors.map(m =>
                    `<option value="${m.index}" ${m.index === s.monitorIndex ? 'selected' : ''}>${m.label}</option>`
                ).join('');
            }
            monitorSelect.value = s.monitorIndex;
        }
    }
}
