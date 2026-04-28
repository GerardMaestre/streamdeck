const net = require('net');

console.log('Intentando conectar a discord-ipc-0...');
const socket = net.createConnection('\\\\?\\pipe\\discord-ipc-0', () => {
    console.log('Conectado al pipe. Enviando handshake...');
    
    const data = JSON.stringify({
      v: 1,
      client_id: '1224210777175511040' // clientId from .env
    });
    
    const len = Buffer.byteLength(data);
    const packet = Buffer.alloc(8 + len);
    packet.writeInt32LE(0, 0); // OPCodes.HANDSHAKE
    packet.writeInt32LE(len, 4);
    packet.write(data, 8, len);
    
    socket.write(packet);
});

socket.on('data', (data) => {
    console.log('Datos recibidos de Discord:', data.toString('utf8', 8)); // Skip header
    socket.end();
});

socket.on('error', (err) => {
    console.error('Error de socket:', err.message);
});

socket.on('end', () => {
    console.log('Socket desconectado por Discord.');
});

setTimeout(() => {
    console.log('Timeout de prueba alcanzado (10s)');
    socket.destroy();
}, 10000);
