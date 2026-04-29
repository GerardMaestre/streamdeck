const fs = require('fs');
const path = require('path');
const { getDataPath } = require('../utils/utils');

class StateStore {
    constructor(filePath, defaultState = {}) {
        this.filePath = filePath;
        this.state = defaultState;
        this._saveTimer = null;
        this._saving = false;
        this._pendingSave = false;
        this._saveResolvers = [];
        this._SAVE_DEBOUNCE_MS = 500;
        this._ensureDirectory();
    }

    _ensureDirectory() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    async load() {
        try {
            if (!fs.existsSync(this.filePath)) {
                await this._flushToDisk();
                return this.state;
            }
            const raw = await fs.promises.readFile(this.filePath, 'utf8');
            this.state = JSON.parse(raw || '{}');
        } catch (error) {
            console.warn('[StateStore] No se pudo cargar el estado persistido, iniciando con valores vacíos.', error);
            this.state = this.state || {};
        }
        return this.state;
    }

    /** Internal: write to disk immediately (no debounce) */
    async _flushToDisk() {
        if (this._saving) {
            this._pendingSave = true;
            return this.state;
        }
        this._saving = true;
        try {
            const data = JSON.stringify(this.state, null, 4);
            const tempPath = `${this.filePath}.tmp`;
            await fs.promises.writeFile(tempPath, data, 'utf8');
            await fs.promises.rename(tempPath, this.filePath);
        } catch (error) {
            console.error('[StateStore] Error guardando el estado persistido:', error);
        } finally {
            this._saving = false;
            if (this._pendingSave) {
                this._pendingSave = false;
                return this._flushToDisk();
            }
        }
        return this.state;
    }

    /** Debounced save — coalesces rapid writes into a single disk I/O */
    save() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        const savePromise = new Promise((resolve) => {
            this._saveResolvers.push(resolve);
        });

        const resolvePending = () => {
            const resolvers = this._saveResolvers.splice(0);
            resolvers.forEach((resolve) => resolve(this.state));
        };

        this._saveTimer = setTimeout(async () => {
            this._saveTimer = null;
            await this._flushToDisk();
            resolvePending();
        }, this._SAVE_DEBOUNCE_MS);

        return savePromise;
    }

    get(key) {
        if (!key) return this.state;
        return this.state[key];
    }

    set(key, value) {
        this.state[key] = value;
        return this.save();
    }

    merge(key, value) {
        if (!this.state[key] || typeof this.state[key] !== 'object') {
            this.state[key] = {};
        }
        this.state[key] = {
            ...this.state[key],
            ...value
        };
        return this.save();
    }
}

const stateFilePath = getDataPath('data/state.json');
const appStateStore = new StateStore(stateFilePath, {
    ui: {
        lastPage: 'main'
    },
    persistedMixer: {
        masterMute: false,
        sessions: {}
    },
    updatedAt: Date.now()
});

// Load stored state immediately, but do not block server startup.
appStateStore.load().catch(() => {});

module.exports = {
    StateStore,
    appStateStore
};
