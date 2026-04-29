const { default: AudioMixer, DeviceType } = require('native-sound-mixer');

try {
    const defaultDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    if (defaultDevice && defaultDevice.sessions.length > 0) {
        console.log('Session keys:', Object.keys(defaultDevice.sessions[0]));
        console.log('Sample session:', defaultDevice.sessions[0]);
    } else {
        console.log('No sessions found');
    }
} catch (e) {
    console.error(e);
}
