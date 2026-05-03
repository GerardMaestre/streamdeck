const { TuyaContext } = require('@tuya/tuya-connector-nodejs');
const Logger = require('../core/logger/logger');
const { withTimeout, retryWithBackoff, circuitState } = require('../utils/resilience');

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

const tuyaCircuit = circuitState({ failureThreshold: 4, cooldownMs: 20000 });

/**
 * Envía un comando individual a un dispositivo
 */
const sendTuyaCommand = async (deviceId, code, value) => {
  if (!tuyaCircuit.canRequest()) {
    const blocked = new Error('Tuya circuit open');
    blocked.code = 'TUYA_CIRCUIT_OPEN';
    throw blocked;
  }

  try {
    const result = await retryWithBackoff(async () => {
      const context = getTuyaContext();
      return withTimeout(() => context.request({
        path: `/v1.0/devices/${deviceId}/commands`,
        method: 'POST',
        body: { commands: [{ code: code, value: value }] },
      }), 5000, { reasonCode: 'TUYA_TIMEOUT' });
    }, {
      retries: 2,
      initialDelayMs: 250,
      shouldRetry: (error) => error?.code === 'TUYA_TIMEOUT' || !String(error?.message || '').includes('401')
    });

    const success = result && result.success;
    if (!success) throw new Error('TUYA_COMMAND_NOT_SUCCESS');
    tuyaCircuit.recordSuccess();
    Logger.info(`[Tuya] Comando enviado a ${deviceId}: ${code}=${value} | Exito: ${success}`);
    return true;
  } catch (error) {
    tuyaCircuit.recordFailure();
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