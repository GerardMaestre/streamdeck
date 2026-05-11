const { spawn } = require('child_process');

const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AC {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

    public static void ClickAt(int x, int y, uint down, uint up) {
        POINT p;
        if (GetCursorPos(out p)) {
            SetCursorPos(x, y);
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            SetCursorPos(p.X, p.Y);
        }
    }
}
"@

[AC]::ClickAt(500, 500, 0x0002, 0x0004)
Write-Output "OK"
`;

const child = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' });
child.stdout.on('data', d => console.log('STDOUT:', d.toString()));
child.stderr.on('data', d => console.error('STDERR:', d.toString()));
child.on('close', c => console.log('EXIT:', c));
