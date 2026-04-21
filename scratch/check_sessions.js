const { default: AudioMixer, DeviceType } = require('native-sound-mixer');

try {
    const device = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    if (device) {
        console.log('Device Found:', device.name);
        const sessions = device.sessions;
        if (sessions.length > 0) {
            console.log('Sample Session Properties:', Object.keys(sessions[0]));
            // Also check for hidden properties or prototypes
            // console.log('Prototype:', Object.getPrototypeOf(sessions[0]));
            sessions.forEach(s => {
                console.log(`- ${s.name}: Vol=${s.volume}, Mute=${s.mute}`);
            });
        } else {
            console.log('No sessions found.');
        }
    } else {
        console.log('No device found.');
    }
} catch (e) {
    console.error(e);
}
process.exit(0);
