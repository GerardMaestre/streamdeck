const fs = require('fs');
const path = require('path');
const { getDataPath } = require('../utils/utils');

class StateStore {
    constructor(filePath, defaultState = {}) {
        this.filePath = filePath;
        this.state = defaultState;
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
                await this.save();
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

    async save() {
        try {
            await fs.promises.writeFile(this.filePath, JSON.stringify(this.state, null, 4), 'utf8');
        } catch (error) {
            console.error('[StateStore] Error guardando el estado persistido:', error);
        }
        return this.state;
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
