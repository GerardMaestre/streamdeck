const fs = require('fs');
const path = require('path');

const MAX_AUDIT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function rotateIfNeeded(filePath) {
    try {
        if (!fs.existsSync(filePath)) return;
        const stats = fs.statSync(filePath);
        if (stats.size < MAX_AUDIT_SIZE_BYTES) return;

        const rotatedPath = `${filePath}.1`;
        if (fs.existsSync(rotatedPath)) {
            fs.unlinkSync(rotatedPath);
        }
        fs.renameSync(filePath, rotatedPath);
    } catch (_) {
        // best-effort
    }
}


function clearAdminAudit(filePath) {
    if (!filePath) return false;
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const rotatedPath = `${filePath}.1`;
        if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
        return true;
    } catch (_) {
        return false;
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

module.exports = { appendAdminAudit, rotateIfNeeded, clearAdminAudit, MAX_AUDIT_SIZE_BYTES };
