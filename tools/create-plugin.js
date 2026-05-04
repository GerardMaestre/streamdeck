const fs = require('fs');
const path = require('path');
const { PLUGIN_API_VERSION } = require('../backend/core/plugins/pluginManager');

const pluginName = process.argv[2];
if (!pluginName) {
    console.error('Uso: npm run plugin:create -- <plugin-id>');
    process.exit(1);
}

const safeId = pluginName.trim().toLowerCase().replace(/\s+/g, '-');
if (!/^[a-z0-9-]{3,}$/.test(safeId)) {
    console.error('plugin-id inválido. Usa [a-z0-9-] y mínimo 3 caracteres.');
    process.exit(1);
}

const dir = path.join(process.cwd(), 'plugins', safeId);
if (fs.existsSync(dir)) {
    console.error(`Ya existe: ${dir}`);
    process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });

const manifest = {
    id: safeId,
    name: safeId,
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    entry: 'index.js',
    capabilities: []
};

fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = {\n  onLoad({ logger, plugin }) {\n    logger.info(\`[Plugin:${safeId}] loaded\`);\n  },\n\n  onUnload({ logger, plugin }) {\n    logger.info(\`[Plugin:${safeId}] unloaded\`);\n  }\n};\n`);

console.log(`Plugin creado en: ${dir}`);
