const Logger = require("./logger");

// Eventos de alta frecuencia que NO deben loguearse (generan hasta 20/s durante uso del mixer)
const HIGH_FREQ_EVENTS = new Set([
    'set_master_volume',
    'set_session_volume',
    'discord_set_user_volume',
    'tuya_command',
    'ping',
    'mixer_initial_state'
]);

function initSocketMonitoring(io) {

    io.use((socket, next) => {
        Logger.socket("CONNECT_ATTEMPT", { id: socket.id, address: socket.handshake.address });
        next();
    });

    io.on("connection", (socket) => {

        Logger.socket("CONNECTED", { id: socket.id });

        socket.onAny((event, ...args) => {
            // Filtrar eventos de alta frecuencia para evitar saturar el logger
            if (HIGH_FREQ_EVENTS.has(event)) return;

            const data = args.length > 0 ? args[0] : null;
            Logger.socket(event, data);
        });

        socket.on("disconnect", (reason) => {
            Logger.socket("DISCONNECT", { id: socket.id, reason });
        });
    });

    Logger.system("Socket monitoring enabled");
}

module.exports = initSocketMonitoring;
