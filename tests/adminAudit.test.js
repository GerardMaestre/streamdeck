const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { appendAdminAudit } = require('../backend/core/plugins/adminAudit');

test('appendAdminAudit escribe línea JSONL válida', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamdeck-audit-test-'));
    const logPath = path.join(tempDir, 'plugins-admin-audit.log');

    appendAdminAudit({
        filePath: logPath,
        action: 'reload',
        ip: '127.0.0.1',
        pluginId: null,
        ok: true,
        detail: 'loaded=1'
    });

    assert.equal(fs.existsSync(logPath), true);
    const raw = fs.readFileSync(logPath, 'utf8').trim();
    const line = JSON.parse(raw);

    assert.equal(line.action, 'reload');
    assert.equal(line.ip, '127.0.0.1');
    assert.equal(line.ok, true);
    assert.equal(line.detail, 'loaded=1');

    fs.rmSync(tempDir, { recursive: true, force: true });
});
