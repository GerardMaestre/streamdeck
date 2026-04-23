const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "../../../logs");

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// --- BUFFERED ASYNC LOGGER ---
// Acumula mensajes en memoria y los escribe a disco periódicamente,
// evitando bloquear el event loop de Node.js en cada evento.
const logBuffers = {};
const FLUSH_INTERVAL_MS = 2000;

function bufferLog(file, data) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${data}\n`;

    if (!logBuffers[file]) logBuffers[file] = [];
    logBuffers[file].push(line);
}

function flushBuffers() {
    for (const file in logBuffers) {
        const lines = logBuffers[file];
        if (!lines || lines.length === 0) continue;

        const content = lines.join("");
        logBuffers[file] = [];

        fs.appendFile(path.join(LOG_DIR, file), content, (err) => {
            if (err) console.error("[Logger] Error escribiendo logs:", err.message);
        });
    }
}

// Flush periódico (no bloquea el event loop)
const flushTimer = setInterval(flushBuffers, FLUSH_INTERVAL_MS);
// No impedir que el proceso se cierre
if (flushTimer.unref) flushTimer.unref();

// Flush final al cerrar
process.on("exit", () => {
    // En exit solo podemos usar sync
    for (const file in logBuffers) {
        const lines = logBuffers[file];
        if (!lines || lines.length === 0) continue;
        try {
            fs.appendFileSync(path.join(LOG_DIR, file), lines.join(""));
        } catch (_) {}
    }
});

const Logger = {
    info: (msg, meta = {}) => {
        console.log("[INFO]", msg, meta);
        bufferLog("app.log", `INFO: ${msg} ${JSON.stringify(meta)}`);
    },

    warn: (msg, meta = {}) => {
        console.warn("[WARN]", msg, meta);
        bufferLog("app.log", `WARN: ${msg} ${JSON.stringify(meta)}`);
    },

    error: (msg, err = null, meta = {}) => {
        console.error("[ERROR]", msg, err);
        bufferLog(
            "errors.log",
            `ERROR: ${msg} | ${err?.stack || err} | ${JSON.stringify(meta)}`
        );
    },

    socket: (event, data) => {
        bufferLog("app.log", `SOCKET: ${event} ${JSON.stringify(data)}`);
    },

    system: (msg) => {
        bufferLog("app.log", `SYSTEM: ${msg}`);
    }
};

module.exports = Logger;
