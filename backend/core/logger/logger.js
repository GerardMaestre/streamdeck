const fs = require("fs");
const path = require("path");

const { getDataPath } = require("../../utils/utils");

const LOG_DIR = getDataPath("logs");
console.log(`[Logger] Directorio de logs resuelto a: ${LOG_DIR}`);

const SENSITIVE_KEYS = new Set(["token", "password", "secret", "authorization"]);

const isPlainObject = (value) => Object.prototype.toString.call(value) === "[object Object]";

const redactSensitiveValue = (key, value) => {
    if (!SENSITIVE_KEYS.has(String(key).toLowerCase())) return value;
    const normalized = typeof value === "string" ? value.trim() : value;
    const length = typeof normalized === "string"
        ? normalized.length
        : Array.isArray(normalized)
            ? normalized.length
            : normalized
                ? String(normalized).length
                : 0;

    return {
        value: "[REDACTED]",
        length
    };
};

const sanitizeLogData = (input, seen = new WeakSet()) => {
    if (input == null) return input;
    if (typeof input !== "object") return input;
    if (seen.has(input)) return "[Circular]";

    seen.add(input);

    if (Array.isArray(input)) {
        return input.map((item) => sanitizeLogData(item, seen));
    }

    if (!isPlainObject(input)) {
        return input;
    }

    const output = {};
    for (const [key, value] of Object.entries(input)) {
        const redacted = redactSensitiveValue(key, value);
        output[key] = redacted === value ? sanitizeLogData(value, seen) : redacted;
    }
    return output;
};

if (!fs.existsSync(LOG_DIR)) {
    try {
        console.log(`[Logger] Creando directorio de logs: ${LOG_DIR}`);
        fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (err) {
        console.error("[Logger] No se pudo crear el directorio de logs:", err.message);
    }
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
        const safeMeta = sanitizeLogData(meta);
        console.log("[INFO]", msg, safeMeta);
        bufferLog("app.log", `INFO: ${msg} ${JSON.stringify(safeMeta)}`);
    },

    warn: (msg, meta = {}) => {
        const safeMeta = sanitizeLogData(meta);
        console.warn("[WARN]", msg, safeMeta);
        bufferLog("app.log", `WARN: ${msg} ${JSON.stringify(safeMeta)}`);
    },

    error: (msg, err = null, meta = {}) => {
        const safeMeta = sanitizeLogData(meta);
        console.error("[ERROR]", msg, err);
        bufferLog(
            "errors.log",
            `ERROR: ${msg} | ${err?.stack || err} | ${JSON.stringify(safeMeta)}`
        );
    },

    socket: (event, data) => {
        const safeData = sanitizeLogData(data);
        bufferLog("app.log", `SOCKET: ${event} ${JSON.stringify(safeData)}`);
    },

    system: (msg) => {
        bufferLog("app.log", `SYSTEM: ${msg}`);
    },
    sanitizeLogData
};

module.exports = Logger;
