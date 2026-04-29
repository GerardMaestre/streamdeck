try {
    console.log('Attempting to require native-sound-mixer...');
    const mixer = require('native-sound-mixer');
    console.log('Success! Mixer loaded.');
    console.log('Default device:', mixer.default.getDefaultDevice(0)?.name);
} catch (e) {
    console.error('Failed to load native-sound-mixer:');
    console.error(e);
}
