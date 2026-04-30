/**
 * AutoClicker Controller — Backend logic for the Stream Deck AutoClicker.
 *
 * Uses PowerShell with user32.dll P/Invoke to click at a fixed screen position
 * without permanently moving the user's cursor (save → move → click → restore).
 * The click loop runs in a dedicated child process so the main thread stays free.
 */
const { execFile, spawn } = require('child_process');

let clickerProcess = null;
let clickerState = {
    running: false,
    x: 0,
    y: 0,
    interval: 100,         // ms between clicks
    clickType: 'left',     // 'left' | 'right'
    monitorIndex: 0,       // restrict to this display
    totalClicks: 0
};
let globalIo = null;
let clickCountInterval = null;

// ── PS1 template that runs the click loop inside a single PowerShell process ──
function buildPSScript(x, y, interval, clickType, monitorBounds) {
    // mouse_event flags
    const downFlag = clickType === 'right' ? '0x0008' : '0x0002';
    const upFlag   = clickType === 'right' ? '0x0010' : '0x0004';

    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AC {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@

$targetX = ${x}
$targetY = ${y}
$interval = ${interval}
# Monitor bounds for safety check
$mLeft   = ${monitorBounds.x}
$mTop    = ${monitorBounds.y}
$mRight  = ${monitorBounds.x + monitorBounds.width}
$mBottom = ${monitorBounds.y + monitorBounds.height}
$clicks = 0

while ($true) {
    $p = New-Object AC+POINT
    [AC]::GetCursorPos([ref]$p) | Out-Null

    # Solo clickear si el target sigue dentro de los bounds del monitor
    if ($targetX -ge $mLeft -and $targetX -lt $mRight -and $targetY -ge $mTop -and $targetY -lt $mBottom) {
        [AC]::SetCursorPos($targetX, $targetY) | Out-Null
        [AC]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero)
        [AC]::mouse_event(${upFlag},   0, 0, 0, [UIntPtr]::Zero)
        [AC]::SetCursorPos($p.X, $p.Y) | Out-Null
        $clicks++
        if ($clicks % 50 -eq 0) { Write-Output "CLICKS:$clicks" }
    }

    Start-Sleep -Milliseconds $interval
}
`;
}

let cachedMonitors = [{ index: 0, label: 'Monitor 1 (1920x1080)', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, isPrimary: true }];
let lastMonitorScan = 0;

function refreshMonitors(callback) {
    const now = Date.now();
    if (now - lastMonitorScan < 10000) { // Cache 10s
        if (callback) callback(cachedMonitors);
        return;
    }
    lastMonitorScan = now;

    const psCmd = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    "$($_.Bounds.X),$($_.Bounds.Y),$($_.Bounds.Width),$($_.Bounds.Height),$($_.Primary)"
}`;

    execFile('powershell', ['-NoProfile', '-Command', psCmd], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
        if (error || !stdout) {
            if (callback) callback(cachedMonitors);
            return;
        }

        const monitors = [];
        stdout.trim().split(/\r?\n/).forEach((line, i) => {
            const parts = line.trim().split(',');
            if (parts.length >= 4) {
                const x = parseInt(parts[0], 10);
                const y = parseInt(parts[1], 10);
                const w = parseInt(parts[2], 10);
                const h = parseInt(parts[3], 10);
                const primary = parts[4] === 'True';
                monitors.push({
                    index: i,
                    label: `Monitor ${i + 1} (${w}x${h})${primary ? ' ★' : ''}`,
                    bounds: { x, y, width: w, height: h },
                    isPrimary: primary
                });
            }
        });

        if (monitors.length > 0) cachedMonitors = monitors;
        if (callback) callback(cachedMonitors);
    });
}

// Escaneo inicial
refreshMonitors();

function getMonitors() {
    return cachedMonitors;
}

function getMonitorBounds(monitorIndex) {
    const monitors = getMonitors();
    const m = monitors[monitorIndex] || monitors[0];
    return m.bounds;
}

function startClicker(io) {
    if (clickerProcess) stopClicker(io);

    const bounds = getMonitorBounds(clickerState.monitorIndex);

    // Validar que el punto esté dentro del monitor seleccionado
    if (clickerState.x < bounds.x || clickerState.x >= bounds.x + bounds.width ||
        clickerState.y < bounds.y || clickerState.y >= bounds.y + bounds.height) {
        io.emit('autoclicker_error', { message: 'La posición seleccionada está fuera del monitor elegido.' });
        return;
    }

    const script = buildPSScript(
        clickerState.x, clickerState.y,
        clickerState.interval,
        clickerState.clickType,
        bounds
    );

    clickerState.running = true;
    clickerState.totalClicks = 0;

    clickerProcess = spawn('powershell', [
        '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass',
        '-Command', script
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    clickerProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        const match = text.match(/CLICKS:(\d+)/);
        if (match) {
            clickerState.totalClicks = parseInt(match[1], 10);
        }
    });

    clickerProcess.stderr.on('data', () => { /* ignore PS noise */ });

    clickerProcess.on('exit', (code) => {
        clickerProcess = null;
        clickerState.running = false;
        if (clickCountInterval) {
            clearInterval(clickCountInterval);
            clickCountInterval = null;
        }
        io.emit('autoclicker_state', getPublicState());
    });

    // Emitir estado periódicamente mientras corre
    clickCountInterval = setInterval(() => {
        if (clickerState.running) {
            io.emit('autoclicker_state', getPublicState());
        }
    }, 1000);

    io.emit('autoclicker_state', getPublicState());
    console.log(`[AutoClicker] Iniciado en (${clickerState.x}, ${clickerState.y}) cada ${clickerState.interval}ms`);
}

function stopClicker(io) {
    if (clickerProcess) {
        try { clickerProcess.kill('SIGTERM'); } catch (_) {}
        try { clickerProcess.kill('SIGKILL'); } catch (_) {}
        clickerProcess = null;
    }
    if (clickCountInterval) {
        clearInterval(clickCountInterval);
        clickCountInterval = null;
    }
    clickerState.running = false;
    if (io) io.emit('autoclicker_state', getPublicState());
    console.log('[AutoClicker] Detenido.');
}

function getPublicState() {
    return {
        running: clickerState.running,
        x: clickerState.x,
        y: clickerState.y,
        interval: clickerState.interval,
        clickType: clickerState.clickType,
        monitorIndex: clickerState.monitorIndex,
        totalClicks: clickerState.totalClicks,
        monitors: getMonitors()
    };
}

function handleAutoClickerSocket(socket, io) {
    globalIo = io;

    socket.on('autoclicker_get_state', () => {
        socket.emit('autoclicker_state', getPublicState());
    });

    socket.on('autoclicker_set_config', (config) => {
        if (!config || typeof config !== 'object') return;
        if (Number.isFinite(config.x)) clickerState.x = Math.round(config.x);
        if (Number.isFinite(config.y)) clickerState.y = Math.round(config.y);
        if (Number.isFinite(config.interval)) clickerState.interval = Math.max(10, Math.min(5000, config.interval));
        if (config.clickType === 'left' || config.clickType === 'right') clickerState.clickType = config.clickType;
        if (Number.isFinite(config.monitorIndex)) clickerState.monitorIndex = config.monitorIndex;

        io.emit('autoclicker_state', getPublicState());
    });

    socket.on('autoclicker_start', () => {
        startClicker(io);
    });

    socket.on('autoclicker_stop', () => {
        stopClicker(io);
    });

    socket.on('autoclicker_toggle', () => {
        if (clickerState.running) {
            stopClicker(io);
        } else {
            startClicker(io);
        }
    });

    socket.on('autoclicker_pick_position', () => {
        // Trigger the Electron position picker on the PC
        if (global.showPositionPicker) {
            global.showPositionPicker().then((pos) => {
                if (pos) {
                    clickerState.x = pos.x;
                    clickerState.y = pos.y;
                    clickerState.monitorIndex = pos.monitorIndex ?? clickerState.monitorIndex;
                    io.emit('autoclicker_state', getPublicState());
                    io.emit('autoclicker_position_picked', { x: pos.x, y: pos.y });
                }
            }).catch(() => {});
        } else {
            socket.emit('autoclicker_error', { message: 'El selector de posición no está disponible.' });
        }
    });
}

function destroyAutoClicker() {
    stopClicker(globalIo);
}

module.exports = { handleAutoClickerSocket, destroyAutoClicker };
