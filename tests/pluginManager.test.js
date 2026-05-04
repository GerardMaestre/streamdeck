const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PluginManager } = require('../backend/core/plugins/pluginManager');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'streamdeck-plugin-test-'));

test('PluginManager carga plugin válido y reporta health loaded', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'good-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'good-plugin',
        apiVersion: 1,
        entry: 'index.js',
        version: '1.2.3',
        capabilities: ['logging']
    }, null, 2));

    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = { onLoad() {} };');

    const manager = new PluginManager({ pluginsDir: tempDir });
    const loaded = manager.loadAll();

    assert.equal(loaded, 1);
    const health = manager.getHealthSnapshot();
    assert.equal(health.length, 1);
    assert.equal(health[0].status, 'loaded');

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager marca failed cuando el plugin es inválido', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'bad-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'bad-plugin',
        apiVersion: 999,
        entry: 'index.js'
    }, null, 2));

    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir });
    const loaded = manager.loadAll();

    assert.equal(loaded, 0);
    const health = manager.getHealthSnapshot();
    assert.equal(health.length, 1);
    assert.equal(health[0].pluginId, 'bad-plugin');
    assert.equal(health[0].status, 'failed');

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager soporta unload y cambia estado a unloaded', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'unload-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'unload-plugin',
        apiVersion: 1,
        entry: 'index.js'
    }, null, 2));

    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = { onUnload() {} };');

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();
    manager.unloadAll();

    const health = manager.getHealthSnapshot();
    assert.equal(health[0].status, 'unloaded');
    assert.equal(manager.getRegistrySnapshot().length, 0);

    fs.rmSync(tempDir, { recursive: true, force: true });
});


test('PluginManager marca disabled cuando enabled=false en manifest', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'off-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'off-plugin',
        apiVersion: 1,
        entry: 'index.js',
        enabled: false
    }, null, 2));

    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir });
    const loaded = manager.loadAll();

    assert.equal(loaded, 0);
    const health = manager.getHealthSnapshot();
    assert.equal(health[0].status, 'disabled');

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager rechaza entrypoint fuera de la carpeta del plugin', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'escape-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'escape-plugin',
        apiVersion: 1,
        entry: '../outside.js'
    }, null, 2));

    fs.writeFileSync(path.join(tempDir, 'outside.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();

    const health = manager.getHealthSnapshot();
    assert.equal(health[0].status, 'failed');
    assert.match(health[0].error, /Entrypoint fuera del directorio/);

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager rechaza IDs duplicados', () => {
    const tempDir = makeTempDir();
    const pluginA = path.join(tempDir, 'plugin-a');
    const pluginB = path.join(tempDir, 'plugin-b');
    fs.mkdirSync(pluginA, { recursive: true });
    fs.mkdirSync(pluginB, { recursive: true });

    const manifest = {
        id: 'duplicate-id',
        apiVersion: 1,
        entry: 'index.js'
    };

    fs.writeFileSync(path.join(pluginA, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(pluginB, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(pluginA, 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(pluginB, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();

    const health = manager.getHealthSnapshot();
    const failed = health.find((x) => x.status === 'failed');
    assert.ok(failed);
    assert.equal(failed.pluginId, 'plugin-b');
    assert.match(failed.error, /ID duplicado/);

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager rechaza capabilities no permitidas', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'bad-capability');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'bad-capability',
        apiVersion: 1,
        entry: 'index.js',
        capabilities: ['root-shell']
    }, null, 2));

    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();

    const health = manager.getHealthSnapshot();
    assert.equal(health[0].status, 'failed');
    assert.match(health[0].error, /capability no permitida/);

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager bloquea plugin tras superar maxFailures', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'always-bad');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'always-bad',
        apiVersion: 999,
        entry: 'index.js'
    }, null, 2));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir, maxFailures: 2 });
    manager.loadAll();
    manager.loadAll();

    const health = manager.getHealthSnapshot();
    assert.equal(health[0].status, 'blocked');
    assert.equal(health[0].failures, 2);

    manager.loadAll();
    const healthAfter = manager.getHealthSnapshot();
    assert.equal(healthAfter[0].failures, 2);

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager reloadAll limpia health previo y recarga', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'reload-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'reload-plugin',
        apiVersion: 1,
        entry: 'index.js',
        capabilities: ['logging']
    }, null, 2));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();
    const reloaded = manager.reloadAll();

    assert.equal(reloaded, 1);
    assert.equal(manager.getRegistrySnapshot().length, 1);

    fs.rmSync(tempDir, { recursive: true, force: true });
});
