const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "../../../logs");

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeLog(file, data) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(
        path.join(LOG_DIR, file),
        `[${timestamp}] ${data}\n`
    );
}

const Logger = {
    info: (msg, meta = {}) => {
        console.log("[INFO]", msg, meta);
        writeLog("app.log", `INFO: ${msg} ${JSON.stringify(meta)}`);
    },

    warn: (msg, meta = {}) => {
        console.warn("[WARN]", msg, meta);
        writeLog("app.log", `WARN: ${msg} ${JSON.stringify(meta)}`);
    },

    error: (msg, err = null, meta = {}) => {
        console.error("[ERROR]", msg, err);
        writeLog(
            "errors.log",
            `ERROR: ${msg} | ${err?.stack || err} | ${JSON.stringify(meta)}`
        );
    },

    socket: (event, data) => {
        writeLog("app.log", `SOCKET: ${event} ${JSON.stringify(data)}`);
    },

    system: (msg) => {
        writeLog("app.log", `SYSTEM: ${msg}`);
    }
};

module.exports = Logger;
