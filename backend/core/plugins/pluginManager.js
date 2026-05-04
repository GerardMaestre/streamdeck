const fs = require('fs');
const path = require('path');
const Logger = require('../logger/logger');

const PLUGIN_API_VERSION = 1;
const DEFAULT_HOOK_TIMEOUT_MS = 2500;

class PluginManager {
    constructor({ pluginsDir, hookTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS }) {
        if (!pluginsDir || typeof pluginsDir !== 'string') {
            throw new Error('pluginsDir es obligatorio y debe ser string.');
        }

        this.pluginsDir = pluginsDir;
        this.hookTimeoutMs = hookTimeoutMs;
        this.registry = new Map();
        this.health = new Map();
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
            .filter(({ manifestPath }) => fs.existsSync(manifestPath));
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

        return manifest;
    }

    invokeHook(plugin, hookName, payload) {
        const hook = plugin.instance?.[hookName];
        if (typeof hook !== 'function') return;

        const start = Date.now();
        hook(payload);
        const elapsed = Date.now() - start;

        if (elapsed > this.hookTimeoutMs) {
            Logger.warn(`[Plugins] Hook ${hookName} de ${plugin.id} superó timeout`, `${elapsed}ms`);
        }
    }

    registerPlugin({ dir, manifest }) {
        const pluginEntrypoint = path.join(dir, manifest.entry);
        if (!fs.existsSync(pluginEntrypoint)) {
            throw new Error(`No existe entrypoint: ${pluginEntrypoint}`);
        }

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
        };

        this.registry.set(plugin.id, plugin);
        this.health.set(plugin.id, { loadedAt: Date.now(), status: 'loaded' });
        return plugin;
    }

    markAsFailed(pluginId, error) {
        this.health.set(pluginId, {
            loadedAt: Date.now(),
            status: 'failed',
            error: error.message,
        });
    }

    loadAll() {
        const manifests = this.discoverPluginManifests();

        for (const item of manifests) {
            const pluginId = item.folderId;
            try {
                const manifest = this.loadPluginDefinition(item.manifestPath);
                if (manifest.enabled === false) {
                    this.health.set(manifest.id, {
                        loadedAt: Date.now(),
                        status: 'disabled',
                    });
                    Logger.info(`[Plugins] Plugin deshabilitado por manifest: ${manifest.id}`);
                    continue;
                }

                const plugin = this.registerPlugin({ dir: item.dir, manifest });
                this.invokeHook(plugin, 'onLoad', { logger: Logger, plugin });
                Logger.info(`[Plugins] Plugin cargado: ${plugin.id}@${plugin.version}`);
            } catch (error) {
                this.markAsFailed(pluginId, error);
                Logger.warn(`[Plugins] Error al cargar plugin (${item.manifestPath})`, error.message);
            }
        }

        Logger.info(`[Plugins] Total cargados: ${this.registry.size}`);
        return this.registry.size;
    }

    unloadAll() {
        for (const plugin of this.registry.values()) {
            try {
                this.invokeHook(plugin, 'onUnload', { logger: Logger, plugin });
                this.health.set(plugin.id, {
                    ...this.health.get(plugin.id),
                    unloadedAt: Date.now(),
                    status: 'unloaded',
                });
            } catch (error) {
                this.markAsFailed(plugin.id, error);
            }
        }
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
};
