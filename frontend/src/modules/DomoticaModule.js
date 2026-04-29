/**
 * DomoticaModule — Smart home (Tuya) panel: light toggle, brightness fader.
 */
import { createFaderController, setThumbTransform } from '../ui/FaderFactory.js';
import { createPanelBackButton } from '../ui/ButtonFactory.js';

export class DomoticaModule {
    constructor(ctx) {
        this.socket = ctx.socket;
        this.events = ctx.events;
        this.panelManager = ctx.panelManager;
        this.throttle = ctx.throttle;

        this.tuyaDevices = ["bf02a8f057179a10753ram", "bf63d2743895e42709akue", "bf9d385783be51f82cef86"];

        const savedIntensity = localStorage.getItem('lastTuyaIntensity');
        this.lastTuyaIntensity = savedIntensity ? parseInt(savedIntensity) : 100;

        this._faderCtrl = null;
    }

    /** Open the domotica panel */
    open(domoPanelEl, onBack) {
        if (!domoPanelEl.innerHTML) {
            domoPanelEl.className = 'panel-cache-node domotica-sketch-match-view';
            domoPanelEl.innerHTML = `
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

            domoPanelEl.appendChild(createPanelBackButton(() => {
                if (onBack) onBack();
            }));

            const faderTrack = domoPanelEl.querySelector('.fader-track-pro');
            const faderFill = domoPanelEl.querySelector('.fader-fill-pro');
            const faderThumb = domoPanelEl.querySelector('.fader-thumb-pro');
            const controlGrid = domoPanelEl.querySelector('.domotica-sketch-grid');

            // Control buttons
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

            // Brightness fader via FaderFactory
            this._faderCtrl = createFaderController({
                track: faderTrack,
                fill: faderFill,
                thumb: faderThumb,
                isDomo: true,
                initialPercent: this.lastTuyaIntensity,
                captureTarget: faderThumb,
                onValueChange: (_smooth, rounded) => {
                    const percent = Math.max(1, Math.min(100, rounded));
                    if (percent === this.lastTuyaIntensity) return;
                    this.lastTuyaIntensity = percent;
                    this._emitBrightness(percent);
                },
                onDragEnd: () => {
                    localStorage.setItem('lastTuyaIntensity', this.lastTuyaIntensity);
                }
            });
        }

        // Asegurar que el botón de atrás siempre esté presente
        if (!document.getElementById('panel-back-button')) {
            domoPanelEl.appendChild(createPanelBackButton(() => {
                if (onBack) onBack();
            }));
        }

        this.panelManager.showPanel('domotica');

        if (this._faderCtrl) {
            requestAnimationFrame(() => {
                this._faderCtrl.setPercent(this.lastTuyaIntensity, true);
            });
        }
    }

    _emitBrightness(percent) {
        const tuyaVal = Math.round(10 + (percent / 100) * 990);
        this.throttle.schedule('tuya_brightness', () => {
            this.socket.emit('tuya_command', {
                deviceIds: this.tuyaDevices,
                code: 'bright_value_v2',
                value: tuyaVal
            });
        }, 350);
    }

    destroy() {
        if (this._faderCtrl) {
            this._faderCtrl.destroy();
            this._faderCtrl = null;
        }
    }
}
