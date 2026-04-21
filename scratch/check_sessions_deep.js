const { default: AudioMixer, DeviceType } = require('native-sound-mixer');

try {
    const device = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    if (device) {
        const sessions = device.sessions;
        if (sessions.length > 0) {
            const s = sessions[0];
            console.log('--- SESSION INSPECTION ---');
            console.log('App Name:', s.appName);
            console.log('Own Properties:', Object.getOwnPropertyNames(s));
            console.log('Prototype Properties:', Object.getOwnPropertyNames(Object.getPrototypeOf(s)));
            
            // Check for specific interesting names
            const interesting = ['state', 'status', 'active', 'level', 'peak', 'meter', 'playing', 'activity'];
            interesting.forEach(prop => {
                if (prop in s) console.log(`${prop}: ${s[prop]}`);
            });
        }
    }
} catch (e) {
    console.error(e);
}
process.exit(0);
