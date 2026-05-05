const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const Logger = require('../logger/logger');

const PLUGIN_API_VERSION = 1;
const DEFAULT_HOOK_TIMEOUT_MS = 2500;
const ALLOWED_CAPABILITIES = new Set(['logging', 'http', 'iot', 'audio', 'discord', 'automation']);
const HEALTH_SCHEMA_VERSION = 1;

class PluginManager {
    constructor({ pluginsDir, hookTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS, maxFailures = 3, healthFilePath = null, disabledFilePath = null }) {
        if (!pluginsDir || typeof pluginsDir !== 'string') {
            throw new Error('pluginsDir es obligatorio y debe ser string.');
        }

        this.pluginsDir = pluginsDir;
        this.hookTimeoutMs = hookTimeoutMs;
        this.registry = new Map();
        this.health = new Map();
        this.maxFailures = maxFailures;
        this.healthFilePath = healthFilePath;
        this.disabledFilePath = disabledFilePath;
        this.disabledPlugins = new Set();
        this.metrics = new Map();
    }


    loadPersistedHealth() {
        if (!this.healthFilePath || !fs.existsSync(this.healthFilePath)) return;

        try {
            const raw = fs.readFileSync(this.healthFilePath, 'utf8');
            const data = JSON.parse(raw);
            const items = Array.isArray(data) ? data : data?.items;
            if (!Array.isArray(items)) return;

            this.health.clear();
            for (const item of items) {
                if (!item.pluginId) continue;
                const { pluginId, ...status } = item;
                this.health.set(pluginId, status);
            }
        } catch (error) {
            Logger.warn('[Plugins] No se pudo cargar health persistido', error.message);
        }
    }

    persistHealth() {
        if (!this.healthFilePath) return;

        try {
            const payload = JSON.stringify({ schemaVersion: HEALTH_SCHEMA_VERSION, items: this.getHealthSnapshot() }, null, 2);
            fs.mkdirSync(path.dirname(this.healthFilePath), { recursive: true });
            fs.writeFileSync(this.healthFilePath, payload, 'utf8');
        } catch (error) {
            Logger.warn('[Plugins] No se pudo persistir health de plugins', error.message);
        }
    }


    loadDisabledPlugins() {
        if (!this.disabledFilePath || !fs.existsSync(this.disabledFilePath)) return;
        try {
            const raw = fs.readFileSync(this.disabledFilePath, 'utf8');
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return;
            this.disabledPlugins = new Set(data);
        } catch (error) {
            Logger.warn('[Plugins] No se pudo cargar lista de plugins deshabilitados', error.message);
        }
    }

    persistDisabledPlugins() {
        if (!this.disabledFilePath) return;
        try {
            fs.mkdirSync(path.dirname(this.disabledFilePath), { recursive: true });
            fs.writeFileSync(this.disabledFilePath, JSON.stringify(Array.from(this.disabledPlugins), null, 2), 'utf8');
        } catch (error) {
            Logger.warn('[Plugins] No se pudo persistir plugins deshabilitados', error.message);
        }
    }

    disablePlugin(pluginId) {
        if (!pluginId) return false;
        this.disabledPlugins.add(pluginId);
        this.persistDisabledPlugins();
        return true;
    }

    enablePlugin(pluginId) {
        if (!pluginId) return false;
        const existed = this.disabledPlugins.delete(pluginId);
        this.persistDisabledPlugins();
        return existed;
    }


    recordMetric(pluginId, metricName, valueMs) {
        const key = `${pluginId}:${metricName}`;
        const arr = this.metrics.get(key) || [];
        arr.push(valueMs);
        if (arr.length > 100) arr.shift();
        this.metrics.set(key, arr);
    }

    percentile(values, p) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
        return sorted[idx];
    }

    getMetricsSnapshot() {
        const out = [];
        for (const [key, values] of this.metrics.entries()) {
            const [pluginId, metric] = key.split(':');
            out.push({
                pluginId,
                metric,
                count: values.length,
                p95: this.percentile(values, 95),
                p99: this.percentile(values, 99),
            });
        }
        return out;
    }

    ensurePluginsDir() {
        fs.mkdirSync(this.pluginsDir, { recursive: true });
    }

    discoverPluginManifests() {
        this.ensurePluginsDir();
        const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });

        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
                dir: path.join(this.pluginsDir, entry.name),
                manifestPath: path.join(this.pluginsDir, entry.name, 'manifest.json'),
                folderId: entry.name,
            }))
            .filter(({ manifestPath }) => fs.existsSync(manifestPath))
            .sort((a, b) => a.folderId.localeCompare(b.folderId));
    }

    loadPluginDefinition(manifestPath) {
        const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestRaw);

        if (!manifest.id || !manifest.entry) {
            throw new Error('Manifest inválido: se requiere "id" y "entry".');
        }

        if (manifest.apiVersion !== PLUGIN_API_VERSION) {
            throw new Error(`Plugin ${manifest.id} incompatible con API ${PLUGIN_API_VERSION}.`);
        }

        const capabilities = manifest.capabilities || [];
        if (!Array.isArray(capabilities)) {
            throw new Error(`Plugin ${manifest.id} tiene capabilities inválidas.`);
        }

        for (const capability of capabilities) {
            if (!ALLOWED_CAPABILITIES.has(capability)) {
                throw new Error(`Plugin ${manifest.id} usa capability no permitida: ${capability}`);
            }
        }

        return manifest;
    }



    verifyIntegrity(manifest, entrypoint) {
        const expected = manifest?.integrity?.sha256;
        if (!expected) return;

        const content = fs.readFileSync(entrypoint);
        const actual = crypto.createHash('sha256').update(content).digest('hex');
        if (actual !== expected) {
            throw new Error(`Plugin ${manifest.id} falló verificación SHA-256.`);
        }
    }

    validateEntrypointPath(dir, entry) {
        const resolved = path.resolve(dir, entry);
        const root = path.resolve(dir) + path.sep;
        if (!resolved.startsWith(root)) {
            throw new Error(`Entrypoint fuera del directorio del plugin: ${entry}`);
        }
        return resolved;
    }

    invokeHook(plugin, hookName, payload) {
        const hook = plugin.instance?.[hookName];
        if (typeof hook !== 'function') return Promise.resolve();

        const start = Date.now();
        return new Promise((resolve, reject) => {
            const worker = new Worker(path.join(__dirname, 'hookWorker.js'), {
                workerData: {
                    pluginEntrypoint: plugin.entrypoint,
                    hookName,
                    payload,
                },
            });

            const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error(`Hook timeout (${hookName}) en plugin ${plugin.id}`));
            }, this.hookTimeoutMs);

            worker.on('message', (msg) => {
                clearTimeout(timeout);
                worker.terminate();
                const elapsed = Date.now() - start;
                this.recordMetric(plugin.id, hookName, elapsed);
                if (msg.ok) return resolve();
                return reject(new Error(msg.error || `Hook ${hookName} falló`));
            });

            worker.on('error', (err) => {
                clearTimeout(timeout);
                worker.terminate();
                const elapsed = Date.now() - start;
                this.recordMetric(plugin.id, hookName, elapsed);
                reject(err);
            });
        });
    }

    registerPlugin({ dir, manifest }) {
        if (this.registry.has(manifest.id)) {
            throw new Error(`ID duplicado detectado: ${manifest.id}`);
        }

        const pluginEntrypoint = this.validateEntrypointPath(dir, manifest.entry);
        if (!fs.existsSync(pluginEntrypoint)) {
            throw new Error(`No existe entrypoint: ${pluginEntrypoint}`);
        }

        this.verifyIntegrity(manifest, pluginEntrypoint);

        // eslint-disable-next-line global-require, import/no-dynamic-require
        const pluginModule = require(pluginEntrypoint);
        const plugin = {
            id: manifest.id,
            name: manifest.name || manifest.id,
            version: manifest.version || '0.0.0',
            apiVersion: manifest.apiVersion,
            capabilities: manifest.capabilities || [],
            instance: pluginModule,
            dir,
            entrypoint: pluginEntrypoint,
        };

        this.registry.set(plugin.id, plugin);
        this.health.set(plugin.id, { loadedAt: Date.now(), status: 'loaded' });
        return plugin;
    }

    markAsFailed(pluginId, error) {
        const prev = this.health.get(pluginId) || {};
        const failures = (prev.failures || 0) + 1;
        const status = failures >= this.maxFailures ? 'blocked' : 'failed';

        this.health.set(pluginId, {
            loadedAt: Date.now(),
            status,
            failures,
            error: error.message,
        });
        this.persistHealth();
    }

    loadAll() {
        this.loadPersistedHealth();
        this.loadDisabledPlugins();
        const manifests = this.discoverPluginManifests();

        for (const item of manifests) {
            const pluginId = item.folderId;
            try {
                const blockedState = this.health.get(pluginId);
                if (blockedState && blockedState.status === 'blocked') {
                    Logger.warn(`[Plugins] Plugin bloqueado por fallos previos: ${pluginId}`);
                    continue;
                }

                const manifest = this.loadPluginDefinition(item.manifestPath);
                if (manifest.enabled === false || this.disabledPlugins.has(manifest.id)) {
                    this.health.set(manifest.id, {
                        loadedAt: Date.now(),
                        status: 'disabled',
                    });
                    Logger.info(`[Plugins] Plugin deshabilitado por manifest: ${manifest.id}`);
                    this.persistHealth();
                    continue;
                }

                const loadStart = Date.now();
                const plugin = this.registerPlugin({ dir: item.dir, manifest });
                this.invokeHook(plugin, 'onLoad', { plugin })
                    .catch((error) => this.markAsFailed(plugin.id, error));
                this.recordMetric(plugin.id, 'load', Date.now() - loadStart);
                Logger.info(`[Plugins] Plugin cargado: ${plugin.id}@${plugin.version}`);
            } catch (error) {
                this.markAsFailed(pluginId, error);
                Logger.warn(`[Plugins] Error al cargar plugin (${item.manifestPath})`, error.message);
            }
        }

        this.persistHealth();
        Logger.info(`[Plugins] Total cargados: ${this.registry.size}`);
        return this.registry.size;
    }

    unloadAll() {
        for (const plugin of this.registry.values()) {
            try {
                this.invokeHook(plugin, 'onUnload', { plugin })
                    .catch((error) => this.markAsFailed(plugin.id, error));
                this.health.set(plugin.id, {
                    ...this.health.get(plugin.id),
                    unloadedAt: Date.now(),
                    status: 'unloaded',
                });
            } catch (error) {
                this.markAsFailed(plugin.id, error);
            }
        }

        this.registry.clear();
        this.persistHealth();
    }


    resetPluginState(pluginId) {
        if (!pluginId) {
            this.health.clear();
            this.persistHealth();
            return;
        }

        this.health.delete(pluginId);
        this.persistHealth();
    }

    reloadAll() {
        this.unloadAll();
        this.resetPluginState();
        return this.loadAll();
    }

    getHealthSnapshot() {
        return Array.from(this.health.entries()).map(([pluginId, status]) => ({ pluginId, ...status }));
    }


    getSummary() {
        const statuses = this.getHealthSnapshot().reduce((acc, item) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
        }, {});

        return {
            totalDiscovered: this.getHealthSnapshot().length,
            totalLoaded: this.registry.size,
            statuses,
        };
    }


    getPluginStatus(pluginId) {
        if (!pluginId) return null;
        const health = this.getHealthSnapshot().find((item) => item.pluginId === pluginId) || null;
        const registry = this.getRegistrySnapshot().find((item) => item.id === pluginId) || null;

        return {
            pluginId,
            health,
            registry,
            loaded: Boolean(registry),
        };
    }

    getRegistrySnapshot() {
        return Array.from(this.registry.values()).map((plugin) => ({
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            apiVersion: plugin.apiVersion,
            capabilities: plugin.capabilities,
        }));
    }
}

module.exports = {
    PluginManager,
    PLUGIN_API_VERSION,
    DEFAULT_HOOK_TIMEOUT_MS,
    ALLOWED_CAPABILITIES,
    HEALTH_SCHEMA_VERSION,
};
