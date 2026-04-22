const Logger = require("./logger");

function initSocketMonitoring(io) {

    io.use((socket, next) => {
        Logger.socket("CONNECT_ATTEMPT", { id: socket.id, address: socket.handshake.address });
        next();
    });

    io.on("connection", (socket) => {

        Logger.socket("CONNECTED", { id: socket.id });

        socket.onAny((event, ...args) => {
            // No loguear payloads excesivos para evitar bloqueos
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
