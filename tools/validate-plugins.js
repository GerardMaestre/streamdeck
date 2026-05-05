const fs = require('fs');
const path = require('path');
const { PLUGIN_API_VERSION, ALLOWED_CAPABILITIES } = require('../backend/core/plugins/pluginManager');

const pluginsRoot = path.join(process.cwd(), 'plugins');

function fail(message) {
    console.error(`[plugin:validate] ${message}`);
    process.exitCode = 1;
}

function validateManifest(manifest, folder) {
    const required = ['id', 'apiVersion', 'entry'];
    for (const key of required) {
        if (!manifest[key]) {
            fail(`${folder}: falta campo requerido "${key}"`);
            return;
        }
    }

    if (manifest.apiVersion !== PLUGIN_API_VERSION) {
        fail(`${folder}: apiVersion ${manifest.apiVersion} incompatible (esperado ${PLUGIN_API_VERSION})`);
    }

    if (typeof manifest.id !== 'string' || manifest.id.trim().length < 3) {
        fail(`${folder}: id inválido`);
    }

    if (typeof manifest.entry !== 'string' || manifest.entry.includes('..')) {
        fail(`${folder}: entry inválido`);
    }

    const capabilities = manifest.capabilities || [];
    if (!Array.isArray(capabilities)) {
        fail(`${folder}: capabilities debe ser un array`);
    }

    for (const capability of capabilities) {
        if (!ALLOWED_CAPABILITIES.has(capability)) {
            fail(`${folder}: capability no permitida (${capability})`);
        }
    }
}


function run() {
    if (!fs.existsSync(pluginsRoot)) {
        console.log('[plugin:validate] No existe carpeta plugins/. Nada que validar.');
        return;
    }

    const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    const seen = new Set();

    for (const entry of entries) {
        const folder = entry.name;
        const manifestPath = path.join(pluginsRoot, folder, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            fail(`${folder}: no existe manifest.json`);
            continue;
        }

        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            validateManifest(manifest, folder);

            if (seen.has(manifest.id)) {
                fail(`${folder}: id duplicado "${manifest.id}"`);
            }
            seen.add(manifest.id);

            const entryPath = path.join(pluginsRoot, folder, manifest.entry);
            if (!fs.existsSync(entryPath)) {
                fail(`${folder}: entry no existe (${manifest.entry})`);
            }
        } catch (error) {
            fail(`${folder}: manifest inválido (${error.message})`);
        }
    }

    if (!process.exitCode) {
        console.log('[plugin:validate] OK');
    }
}

run();
