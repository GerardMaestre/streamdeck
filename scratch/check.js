const {app, BrowserWindow} = require('electron');
app.whenReady().then(() => {
    const win = new BrowserWindow({show: false});
    win.loadURL('http://localhost:3000/?bust=' + Date.now());
    win.webContents.on('console-message', (e, level, message, line, sourceId) => {
        console.log('BROWSER_LOG:', message);
    });
    setTimeout(() => app.quit(), 3000);
});
