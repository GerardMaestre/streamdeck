const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronTerminal', {
    onSetup: (callback) => ipcRenderer.on('terminal-setup', (e, data) => callback(data)),
    onLog: (callback) => ipcRenderer.on('terminal-log', (e, text) => callback(text)),
    onClear: (callback) => ipcRenderer.on('terminal-clear', () => callback()),
    close: (terminalId) => ipcRenderer.send('terminal-close', terminalId),
    minimize: (terminalId) => ipcRenderer.send('terminal-minimize', terminalId)
});
