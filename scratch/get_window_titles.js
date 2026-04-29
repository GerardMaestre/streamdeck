const { execFile } = require('child_process');

const psCommand = 'Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object Name, MainWindowTitle | ConvertTo-Json';

execFile('powershell', ['-NoProfile', '-Command', psCommand], (error, stdout) => {
    if (error) {
        console.error(error);
        return;
    }
    try {
        const processes = JSON.parse(stdout);
        console.log(JSON.stringify(processes, null, 2));
    } catch (e) {
        console.log(stdout);
    }
});
