const test = require('node:test');
const assert = require('node:assert/strict');

const { circuitState } = require('../backend/utils/resilience');
const { __test__ } = require('../backend/scripts/scriptController');
const { applyScriptResultToCircuit, buildExecutionCommand, validateDynamicPayload, getDynamicScriptRuntime } = __test__;
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

test('buildExecutionCommand conserva argumentos con espacios en tokens separados', () => {
    const command = buildExecutionCommand('/tmp/mi script.py', ['--name', 'John Doe']);
    assert.equal(command.bin, 'python');
    assert.deepEqual(command.args, ['/tmp/mi script.py', '--name', 'John Doe']);
});

test('validateDynamicPayload rechaza caracteres especiales peligrosos', () => {
    assert.throws(() => validateDynamicPayload({
        carpeta: '01_Mantenimiento',
        archivo: 'script.py',
        args: 'normal && whoami'
    }), /caracteres no permitidos/i);
});

test('runScriptExternally usa spawn sin shell implícita', async () => {
    const childProcess = require('child_process');
    const originalSpawn = childProcess.spawn;
    const recorded = [];

    childProcess.spawn = (bin, args, options) => {
        recorded.push({ bin, args, options });
        return {
            pid: 1234,
            killed: false,
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            on: () => {}
        };
    };

    try {
        delete require.cache[require.resolve('../backend/scripts/scriptController')];
        const { __test__: freshTestApi } = require('../backend/scripts/scriptController');
        await freshTestApi.runScriptExternally('test', '/tmp/fake.py', ['--name', 'John Doe']);
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0].options.shell, false);
    } finally {
        delete require.cache[require.resolve('../backend/scripts/scriptController')];
        childProcess.spawn = originalSpawn;
    }
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
