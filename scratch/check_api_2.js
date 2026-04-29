const Mixer = require('native-sound-mixer');
const AudioMixer = Mixer.default;
console.log('AudioMixer methods:', Object.getOwnPropertyNames(AudioMixer));
console.log('AudioMixer prototype methods:', Object.getOwnPropertyNames(AudioMixer.prototype));
