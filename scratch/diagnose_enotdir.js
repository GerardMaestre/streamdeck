const path = require('path');
const fs = require('fs');

const root = 'c:\\Users\\gerar\\Desktop\\mi-streamdeck';

function testPath(p) {
    try {
        const stats = fs.statSync(p);
        console.log(`[OK] ${p} - ${stats.isDirectory() ? 'Directory' : 'File'}`);
    } catch (e) {
        console.log(`[FAIL] ${p} - ${e.code}`);
    }
}

console.log('Testing critical paths...');
testPath(path.join(root, 'backend'));
testPath(path.join(root, 'backend', 'utils', 'utils.js'));
testPath(path.join(root, 'backend', 'data', 'state-store.js'));
testPath(path.join(root, 'data'));
testPath(path.join(root, 'data', 'state.json'));
testPath(path.join(root, 'scripts'));
testPath(path.join(root, 'logs'));
testPath(path.join(root, 'frontend'));
testPath(path.join(root, '.env'));
testPath(path.join(root, 'config.json'));

console.log('\nTesting require-like paths...');
testPath(path.join(root, 'backend', 'audio', 'audioMixerController.js'));

try {
    console.log('\nChecking for ENOTDIR suspects...');
    const backend = path.join(root, 'backend');
    const items = fs.readdirSync(backend);
    for (const item of items) {
        const p = path.join(backend, item);
        const stats = fs.statSync(p);
        if (stats.isDirectory()) {
            try {
                fs.readdirSync(p);
            } catch (e) {
                if (e.code === 'ENOTDIR') {
                    console.log(`!!! ENOTDIR found at ${p}`);
                }
            }
        }
    }
} catch (e) {
    console.log('Error scanning backend:', e.message);
}
