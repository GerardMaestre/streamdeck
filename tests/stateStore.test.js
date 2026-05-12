const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { StateStore } = require('../backend/data/state-store');

const createStore = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-store-test-'));
    const filePath = path.join(dir, 'state.json');
    const store = new StateStore(filePath, { ui: { lastPage: 'main' } });
    store._SAVE_DEBOUNCE_MS = 1;
    return store;
};

test('merge lanza error con null', async () => {
    const store = createStore();
    assert.throws(() => store.merge('ui', null), TypeError);
});

test('merge lanza error con array', async () => {
    const store = createStore();
    assert.throws(() => store.merge('ui', ['a']), TypeError);
});

test('merge lanza error con string', async () => {
    const store = createStore();
    assert.throws(() => store.merge('ui', 'texto'), TypeError);
});

test('merge combina correctamente con objeto válido', async () => {
    const store = createStore();
    await store.merge('ui', { theme: 'dark' });

    assert.deepEqual(store.get('ui'), {
        lastPage: 'main',
        theme: 'dark'
    });
});
