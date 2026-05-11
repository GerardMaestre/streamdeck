const test = require('node:test');
const assert = require('node:assert/strict');

const { circuitState } = require('../backend/utils/resilience');
const { __test__ } = require('../backend/scripts/scriptController');

const { applyScriptResultToCircuit, getDynamicScriptRuntime } = __test__;
const { listarScripts } = require('../backend/scripts/scriptController');

test('applyScriptResultToCircuit registra success cuando code=0', () => {
    const circuit = circuitState({ failureThreshold: 2, cooldownMs: 1000 });
    circuit.recordFailure();
    assert.equal(circuit.snapshot().failures, 1);

    applyScriptResultToCircuit(circuit, 0);

    const snapshot = circuit.snapshot();
    assert.equal(snapshot.failures, 0);
    assert.equal(snapshot.isOpen, false);
});

test('applyScriptResultToCircuit registra failure cuando code!=0', () => {
    const circuit = circuitState({ failureThreshold: 2, cooldownMs: 1000 });

    applyScriptResultToCircuit(circuit, 1);

    let snapshot = circuit.snapshot();
    assert.equal(snapshot.failures, 1);
    assert.equal(snapshot.isOpen, false);

    applyScriptResultToCircuit(circuit, 1);
    snapshot = circuit.snapshot();
    assert.equal(snapshot.failures, 2);
    assert.equal(snapshot.isOpen, true);
});

test('listarScripts solo devuelve archivos ejecutables por getDynamicScriptRuntime', async () => {
    const scriptsByFolder = await listarScripts();

    for (const folderData of Object.values(scriptsByFolder)) {
        for (const fileData of folderData.archivos) {
            const runtime = getDynamicScriptRuntime(fileData.archivo);
            assert.ok(runtime, `El archivo listado no es ejecutable: ${fileData.archivo}`);
        }
    }
});
