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

test('PluginManager persiste y recupera health state', () => {
    const tempDir = makeTempDir();
    const healthFile = path.join(tempDir, 'plugins-health.json');
    const pluginDir = path.join(tempDir, 'persist-bad');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'persist-bad',
        apiVersion: 999,
        entry: 'index.js'
    }, null, 2));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const managerA = new PluginManager({ pluginsDir: tempDir, healthFilePath: healthFile, maxFailures: 2 });
    managerA.loadAll();

    const managerB = new PluginManager({ pluginsDir: tempDir, healthFilePath: healthFile, maxFailures: 2 });
    managerB.loadAll();

    const health = managerB.getHealthSnapshot();
    assert.ok(health.length > 0);
    assert.equal(health[0].pluginId, 'persist-bad');
    assert.ok(['failed', 'blocked'].includes(health[0].status));

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager permite resetear estado de un plugin específico', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'reset-bad');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'reset-bad',
        apiVersion: 999,
        entry: 'index.js'
    }, null, 2));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir, maxFailures: 1 });
    manager.loadAll();

    const before = manager.getHealthSnapshot();
    assert.equal(before[0].status, 'blocked');

    manager.resetPluginState('reset-bad');
    const after = manager.getHealthSnapshot();
    assert.equal(after.length, 0);

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager rechaza plugin con SHA-256 inválido', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'bad-integrity');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'bad-integrity',
        apiVersion: 1,
        entry: 'index.js',
        integrity: { sha256: 'deadbeef' }
    }, null, 2));

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();

    const health = manager.getHealthSnapshot();
    assert.equal(health[0].status, 'failed');
    assert.match(health[0].error, /SHA-256/);

    fs.rmSync(tempDir, { recursive: true, force: true });
});


test('PluginManager expone estado detallado por plugin', () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'detail-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'detail-plugin',
        apiVersion: 1,
        entry: 'index.js'
    }, null, 2));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = {};');

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();

    const detail = manager.getPluginStatus('detail-plugin');
    assert.equal(detail.pluginId, 'detail-plugin');
    assert.equal(detail.loaded, true);
    assert.equal(detail.registry.id, 'detail-plugin');

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager permite disable/enable con persistencia', () => {
    const tempDir = makeTempDir();
    const disabledPath = path.join(tempDir, 'plugins-disabled.json');
    const manager = new PluginManager({ pluginsDir: tempDir, disabledFilePath: disabledPath });

    assert.equal(manager.disablePlugin('p1'), true);
    assert.equal(fs.existsSync(disabledPath), true);

    const manager2 = new PluginManager({ pluginsDir: tempDir, disabledFilePath: disabledPath });
    manager2.loadDisabledPlugins();
    assert.equal(manager2.disabledPlugins.has('p1'), true);

    assert.equal(manager2.enablePlugin('p1'), true);
    assert.equal(manager2.disabledPlugins.has('p1'), false);

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('PluginManager expone métricas p95/p99 por plugin', async () => {
    const tempDir = makeTempDir();
    const pluginDir = path.join(tempDir, 'metrics-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'metrics-plugin',
        apiVersion: 1,
        entry: 'index.js'
    }, null, 2));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = { onLoad() {} };');

    const manager = new PluginManager({ pluginsDir: tempDir });
    manager.loadAll();

    await new Promise((r) => setTimeout(r, 100));
    const metrics = manager.getMetricsSnapshot();
    const loadMetric = metrics.find((m) => m.pluginId === 'metrics-plugin' && m.metric === 'load');

    assert.ok(loadMetric);
    assert.equal(loadMetric.count > 0, true);

    fs.rmSync(tempDir, { recursive: true, force: true });
});
