const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerAPI', {
    pick: (x, y) => ipcRenderer.send('picker-select', { x, y }),
    cancel: () => ipcRenderer.send('picker-cancel')
});
