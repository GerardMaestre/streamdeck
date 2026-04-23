const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronPrompt', {
    onSetupPrompt: (callback) => {
        if (typeof callback !== 'function') return;
        ipcRenderer.on('setup-prompt', (event, data) => callback(data));
    },
    submit: (value) => ipcRenderer.send('prompt-submit', value),
    cancel: () => ipcRenderer.send('prompt-cancel')
});
