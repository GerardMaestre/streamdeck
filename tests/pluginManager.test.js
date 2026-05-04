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
        capabilities: ['demo']
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
