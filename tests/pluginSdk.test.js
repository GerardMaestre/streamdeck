const test = require('node:test');
const assert = require('node:assert/strict');

const { definePlugin, defineManifest } = require('../sdk/plugin-sdk');

test('definePlugin retorna objeto plugin válido', () => {
    const plugin = definePlugin({ onLoad() {} });
    assert.equal(typeof plugin.onLoad, 'function');
});

test('defineManifest valida campos requeridos', () => {
    const manifest = defineManifest({ id: 'x-plugin', entry: 'index.js', apiVersion: 1 });
    assert.equal(manifest.id, 'x-plugin');
});
