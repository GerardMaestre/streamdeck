const open = require('open');

const appUrls = {
    youtube: { url: 'https://www.youtube.com', mode: 'web' },
    twitch: { url: 'https://www.twitch.tv', mode: 'web' },
    spotify: { url: 'spotify:', mode: 'deeplink' },
    'google-keep': { url: 'https://keep.google.com/', mode: 'app' },
    'google-calendar': { url: 'https://calendar.google.com/', mode: 'app' }
};

const abrirAplicacionOWeb = async (destino) => {
    try {
        const target = appUrls[destino];
        if (!target) {
            console.log(`[App] Destino no configurado: ${destino}`);
            return;
        }

        switch (target.mode) {
            case 'web':
            case 'deeplink':
                await open(target.url);
                break;
            case 'app':
                try {
                    await open(target.url, {
                        app: { name: 'chrome', arguments: [`--app=${target.url}`] }
                    });
                } catch (err) {
                    // Fallback seguro sin shell interpolation.
                    await open(target.url);
                }
                break;
            default:
                console.warn(`[App] Modo desconocido para ${destino}: ${target.mode}`);
                return;
        }

        console.log(`[App] Abriendo app/web: ${destino}`);
    } catch (error) {
        console.error(`[Error] Error intentando abrir ${destino}:`, error);
    }
};

module.exports = {
    abrirAplicacionOWeb,
    appUrls
};
