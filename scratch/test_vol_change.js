const Mixer = require('native-sound-mixer');
const AudioMixer = Mixer.default;
const DeviceType = Mixer.DeviceType;

try {
    const defaultDevice = AudioMixer.getDefaultDevice(DeviceType.RENDER);
    if (defaultDevice) {
        console.log(`Testing with device: ${defaultDevice.name}`);
        const sessions = defaultDevice.sessions;
        console.log(`Found ${sessions.length} sessions`);
        
        for (const s of sessions) {
            console.log(`Session: ${s.name} | App: ${s.appName} | Current Vol: ${s.volume}`);
            const oldVol = s.volume;
            const testVol = 0.55; // 55%
            console.log(`  Setting volume to ${testVol}...`);
            try {
                s.volume = testVol;
                console.log(`  Volume read back: ${s.volume}`);
                if (Math.abs(s.volume - testVol) < 0.01) {
                    console.log(`  SUCCESS: Volume updated.`);
                } else {
                    console.log(`  FAILURE: Volume did not update.`);
                }
                // Restore
                s.volume = oldVol;
            } catch (err) {
                console.error(`  ERROR setting volume:`, err);
            }
        }
        
        console.log(`\nTesting Master Volume...`);
        const oldMasterVol = defaultDevice.volume;
        const testMasterVol = 0.44;
        console.log(`  Setting Master volume to ${testMasterVol}...`);
        try {
            defaultDevice.volume = testMasterVol;
            console.log(`  Master Volume read back: ${defaultDevice.volume}`);
            if (Math.abs(defaultDevice.volume - testMasterVol) < 0.01) {
                console.log(`  SUCCESS: Master volume updated.`);
            } else {
                console.log(`  FAILURE: Master volume did not update.`);
            }
            defaultDevice.volume = oldMasterVol;
        } catch (err) {
            console.error(`  ERROR setting master volume:`, err);
        }
    }
} catch (e) {
    console.error(e);
}
