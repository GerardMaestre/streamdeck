const net = require('net');

// Send proper handshake to Discord IPC pipe and read response
const pipePath = '\\\\.\\pipe\\discord-ipc-0';
const clientId = '1152291774610546688';

const socket = net.connect(pipePath, () => {
    console.log('[+] Connected to Discord IPC pipe!');

    // Discord IPC protocol: opcode 0 = HANDSHAKE, 1 = FRAME
    const payload = JSON.stringify({ v: 1, client_id: clientId });
    const buf = Buffer.alloc(8 + payload.length);
    buf.writeInt32LE(0, 0); // opcode 0 = HANDSHAKE
    buf.writeInt32LE(payload.length, 4);
    buf.write(payload, 8);

    console.log('[>] Sending handshake with client_id:', clientId);
    socket.write(buf);
});

let data = Buffer.alloc(0);
socket.on('data', (chunk) => {
    data = Buffer.concat([data, chunk]);
    if (data.length >= 8) {
        const opcode = data.readInt32LE(0);
        const length = data.readInt32LE(4);
        if (data.length >= 8 + length) {
            const msg = data.slice(8, 8 + length).toString('utf8');
            console.log('[<] Opcode:', opcode, '| Response:', msg);
            socket.end();
        }
    }
});

socket.on('error', (e) => console.error('[!] Error:', e.message));
socket.on('close', () => console.log('[-] Connection closed'));

setTimeout(() => {
    console.log('[!] Timeout after 5s');
    socket.destroy();
}, 5000);
