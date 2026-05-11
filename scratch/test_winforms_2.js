const { spawn } = require('child_process');
const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(300, 300)
$p = [System.Windows.Forms.Cursor]::Position
Write-Output "X=$($p.X) Y=$($p.Y)"
`;
const cp = spawn('powershell', ['-NoProfile', '-Command', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
cp.stdin.write(script);
cp.stdin.end();
cp.stdout.on('data', d => console.log('OUT:', d.toString().trim()));
cp.stderr.on('data', d => console.error('ERR:', d.toString().trim()));
