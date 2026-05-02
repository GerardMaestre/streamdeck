const { TuyaContext } = require('@tuya/tuya-connector-nodejs');
const Logger = require('../core/logger/logger');

// Obtener el contexto de Tuya de forma dinámica para garantizar que usa las variables más recientes de .env
const getTuyaContext = () => {
  const accessKey = (process.env.TUYA_ACCESS_KEY || '').trim();
  const secretKey = (process.env.TUYA_SECRET_KEY || '').trim();

  if (!accessKey || !secretKey) {
    Logger.warn('[Tuya] TUYA_ACCESS_KEY o TUYA_SECRET_KEY no definidos. Verifica tu archivo .env.');
  }

  return new TuyaContext({
    baseUrl: 'https://openapi.tuyaeu.com', 
    accessKey: accessKey,
    secretKey: secretKey,
  });
};

if (process.env.TUYA_ACCESS_KEY) {
  Logger.info(`[Tuya] Sistema inicializado con Access Key: ${process.env.TUYA_ACCESS_KEY.substring(0, 5)}...`);
} else {
  Logger.warn('[Tuya] TUYA_ACCESS_KEY no definido en .env. Domotica deshabilitada.');
}

/**
 * Envía un comando individual a un dispositivo
 */
const sendTuyaCommand = async (deviceId, code, value) => {
  try {
    const context = getTuyaContext();
    const res = await context.request({
      path: `/v1.0/devices/${deviceId}/commands`,
      method: 'POST',
      body: { 
          commands: [{ code: code, value: value }] 
      },
    });
    
    const success = res && res.success;
    Logger.info(`[Tuya] Comando enviado a ${deviceId}: ${code}=${value} | Exito: ${success}`);
    return success;
  } catch (error) {
    Logger.error(`[Tuya] Error enviando comando a ${deviceId}: ${error.message}`);
    throw error;
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