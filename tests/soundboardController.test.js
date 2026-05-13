const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { __test__ } = require('../backend/soundboard/soundboardController');
const {
    isValidSoundFileName,
    listAudioFiles,
    resolveSoundFilePath
} = __test__;

const makeTempSoundDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'streamdeck-soundboard-'));

test('isValidSoundFileName acepta solo archivos de audio simples', () => {
    assert.equal(isValidSoundFileName('intro.mp3'), true);
    assert.equal(isValidSoundFileName('alert.WAV'), true);
    assert.equal(isValidSoundFileName('../secret.mp3'), false);
    assert.equal(isValidSoundFileName('nested/song.mp3'), false);
    assert.equal(isValidSoundFileName('note.txt'), false);
    assert.equal(isValidSoundFileName(''), false);
});

test('listAudioFiles ignora carpetas y extensiones no permitidas', () => {
    const dir = makeTempSoundDir();
    fs.writeFileSync(path.join(dir, 'b.wav'), '');
    fs.writeFileSync(path.join(dir, 'a.mp3'), '');
    fs.writeFileSync(path.join(dir, 'readme.txt'), '');
    fs.mkdirSync(path.join(dir, 'folder.ogg'));

    assert.deepEqual(listAudioFiles(dir), ['a.mp3', 'b.wav']);
});

test('resolveSoundFilePath rechaza traversal y archivos inexistentes', () => {
    const dir = makeTempSoundDir();
    fs.writeFileSync(path.join(dir, 'ok.ogg'), '');

    assert.equal(resolveSoundFilePath('ok.ogg', dir), path.join(dir, 'ok.ogg'));
    assert.throws(() => resolveSoundFilePath('../ok.ogg', dir), /Nombre de audio invalido/);
    assert.throws(() => resolveSoundFilePath('missing.ogg', dir), /ENOENT|no such file/i);
});
