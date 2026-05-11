const { exec } = require('child_process');
const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(300, 300)
$p = [System.Windows.Forms.Cursor]::Position
Write-Output "X=$($p.X) Y=$($p.Y)"
`;
exec(`powershell -Command "${script.replace(/\n/g, ' ')}"`, (e, stdout) => {
    console.log(stdout.trim());
});
