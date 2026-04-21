const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// Configuración con tus credenciales del panel (Overview) a través de variables de entorno
const context = new TuyaContext({
  baseUrl: 'https://openapi.tuyaeu.com', 
  accessKey: process.env.TUYA_ACCESS_KEY,
  secretKey: process.env.TUYA_SECRET_KEY,
});

/**
 * Envía un comando individual a un dispositivo
 */
const sendTuyaCommand = async (deviceId, code, value) => {
  try {
    const res = await context.request({
      path: `/v1.0/devices/${deviceId}/commands`,
      method: 'POST',
      body: { 
          commands: [{ code, value }] 
      },
    });
    
    if (res.success) {
        console.log(`[Tuya] [${deviceId}] OK: ${code}=${value}`);
        return true;
    } else {
        console.warn(`[Tuya] [${deviceId}] Error: ${res.msg}`);
        return false;
    }
  } catch (error) {
    console.error(`[Tuya] [${deviceId}] Critical Error:`, error.message);
    return false;
  }
};

/**
 * Controla múltiples dispositivos con un ligero retardo interno para estabilidad
 */
const controlMultipleDevices = async (deviceIds, code, value) => {
    if (!Array.isArray(deviceIds)) return false;
    
    console.log(`[Tuya] Controlando ${deviceIds.length} dispositivos (${code}=${value})...`);
    
    const results = [];
    for (const id of deviceIds) {
        results.push(await sendTuyaCommand(id, code, value));
        // Pequeño retardo de 50ms entre dispositivos para evitar saturación de peticiones simultáneas
        await new Promise(r => setTimeout(r, 50));
    }
    
    return results.every(res => res === true);
};

module.exports = { sendTuyaCommand, controlMultipleDevices };