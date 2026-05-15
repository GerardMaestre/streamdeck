/**
 * SoundboardModule - panel tactil para reproducir audio en el PC.
 */
export class SoundboardModule {
    constructor(ctx) {
        this.socket = ctx.socket;
        this.panelManager = ctx.panelManager;
        this.container = null;
        this.onCloseCallback = null;
        this.soundsList = [];
        this.isLoading = false;
    }

    async open(container, onClose) {
        this.container = container;
        this.onCloseCallback = onClose;

        this.container.innerHTML = `
            <div class="soundboard-view">
                <div class="sb-header">
                    <h2>
                        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h2M3 12h2M12 2v2M12 20v2"/></svg>
                        <span>Soundboard</span>
                    </h2>
                    <div class="sb-controls">
                        <button class="sb-ctrl-btn btn-stop" id="sb-stop-all" type="button">
                            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
                            <span>Parar</span>
                        </button>
                        <button class="sb-ctrl-btn" id="sb-refresh" type="button" title="Actualizar biblioteca">
                            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2"></path><path d="M3 12A9 9 0 0 1 18.5 5.8"></path><path d="M18 2v4h4"></path><path d="M6 22v-4H2"></path></svg>
                        </button>
                        <button class="sb-ctrl-btn" id="sb-open-settings" type="button" title="Salida de audio">
                            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"></path><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        </button>
                    </div>
                </div>

                <div class="sb-grid-container">
                    <div id="soundboard-grid" class="sb-grid" aria-live="polite"></div>
                </div>

                <button id="panel-back-button" class="panel-back-btn" type="button" aria-label="Volver">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                </button>
            </div>
        `;

        this.panelManager.showPanel('soundboard');
        this._setupLocalEvents();
        this.loadSounds();
    }

    _setupLocalEvents() {
        this.container.querySelector('#panel-back-button')?.addEventListener('click', () => {
            this.onCloseCallback?.();
        });

        this.container.querySelector('#sb-stop-all')?.addEventListener('click', () => {
            this.socket.emit('soundboard_stop', {}, (res) => {
                if (!res?.ok) this._toast(res?.error || 'No se pudo detener el audio', 'error');
            });
            if (navigator.vibrate) navigator.vibrate(30);
        });

        this.container.querySelector('#sb-refresh')?.addEventListener('click', () => this.loadSounds());
        this.container.querySelector('#sb-open-settings')?.addEventListener('click', () => this.openDeviceSettings());
    }

    loadSounds() {
        const grid = this.container.querySelector('#soundboard-grid');
        if (!grid || this.isLoading) return;

        this.isLoading = true;
        this._renderEmptyState('Cargando biblioteca...');

        this.socket.emit('soundboard_list', {}, (res) => {
            this.isLoading = false;
            if (res?.ok) {
                this.soundsList = Array.isArray(res.sounds) ? res.sounds : [];
                this.renderGrid();
                return;
            }

            this._renderEmptyState(res?.error || 'Error al conectar con el servidor', true);
        });
    }

    renderGrid() {
        const grid = this.container.querySelector('#soundboard-grid');
        if (!grid) return;
        grid.replaceChildren();

        if (this.soundsList.length === 0) {
            this._renderEmptyState('No se encontraron audios. Coloca archivos .mp3, .wav, .ogg, .aac o .m4a en data/soundboard.');
            return;
        }

        const icons = ['🎵', '🔊', '😂', '💥', '🔥', '🎉', '🚨', '🗣️', '📣'];

        this.soundsList.forEach((sound, idx) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'sb-tile';
            tile.dataset.fileName = sound.fileName || '';

            const icon = document.createElement('div');
            icon.className = 'sb-icon';
            icon.textContent = icons[idx % icons.length];

            const name = document.createElement('div');
            name.className = 'sb-name';
            name.textContent = sound.name || sound.fileName || 'Audio';

            tile.append(icon, name);
            tile.addEventListener('click', () => this._playSound(tile, sound));
            grid.appendChild(tile);
        });
    }

    _playSound(tile, sound) {
        if (navigator.vibrate) navigator.vibrate(40);
        tile.classList.add('playing');
        window.setTimeout(() => tile.classList.remove('playing'), 1000);

        this.socket.emit('soundboard_play', { fileName: sound.fileName }, (res) => {
            if (!res?.ok) {
                tile.classList.remove('playing');
                this._toast(res?.error || 'No se pudo reproducir el audio', 'error');
            }
        });
    }

    _renderEmptyState(message, isError = false) {
        const grid = this.container?.querySelector('#soundboard-grid');
        if (!grid) return;

        const empty = document.createElement('div');
        empty.className = `sb-empty${isError ? ' sb-empty-error' : ''}`;
        empty.textContent = message;
        grid.replaceChildren(empty);
    }

    openDeviceSettings() {
        this.socket.emit('soundboard_get_status', {}, (res) => {
            if (!res?.ok) {
                this._toast(res?.error || 'No se pudieron cargar los dispositivos', 'error');
                return;
            }
            this._openCustomSettingsOverlay(res);
        });
    }

    _openCustomSettingsOverlay(status) {
        const app = window.streamDeck;
        if (!app?.overlay || !app.overlayContainer) return;

        const devices = Array.isArray(status.devices) ? status.devices : [];
        const activeSink = status.currentSinkId || '';

        const panel = document.createElement('div');
        panel.className = 'settings-panel glass sb-settings-panel';

        const header = document.createElement('div');
        header.className = 'settings-header';
        const headerText = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = 'Ruteo de audio';
        const subtitle = document.createElement('p');
        subtitle.textContent = status.supportsSinkSelection
            ? 'Selecciona donde sonara el Soundboard'
            : 'Este motor no permite elegir salida; se usara la salida del sistema';
        headerText.append(title, subtitle);
        header.appendChild(headerText);

        const content = document.createElement('div');
        content.className = 'settings-content';

        const group = document.createElement('div');
        group.className = 'sb-setting-group';

        const label = document.createElement('label');
        label.htmlFor = 'sink-selector-final';
        label.textContent = 'Dispositivo de salida';

        const select = document.createElement('select');
        select.id = 'sink-selector-final';
        select.className = 'sb-select';
        select.disabled = !status.supportsSinkSelection;

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Por defecto del sistema';
        defaultOption.selected = !activeSink;
        select.appendChild(defaultOption);

        devices.forEach((device) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || 'Dispositivo desconocido';
            option.selected = device.deviceId === activeSink;
            select.appendChild(option);
        });

        const hint = document.createElement('p');
        hint.className = 'sb-hint';
        hint.textContent = 'Para sonar en Discord, elige un Virtual Cable aqui y configuralo en Discord como microfono.';

        group.append(label, select, hint);
        content.appendChild(group);

        const footer = document.createElement('div');
        footer.className = 'settings-footer sb-settings-footer';

        const cancel = document.createElement('button');
        cancel.id = 'sb-close-ov';
        cancel.className = 'sb-ctrl-btn';
        cancel.type = 'button';
        cancel.textContent = 'Cancelar';

        const save = document.createElement('button');
        save.id = 'sb-save-ov';
        save.className = 'sb-ctrl-btn sb-primary';
        save.type = 'button';
        save.textContent = 'Aplicar';
        save.disabled = !status.supportsSinkSelection;

        footer.append(cancel, save);
        panel.append(header, content, footer);
        app.overlayContainer.replaceChildren(panel);
        app.overlay.classList.remove('hidden');

        cancel.addEventListener('click', () => app.overlay.classList.add('hidden'));
        save.addEventListener('click', () => {
            this.socket.emit('soundboard_set_device', { deviceId: select.value }, (res) => {
                if (res?.ok) {
                    this._toast('Ruteo de audio actualizado', 'success');
                    app.overlay.classList.add('hidden');
                    return;
                }
                this._toast(res?.error || 'No se pudo guardar el dispositivo', 'error');
            });
        });
    }

    _toast(message, type = 'info') {
        window.streamDeck?.toast?.show(message, type);
    }
}
