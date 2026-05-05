const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { appendAdminAudit, rotateIfNeeded, clearAdminAudit, MAX_AUDIT_SIZE_BYTES } = require('../backend/core/plugins/adminAudit');

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

test('rotateIfNeeded rota el archivo cuando supera el tamaño máximo', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamdeck-audit-rotate-'));
    const logPath = path.join(tempDir, 'plugins-admin-audit.log');

    fs.writeFileSync(logPath, 'x'.repeat(MAX_AUDIT_SIZE_BYTES + 1));
    rotateIfNeeded(logPath);

    assert.equal(fs.existsSync(`${logPath}.1`), true);

    fs.rmSync(tempDir, { recursive: true, force: true });
});


test('clearAdminAudit elimina log principal y rotado', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamdeck-audit-clear-'));
    const logPath = path.join(tempDir, 'plugins-admin-audit.log');
    fs.writeFileSync(logPath, 'a');
    fs.writeFileSync(`${logPath}.1`, 'b');

    const ok = clearAdminAudit(logPath);
    assert.equal(ok, true);
    assert.equal(fs.existsSync(logPath), false);
    assert.equal(fs.existsSync(`${logPath}.1`), false);

    fs.rmSync(tempDir, { recursive: true, force: true });
});
