const fs = require('fs');
const path = require('path');

const MAX_AUDIT_SIZE_BYTES = 1024 * 1024; // 1MB

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
        fs.appendFileSync(filePath, `${JSON.stringify(entry)}
`, 'utf8');
    } catch (_) {
        // audit best-effort: nunca romper operaciones por logging
    }
}

module.exports = { appendAdminAudit, rotateIfNeeded, MAX_AUDIT_SIZE_BYTES };
