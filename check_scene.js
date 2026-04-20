const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const context = new TuyaContext({
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: 'qtqhhvyau7mjxn4a49kj',
  secretKey: '5aaa497221b84fad9ed1b0664a3d066b',
});

const getSceneData = async (deviceId) => {
  console.log(`Getting current status for ${deviceId}`);
  try {
    const res = await context.request({
      path: `/v1.0/devices/${deviceId}/status`,
      method: 'GET',
    });
    
    if (res.success) {
      console.log('--- CURRENT STATUS ---');
      console.log(JSON.stringify(res.result, null, 2));
    } else {
      console.error('Error:', res.msg);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
};

getSceneData('bf02a8f057179a10753ram');
