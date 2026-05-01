const { execFile } = require('child_process');
const { getErrorMessage, getDataPath } = require('../utils/utils');
const path = require('path');
const fs = require('fs');

/**
 * Minimiza todas las ventanas abiertas en Windows usando PowerShell.
 */
const minimizarTodo = () => {
    return new Promise((resolve, reject) => {
        const psCommand = '(new-object -com shell.application).minimizeall()';
        execFile('powershell', ['-NoProfile', '-Command', psCommand], (error) => {
            if (error) {
                console.error('[System] Error al minimizar todo:', getErrorMessage(error));
                reject(error);
                return;
            }
            console.log('[System] Todas las ventanas minimizadas');
            resolve({ ok: true });
        });
    });
};

/**
 * Cambia la resolucion del monitor principal.
 * Requiere QRes.exe en la carpeta del proyecto.
 */
const cambiarResolucion = (width, height) => {
    return new Promise((resolve, reject) => {
        const safeWidth = Number(width);
        const safeHeight = Number(height);
        const isValidDimension = Number.isInteger(safeWidth)
            && Number.isInteger(safeHeight)
            && safeWidth >= 640
            && safeWidth <= 7680
            && safeHeight >= 480
            && safeHeight <= 4320;

        if (!isValidDimension) {
            resolve({ ok: false, error: 'Resolución inválida' });
            return;
        }

        // Usamos el script de PowerShell nativo
        const scriptPath = getDataPath('scripts/system/Set-Resolution.ps1');
        const args = [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-Width', String(safeWidth),
            '-Height', String(safeHeight)
        ];
        
        console.log(`[System] Cambiando resolucion a ${safeWidth}x${safeHeight} via PowerShell...`);
        
        execFile('powershell', args, (error, stdout) => {
            if (error) {
                console.error('[System] Error al cambiar resolucion:', getErrorMessage(error));
                resolve({ ok: false, error: getErrorMessage(error) });
                return;
            }
            const result = stdout.trim();
            if (result === 'OK') {
                console.log(`[System] Resolucion cambiada con exito a ${safeWidth}x${safeHeight}`);
                resolve({ ok: true });
            } else {
                console.warn('[System] Fallo al cambiar resolucion:', result);
                resolve({ ok: false, error: result });
            }
        });
    });
};

/**
 * Apaga el equipo inmediatamente.
 */
const apagarPC = () => {
    console.log('[System] Ejecutando orden de apagado...');
    execFile('shutdown', ['/s', '/t', '0']);
};

/**
 * Reinicia el equipo inmediatamente.
 */
const reiniciarPC = () => {
    console.log('[System] Ejecutando orden de reinicio...');
    execFile('shutdown', ['/r', '/t', '0']);
};

module.exports = {
    minimizarTodo,
    cambiarResolucion,
    apagarPC,
    reiniciarPC
};
