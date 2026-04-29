const { default: AudioMixer, DeviceType } = require('native-sound-mixer');

try {
    const devices = AudioMixer.devices(DeviceType.RENDER);
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
        
        defaultDevice.sessions.forEach(s => {
            console.log(`  Session: ${s.name} | AppName: ${s.appName} | Volume: ${s.volume} | Mute: ${s.mute}`);
        });
    } else {
        console.log('No default device found');
    }
} catch (err) {
    console.error('Error:', err);
}
