/**
 * StateService — Centralized state management + debounced persistence.
 */
import { debounce } from '../utils/throttle.js';

export class StateService {
    constructor(securityToken) {
        this.securityToken = securityToken;
        this.appState = {
            ui: { lastPage: 'main' },
            persistedMixer: {}
        };
        this.appSettings = {
            darkMode: false,
            compactGrid: false,
            showHelpTips: true
        };

        this._persistDebounced = debounce((state) => {
            this._flushPersist(state);
        }, 800);
    }

    /** Load settings from localStorage + server */
    async loadSettings() {
        this.appSettings = {
            darkMode: localStorage.getItem('streamdeck_dark_mode') === 'true',
            compactGrid: localStorage.getItem('streamdeck_compact_grid') === 'true',
            showHelpTips: localStorage.getItem('streamdeck_show_help_tips') !== 'false'
        };
        document.body.classList.toggle('dark-mode', this.appSettings.darkMode);
        document.body.classList.toggle('compact-grid', this.appSettings.compactGrid);

        try {
            const res = await fetch('/api/app-state', {
                headers: {
                    'Authorization': this.securityToken,
                    'Content-Type': 'application/json'
                }
            });
            if (res.ok) {
                const appState = await res.json();
                if (appState && typeof appState === 'object') {
                    this.appState = appState;
                }
            }
        } catch (error) {
            console.warn('No se pudo recuperar el estado persistido del servidor:', error);
        }
    }

    /** Save a single setting to localStorage + apply CSS class */
    saveSetting(key, value) {
        this.appSettings[key] = value;
        localStorage.setItem(`streamdeck_${key}`, value.toString());
        if (key === 'darkMode') document.body.classList.toggle('dark-mode', value);
        if (key === 'compactGrid') document.body.classList.toggle('compact-grid', value);
    }

    /** Merge state and persist to server (debounced 800ms) */
    persistAppState(payload = {}) {
        if (!payload || typeof payload !== 'object') return;
        this.appState = {
            ...this.appState,
            ...payload,
            updatedAt: Date.now()
        };
        this._persistDebounced(this.appState);
    }

    /** Internal: actually flush the state to the server */
    async _flushPersist(state) {
        try {
            await fetch('/api/app-state', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.securityToken
                },
                body: JSON.stringify(state)
            });
        } catch (error) {
            console.warn('No se pudo persistir el estado de la app:', error);
        }
    }

    getLastPage() {
        return this.appState?.ui?.lastPage || 'main';
    }
}
