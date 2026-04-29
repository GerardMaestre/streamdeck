const Mixer = require('native-sound-mixer');
console.log('Mixer keys:', Object.keys(Mixer));
if (Mixer.default) {
    console.log('Mixer.default keys:', Object.keys(Mixer.default));
}
