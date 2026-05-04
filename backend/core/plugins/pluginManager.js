const fs = require('fs');
const path = require('path');
const Logger = require('../logger/logger');

const PLUGIN_API_VERSION = 1;

class PluginManager {
    constructor({ pluginsDir }) {
        this.pluginsDir = pluginsDir;
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

    registerPlugin({ dir, manifest }) {
        const pluginEntrypoint = path.join(dir, manifest.entry);
        if (!fs.existsSync(pluginEntrypoint)) {
            throw new Error(`No existe entrypoint: ${pluginEntrypoint}`);
        }

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

    loadAll() {
        const manifests = this.discoverPluginManifests();

        for (const item of manifests) {
            try {
                const manifest = this.loadPluginDefinition(item.manifestPath);
                const plugin = this.registerPlugin({ dir: item.dir, manifest });

                if (typeof plugin.instance.onLoad === 'function') {
                    plugin.instance.onLoad({ logger: Logger, plugin });
                }

                Logger.info(`[Plugins] Plugin cargado: ${plugin.id}@${plugin.version}`);
            } catch (error) {
                Logger.warn(`[Plugins] Error al cargar plugin (${item.manifestPath})`, error.message);
            }
        }

        Logger.info(`[Plugins] Total cargados: ${this.registry.size}`);
        return this.registry.size;
    }

    getHealthSnapshot() {
        return Array.from(this.health.entries()).map(([pluginId, status]) => ({ pluginId, ...status }));
    }
}

module.exports = {
    PluginManager,
    PLUGIN_API_VERSION,
};
