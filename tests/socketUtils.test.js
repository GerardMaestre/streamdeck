const test = require('node:test');
const assert = require('node:assert/strict');

const { createSafeSocketHandler } = require('../backend/utils/utils');

test('createSafeSocketHandler separa ack cuando no hay payload', async () => {
    const socket = { emit: () => {} };
    let receivedPayload;
    let receivedAck;
    const ack = () => {};

    const handler = createSafeSocketHandler(socket, 'event', (payload, cb) => {
        receivedPayload = payload;
        receivedAck = cb;
    });

    await handler(ack);

    assert.equal(receivedPayload, undefined);
    assert.equal(receivedAck, ack);
});

test('createSafeSocketHandler devuelve ok false si el handler falla', async () => {
    const emitted = [];
    const socket = { emit: (...args) => emitted.push(args) };
    let ackPayload;
    const originalError = console.error;
    console.error = () => {};

    try {
        const handler = createSafeSocketHandler(socket, 'explode', () => {
            throw new Error('boom');
        });

        await handler({}, (payload) => {
            ackPayload = payload;
        });
    } finally {
        console.error = originalError;
    }

    assert.equal(ackPayload.ok, false);
    assert.match(ackPayload.message, /boom/);
    assert.equal(emitted[0][0], 'server_error');
});
