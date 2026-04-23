const Logger = require("./logger");

function initGlobalErrorTracking() {

    // Errores JS no controlados
    process.on("uncaughtException", (error) => {
        const isDiscordRpcError = error?.message?.includes('Cannot read properties of null') || error?.stack?.includes('discord-rpc');
        if (isDiscordRpcError) {
            // Ignorar fallos internos de discord-rpc que no afectan al flujo principal
            return;
        }
        Logger.error("UNCAUGHT EXCEPTION", error);
    });

    // Promesas sin catch
    process.on("unhandledRejection", (reason) => {
        const message = reason?.message || String(reason);
        if (message.includes('write AFTER end') || message.includes('null (reading \'write\')')) return;
        Logger.error("UNHANDLED REJECTION", reason);
    });

    // Electron crash safety
    process.on("exit", (code) => {
        Logger.system(`Process exit: ${code}`);
    });

    Logger.system("Error tracking initialized");
}

module.exports = initGlobalErrorTracking;
