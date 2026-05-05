const test = require('node:test');
const assert = require('node:assert/strict');

const openPath = require.resolve('open');
const appControllerPath = require.resolve('../backend/launcher/appController');

test('un destino ejecuta una sola llamada a open', async () => {
    const openCalls = [];
    const openMock = async (...args) => {
        openCalls.push(args);
    };

    const originalOpen = require.cache[openPath];
    require.cache[openPath] = { exports: openMock };
    delete require.cache[appControllerPath];

    const { abrirAplicacionOWeb } = require('../backend/launcher/appController');

    try {
        await abrirAplicacionOWeb('youtube');
    } finally {
        delete require.cache[appControllerPath];
        if (originalOpen) {
            require.cache[openPath] = originalOpen;
        } else {
            delete require.cache[openPath];
        }
    }

    assert.equal(openCalls.length, 1);
    assert.deepEqual(openCalls[0], ['https://www.youtube.com']);
});
