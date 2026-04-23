const screenshot = require('screenshot-desktop');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getErrorMessage, runExecCommand } = require('../utils/utils');

// Intentar cargar Electron para usar el portapapeles nativo
let electron;
try {
    electron = require('electron');
} catch (e) {
    // Si no estamos bajo Electron, fallará silenciosamente
}

// Obtener la carpeta de Imágenes/Capturas de pantalla del usuario de Windows
const carpetaCapturas = path.join(os.homedir(), 'Pictures', 'Screenshots');

// Asegurar que la ruta exista
if (!fs.existsSync(carpetaCapturas)) {
    fs.mkdirSync(carpetaCapturas, { recursive: true });
}

/**
 * Realiza una captura de pantalla del monitor especificado,
 * la guarda en la carpeta de Screenshots y la copia al portapapeles.
 */
const hacerCaptura = async (pantallaID) => {
    try {
        console.log(`[Capture] Iniciando proceso de captura para ID: ${pantallaID}`);

        const monitores = await screenshot.listDisplays();
        if (!Array.isArray(monitores) || monitores.length === 0) {
            throw new Error('No se detectaron pantallas disponibles para captura');
        }

        // Mapeo flexible de parámetros: "1", 1, "principal" -> Pantalla 0
        const idNormalizado = String(pantallaID).toLowerCase();
        let monIndex = 0; // Por defecto la principal

        if (idNormalizado === '2' || idNormalizado === 'secundaria') {
            monIndex = 1;
        }

        // Verificar si el monitor solicitado existe
        if (monIndex >= monitores.length) {
            console.warn(`[Capture] Monitor ${monIndex + 1} no disponible (total: ${monitores.length}). Usando monitor principal.`);
            monIndex = 0;
        }

        // Generar nombre de archivo con timestamp
        const fecha = new Date().toISOString().replace(/[:.]/g, '-');
        const nombreArchivo = path.join(carpetaCapturas, `Captura_${fecha}.png`);
        
        // REALIZAR CAPTURA Y GUARDAR EN DISCO
        await screenshot({ 
            screen: monitores[monIndex].id, 
            filename: nombreArchivo 
        });

        console.log(`[Capture] Captura guardada con exito en: ${nombreArchivo}`);

        // COPIAR AL PORTAPAPELES (Solo Windows)
        if (os.platform() === 'win32') {
            const rutaAbsoluta = path.resolve(nombreArchivo);

            if (electron && electron.clipboard && electron.nativeImage) {
                // MÉTODO 1: Usar API nativa de Electron (Recomendado)
                const img = electron.nativeImage.createFromPath(rutaAbsoluta);
                electron.clipboard.writeImage(img);
                console.log('[Capture] Portapapeles: Imagen copiada correctamente via Electron.');
            } else {
                // MÉTODO 2: Fallback a PowerShell si Electron no está disponible
                const escapedPath = rutaAbsoluta.replace(/'/g, "''");
                const comandoPS = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${escapedPath}'))"`;
                
                await runExecCommand(comandoPS);
                console.log('[Capture] Portapapeles: Imagen copiada correctamente via PowerShell.');
            }
        }

        return { ok: true, path: nombreArchivo };

    } catch (error) {
        console.error('[Capture] Error en el controlador de captura:', getErrorMessage(error));
        throw error;
    }
};

module.exports = {
    hacerCaptura
};
