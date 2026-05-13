const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioEngine', {
    onPlay: (callback) => ipcRenderer.on('play-sound', (event, payload) => callback(payload)),
    onStopAll: (callback) => ipcRenderer.on('stop-all-sounds', () => callback()),
    onRefreshDevices: (callback) => ipcRenderer.on('refresh-audio-devices', () => callback()),
    getDevices: async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
            .filter(d => d.kind === 'audiooutput')
            .map(d => ({ deviceId: d.deviceId, label: d.label || 'Dispositivo Desconocido' }));
    },
    supportsSinkSelection: () => typeof HTMLMediaElement !== 'undefined'
        && typeof HTMLMediaElement.prototype.setSinkId === 'function',
    sendDevices: (payload) => ipcRenderer.send('audio-devices-reply', payload)
});
