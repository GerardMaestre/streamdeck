const fs = require('fs');
const path = require('path');

const MAX_AUDIT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function rotateIfNeeded(filePath) {
    try {
        if (!fs.existsSync(filePath)) return;
        const stats = fs.statSync(filePath);
        if (stats.size > MAX_AUDIT_SIZE_BYTES) {
            fs.renameSync(filePath, `${filePath}.1`);
        }
    } catch (_) {
        // audit best-effort
    }
}

function appendAdminAudit({ filePath, action, ip, pluginId = null, ok = true, detail = null }) {
    if (!filePath) return;

    const entry = {
        ts: new Date().toISOString(),
        action,
        ip,
        pluginId,
        ok,
        detail,
    };

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        rotateIfNeeded(filePath);
        fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (_) {
        // audit best-effort: nunca romper operaciones por logging
    }
}

module.exports = { appendAdminAudit, rotateIfNeeded, MAX_AUDIT_SIZE_BYTES };
