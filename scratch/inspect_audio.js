const { default: AudioMixer, DeviceType } = require('native-sound-mixer');

try {
    const devices = AudioMixer.getDevices(DeviceType.RENDER);
    console.log('--- Render Devices ---');
    devices.forEach(d => {
        console.log(`Device: ${d.name} | Volume: ${d.volume} | Mute: ${d.mute}`);
    });

    const defaultDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    console.log('\n--- Default Device ---');
    if (defaultDevice) {
        console.log(`Name: ${defaultDevice.name}`);
        console.log(`Volume: ${defaultDevice.volume}`);
        console.log(`Mute: ${defaultDevice.mute}`);
        console.log(`Sessions count: ${defaultDevice.sessions.length}`);
    } else {
        console.log('No default device found');
    }
} catch (err) {
    console.error('Error:', err);
}
