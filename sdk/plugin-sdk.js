function definePlugin(plugin) {
    if (!plugin || typeof plugin !== 'object') {
        throw new Error('Plugin inválido');
    }
    return plugin;
}

function defineManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('Manifest inválido');
    }
    if (!manifest.id || !manifest.entry || !manifest.apiVersion) {
        throw new Error('Manifest requiere id, entry y apiVersion');
    }
    return manifest;
}

module.exports = {
    definePlugin,
    defineManifest,
};
