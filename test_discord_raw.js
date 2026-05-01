const net = require('net');
const clientId = '1152291774610546688';

const OPCodes = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function encode(op, data) {
    data = JSON.stringify(data);
    const len = Buffer.byteLength(data);
    const packet = Buffer.alloc(8 + len);
    packet.writeInt32LE(op, 0);
    packet.writeInt32LE(len, 4);
    packet.write(data, 8, len);
    return packet;
}

// Test path WRONG (actual discord-rpc uses): \\?\pipe\discord-ipc-0
const wrongPath = `\\\\?\\pipe\\discord-ipc-0`;
// Test path CORRECT: \\.\pipe\discord-ipc-0
const rightPath = `\\\\.\\pipe\\discord-ipc-0`;

console.log('Testing WRONG path (\\\\?\\\\):', wrongPath);
const s1 = net.createConnection(wrongPath, () => {
    console.log('[WRONG PATH] Connected!');
    s1.write(encode(OPCodes.HANDSHAKE, { v: 1, client_id: clientId }), (err) => {
        if (err) console.log('[WRONG PATH] Write error:', err.message);
        else console.log('[WRONG PATH] Write OK - waiting for response...');
    });
});
s1.on('data', d => console.log('[WRONG PATH] Got data:', d.slice(8).toString()));
s1.on('error', e => console.log('[WRONG PATH] Error:', e.message));
s1.on('close', () => console.log('[WRONG PATH] Closed'));
setTimeout(() => s1.destroy(), 4000);

setTimeout(() => {
    console.log('\nTesting CORRECT path (\\\\.\\\\):', rightPath);
    const s2 = net.createConnection(rightPath, () => {
        console.log('[CORRECT PATH] Connected!');
        s2.write(encode(OPCodes.HANDSHAKE, { v: 1, client_id: clientId }), (err) => {
            if (err) console.log('[CORRECT PATH] Write error:', err.message);
            else console.log('[CORRECT PATH] Write OK - waiting for response...');
        });
    });
    s2.on('data', d => {
        try {
            const op = d.readInt32LE(0);
            const msg = d.slice(8).toString();
            console.log('[CORRECT PATH] Got data opcode:', op, '| msg:', msg);
        } catch(e) {}
    });
    s2.on('error', e => console.log('[CORRECT PATH] Error:', e.message));
    s2.on('close', () => console.log('[CORRECT PATH] Closed'));
    setTimeout(() => s2.destroy(), 5000);
}, 4500);
