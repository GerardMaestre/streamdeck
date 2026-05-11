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
    clickMode: 'click',    // 'click' | 'hold'
    monitorIndex: 0,       // restrict to this display
    totalClicks: 0
};
let globalIo = null;
let clickCountInterval = null;

// Helper one-shot force up (libera el mouse para garantizar que no quede atascado)
function forceMouseUp(clickType) {
    const upFlag = clickType === 'right' ? 0x0010 : 0x0004; // RIGHTUP : LEFTUP
    const psCmd = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {[DllImport("user32.dll")]public static extern void mouse_event(uint f,int x,int y,uint d,UIntPtr e);}
"@
[WinAPI]::mouse_event(${upFlag},0,0,0,[UIntPtr]::Zero)`;
    
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { 
        detached: true, 
        windowsHide: true, 
        stdio: 'ignore' 
    }).unref();
}

// ── PS1 template que soporta tanto click repetitivo como mantener presionado ──
// Usa System.Windows.Forms.Cursor para manejo automático de DPI y píxeles virtuales
function buildPSScript(x, y, interval, clickType, mode) {
    const downFlag = clickType === 'right' ? 0x0008 : 0x0002; // RIGHTDOWN : LEFTDOWN
    const upFlag   = clickType === 'right' ? 0x0010 : 0x0004; // RIGHTUP : LEFTUP

    return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$tX = ${x}
$tY = ${y}
$d = [uint32]${downFlag}
$u = [uint32]${upFlag}
$mode = "${mode}"
$int = ${interval}
$clicks = 0

if ($mode -eq "hold") {
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($tX, $tY)
    [WinAPI]::mouse_event($d, 0, 0, 0, [UIntPtr]::Zero)
    Write-Output "HOLDING"
    while ($true) { Start-Sleep -Seconds 1 }
} else {
    while ($true) {
        $orig = [System.Windows.Forms.Cursor]::Position
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($tX, $tY)
        [WinAPI]::mouse_event($d, 0, 0, 0, [UIntPtr]::Zero)
        [WinAPI]::mouse_event($u, 0, 0, 0, [UIntPtr]::Zero)
        [System.Windows.Forms.Cursor]::Position = $orig
        
        $clicks++
        if ($clicks % 50 -eq 0) { Write-Output "CLICKS:$clicks" }
        Start-Sleep -Milliseconds $int
    }
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
        clickerState.clickMode
    );

    clickerState.running = true;
    clickerState.totalClicks = 0;

    // Lanzamos PowerShell y alimentamos el script vía Stdin para evitar límites de longitud de comandos/encoding
    clickerProcess = spawn('powershell', [
        '-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', '-'
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    clickerProcess.stdin.write(script);
    clickerProcess.stdin.end();

    clickerProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text.includes("HOLDING")) {
            console.log(`[AutoClicker] MANTENIENDO botón ${clickerState.clickType} presionado.`);
        }
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
    const lastType = clickerState.clickType; // guardamos para asegurar liberación correcta
    
    if (clickerProcess) {
        try { clickerProcess.kill('SIGTERM'); } catch (_) {}
        try { clickerProcess.kill('SIGKILL'); } catch (_) {}
        clickerProcess = null;
    }
    
    // GARANTÍA TOTAL: lanzamos un evento de "soltar" independiente
    // Esto asegura que incluso si el proceso fue asesinado a la fuerza, el ratón no quede bloqueado abajo.
    forceMouseUp(lastType);

    if (clickCountInterval) {
        clearInterval(clickCountInterval);
        clickCountInterval = null;
    }
    clickerState.running = false;
    if (io) io.emit('autoclicker_state', getPublicState());
    console.log('[AutoClicker] Detenido y liberado.');
}

function getPublicState() {
    // Intentar refrescar si los datos son viejos
    refreshMonitors();
    
    return {
        running: clickerState.running,
        x: clickerState.x,
        y: clickerState.y,
        interval: clickerState.interval,
        clickType: clickerState.clickType,
        clickMode: clickerState.clickMode,
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
        if (config.clickMode === 'click' || config.clickMode === 'hold') clickerState.clickMode = config.clickMode;
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
