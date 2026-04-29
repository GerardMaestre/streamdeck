const Mixer = require('native-sound-mixer');
const AudioMixer = Mixer.default;
const DeviceType = Mixer.DeviceType;

console.log('AudioMixer.devices type:', typeof AudioMixer.devices);
console.log('AudioMixer.getDefaultDevice type:', typeof AudioMixer.getDefaultDevice);

try {
    const defaultDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    if (defaultDevice) {
        console.log('Default Device Name:', defaultDevice.name);
        console.log('Default Device volume property descriptor:', Object.getOwnPropertyDescriptor(Object.getPrototypeOf(defaultDevice), 'volume'));
        
        const sessions = defaultDevice.sessions;
        console.log('Sessions count:', sessions.length);
        if (sessions.length > 0) {
            const s = sessions[0];
            console.log('First session volume property descriptor:', Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s), 'volume'));
        }
    }
} catch (e) {
    console.error(e);
}
