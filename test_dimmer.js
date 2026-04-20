const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const context = new TuyaContext({
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: 'qtqhhvyau7mjxn4a49kj',
  secretKey: '5aaa497221b84fad9ed1b0664a3d066b',
});

const testControlData = async (deviceId, bright) => {
  console.log(`Setting control_data bright=${bright} for ${deviceId}`);
  try {
    const res = await context.request({
      path: `/v1.0/devices/${deviceId}/commands`,
      method: 'POST',
      body: {
        commands: [
            { 
                code: "control_data", 
                value: {
                    "bright": bright,
                    "change_mode": "direct"
                } 
            }
        ],
      },
    });
    console.log('Result:', JSON.stringify(res, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
};

// 1. Pon la luz en modo Escena manualmente o via app
// 2. Ejecuta este script
testControlData('bf02a8f057179a10753ram', 100); // Intenta bajar el brillo al 10%
