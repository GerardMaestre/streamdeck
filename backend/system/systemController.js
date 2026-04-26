const { exec } = require('child_process');
const { getErrorMessage, getDataPath } = require('../utils/utils');
const path = require('path');
const fs = require('fs');

/**
 * Minimiza todas las ventanas abiertas en Windows usando PowerShell.
 */
const minimizarTodo = () => {
    return new Promise((resolve, reject) => {
        const command = 'powershell -command "(new-object -com shell.application).minimizeall()"';
        exec(command, (error) => {
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
        // Usamos el script de PowerShell nativo
        const scriptPath = getDataPath('scripts/system/Set-Resolution.ps1');
        const command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Width ${width} -Height ${height}`;
        
        console.log(`[System] Cambiando resolucion a ${width}x${height} via PowerShell...`);
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('[System] Error al cambiar resolucion:', getErrorMessage(error));
                resolve({ ok: false, error: getErrorMessage(error) });
                return;
            }
            const result = stdout.trim();
            if (result === 'OK') {
                console.log(`[System] Resolucion cambiada con exito a ${width}x${height}`);
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
    exec('shutdown /s /t 0');
};

/**
 * Reinicia el equipo inmediatamente.
 */
const reiniciarPC = () => {
    console.log('[System] Ejecutando orden de reinicio...');
    exec('shutdown /r /t 0');
};

module.exports = {
    minimizarTodo,
    cambiarResolucion,
    apagarPC,
    reiniciarPC
};
