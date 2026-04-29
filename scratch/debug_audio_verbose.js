const { default: AudioMixer, DeviceType } = require('native-sound-mixer');
const path = require('path');

try {
    const defaultDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    if (!defaultDevice) {
        console.log('No default device found');
        process.exit(1);
    }

    console.log(`Device: ${defaultDevice.name}`);
    console.log('--- Sessions ---');
    defaultDevice.sessions.forEach(s => {
        console.log(`- Name (Title): "${s.name}"`);
        console.log(`  AppName (Path): "${s.appName}"`);
        console.log(`  State: ${s.state}`);
        console.log(`  Volume: ${s.volume}`);
        console.log('  ---');
    });
} catch (e) {
    console.error(e);
}
