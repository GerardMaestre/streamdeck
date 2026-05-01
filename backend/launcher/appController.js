const open = require('open');

const appUrls = {
    'google-keep': 'https://keep.google.com/',
    'google-calendar': 'https://calendar.google.com/'
};

const abrirAplicacionOWeb = async (destino) => {
    try {
        if (destino === 'youtube') await open('https://www.youtube.com');
        if (destino === 'twitch') await open('https://www.twitch.tv');
        if (destino === 'spotify') await open('spotify:');

        if (appUrls[destino]) {
            const url = appUrls[destino];
            try {
                await open(url, { app: { name: 'chrome', arguments: [`--app=${url}`] } });
            } catch (err) {
                // Fallback seguro sin shell interpolation.
                await open(url);
            }
        }

        console.log(`[App] Abriendo app/web: ${destino}`);
    } catch (error) {
        console.error(`[Error] Error intentando abrir ${destino}:`, error);
    }
};

module.exports = {
    abrirAplicacionOWeb
};
