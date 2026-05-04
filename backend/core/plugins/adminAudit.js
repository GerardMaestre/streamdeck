const fs = require('fs');
const path = require('path');

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
        fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (_) {
        // audit best-effort: nunca romper operaciones por logging
    }
}

module.exports = { appendAdminAudit };
