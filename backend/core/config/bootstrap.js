const fs = require('fs');
const path = require('path');
const os = require('os');
const dotenv = require('dotenv');

const ENV_CONTRACT = Object.freeze({
    required: [],
    optional: [
        'TUYA_ACCESS_KEY',
        'TUYA_SECRET_KEY',
        'DISCORD_CLIENT_ID',
        'DISCORD_CLIENT_SECRET',
        'DISCORD_REDIRECT_URI',
        'PORTABLE_EXECUTABLE_DIR',
        'PORT',
        'HOST'
    ]
});

const getPackagedPaths = ({ electronApp, appName = 'mi-streamdeck' } = {}) => {
    const isPackaged = !!(electronApp && electronApp.isPackaged);
    const userDataPath = (() => {
        if (!isPackaged) return __dirname;
        if (process.env.APPDATA) return path.join(process.env.APPDATA, appName);
        try {
            return electronApp.getPath('userData');
        } catch (_) {
            return path.join(os.homedir(), 'AppData', 'Roaming', appName);
        }
    })();

    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);

    return {
        isPackaged,
        userDataPath,
        exeDir,
        resourcesPath: process.resourcesPath
    };
};

const parseEnvFile = (filePath) => {
    try {
        if (fs.existsSync(filePath)) return dotenv.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {}
    return {};
};

const applyConfigEnvFallback = (configPath) => {
    try {
        if (!fs.existsSync(configPath)) return;

        const configRaw = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configRaw);
        const integrations = config?.integrations || {};

        const fallbackMap = {
            TUYA_ACCESS_KEY: integrations?.tuya?.accessKey,
            TUYA_SECRET_KEY: integrations?.tuya?.secretKey,
            DISCORD_CLIENT_ID: integrations?.discord?.clientId,
            DISCORD_CLIENT_SECRET: integrations?.discord?.clientSecret,
            DISCORD_REDIRECT_URI: integrations?.discord?.redirectUri
        };

        for (const [key, value] of Object.entries(fallbackMap)) {
            if (!process.env[key] && typeof value === 'string' && value.trim()) {
                process.env[key] = value.trim();
            }
        }
    } catch (_) {}
};

const loadAllEnvs = ({ electronApp, source = 'bootstrap', appName = 'mi-streamdeck' } = {}) => {
    const runtime = getPackagedPaths({ electronApp, appName });
    const logPath = path.join(runtime.userDataPath, 'debug.log');

    if (runtime.isPackaged) {
        const externalEnv = path.join(runtime.exeDir, '.env');
        const userDataEnv = path.join(runtime.userDataPath, '.env');
        const resourcesEnv = path.join(runtime.resourcesPath, '.env');
        const resourcesEnvExample = path.join(runtime.resourcesPath, '.env.example');

        const resourcesObj = Object.assign({}, parseEnvFile(resourcesEnvExample), parseEnvFile(resourcesEnv));
        const userDataObj = parseEnvFile(userDataEnv);
        const externalObj = parseEnvFile(externalEnv);

        const merged = Object.assign({}, resourcesObj, userDataObj, externalObj);
        Object.keys(merged).forEach((k) => {
            process.env[k] = merged[k];
        });

        applyConfigEnvFallback(path.join(runtime.exeDir, 'config.json'));
        applyConfigEnvFallback(path.join(runtime.userDataPath, 'config.json'));
        applyConfigEnvFallback(path.join(runtime.resourcesPath, 'config.json'));
        applyConfigEnvFallback(path.join(runtime.resourcesPath, 'config.example.json'));

        try {
            const logContent = `[${new Date().toISOString()}] PROD ENV LOADED (${source}):\n`
                + `- externalEnv: ${externalEnv} (exists: ${fs.existsSync(externalEnv)})\n`
                + `- userDataEnv: ${userDataEnv} (exists: ${fs.existsSync(userDataEnv)})\n`
                + `- resourcesEnv: ${resourcesEnv} (exists: ${fs.existsSync(resourcesEnv)})\n`
                + `- Variables Merged: ${Object.keys(merged).join(', ')}\n`
                + `- TUYA_ACCESS_KEY: ${process.env.TUYA_ACCESS_KEY ? 'Present' : 'Missing'}\n`
                + `- DISCORD_CLIENT_ID: ${process.env.DISCORD_CLIENT_ID ? 'Present' : 'Missing'}\n`;
            fs.appendFileSync(logPath, logContent);
        } catch (_) {}

        return { mode: 'packaged', mergedKeys: Object.keys(merged), runtime };
    }

    const result = dotenv.config({ quiet: true });
    try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] DEV ENV LOADED (${source}): Parsed: ${JSON.stringify(result.parsed || {})}\n`);
    } catch (_) {}
    return { mode: 'development', parsedKeys: Object.keys(result.parsed || {}), runtime };
};

const validateEnvContract = () => {
    const missingRequired = ENV_CONTRACT.required.filter((key) => !process.env[key]);
    return {
        required: [...ENV_CONTRACT.required],
        optional: [...ENV_CONTRACT.optional],
        missingRequired
    };
};

module.exports = {
    ENV_CONTRACT,
    getPackagedPaths,
    loadAllEnvs,
    applyConfigEnvFallback,
    validateEnvContract
};
