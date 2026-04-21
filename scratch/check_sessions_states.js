const { default: AudioMixer, DeviceType } = require('native-sound-mixer');

try {
    const device = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    if (device) {
        device.sessions.forEach(s => {
            console.log(`- ${s.name || 'unnamed'} (State: ${s.state}): Vol=${s.volume}`);
        });
    }
} catch (e) {
    console.error(e);
}
process.exit(0);
