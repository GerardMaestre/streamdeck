const screenshot = require('screenshot-desktop');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getErrorMessage, runExecCommand } = require('../utils/utils');

// Obtener la carpeta de Imágenes/Capturas de pantalla del usuario de Windows
const carpetaCapturas = path.join(os.homedir(), 'Pictures', 'Screenshots');

// Asegurar que la ruta exista por si acaso
if (!fs.existsSync(carpetaCapturas)) {
    fs.mkdirSync(carpetaCapturas, { recursive: true });
}

const hacerCaptura = async (pantalla) => {
    try {
        const monitores = await screenshot.listDisplays();
        if (!Array.isArray(monitores) || monitores.length === 0) {
            throw new Error('No se detectaron pantallas disponibles para captura');
        }

        const nombreArchivo = path.join(carpetaCapturas, `foto_${Date.now()}.png`);
        let capturaRealizada = false;

        // ACCIÓN 1: GUARDAR EN LA CARPETA FÍSICA
        if (pantalla === 'principal') {
            await screenshot({ screen: monitores[0].id, filename: nombreArchivo });
            console.log(`📸 Foto guardada en carpeta: Captura Principal`);
            capturaRealizada = true;
        } else if (pantalla === 'secundaria' && monitores.length > 1) {
            await screenshot({ screen: monitores[1].id, filename: nombreArchivo });
            console.log(`📸 Foto guardada en carpeta: Captura Secundaria`);
            capturaRealizada = true;
        } else {
            console.log('⚠️ Cancelado: No se ha detectado una segunda pantalla u ocurrió un error con el parámetro.');
        }

        // ACCIÓN 2: ENVIAR AL PORTAPAPELES DE WINDOWS
        if (capturaRealizada && os.platform() === 'win32') {
            const rutaAbsoluta = path.resolve(nombreArchivo);

            // Escapar comillas simples para PowerShell cuando la ruta contiene apóstrofes.
            const escapedPath = rutaAbsoluta.replace(/'/g, "''");
            const comandoPS = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${escapedPath}'))"`;

            await runExecCommand(comandoPS);
            console.log('📋 ¡Copiado al portapapeles! Listo para Ctrl+V');
        }
    } catch (error) {
        console.error('❌ Error crítico intentando hacer la captura de pantalla:', getErrorMessage(error));
        throw error;
    }
};

module.exports = {
    hacerCaptura
};
