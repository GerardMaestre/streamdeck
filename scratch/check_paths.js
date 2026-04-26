const { getDataPath } = require('../backend/utils/utils');
const path = require('path');

try {
    const logsPath = getDataPath('logs');
    console.log('Logs Path:', logsPath);
    console.log('Absolute Logs Path:', path.resolve(logsPath));
    
    const configPath = getDataPath('config.json');
    console.log('Config Path:', configPath);
} catch (error) {
    console.error('Error:', error);
}
