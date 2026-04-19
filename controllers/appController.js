const open = require('open');

const abrirAplicacionOWeb = async (destino) => {
    try {
        if (destino === 'youtube') await open('https://www.youtube.com');
        if (destino === 'twitch') await open('https://www.twitch.tv');
        if (destino === 'spotify') await open('spotify:');
        console.log(`🌐 Abriendo app/web: ${destino}`);
    } catch (error) {
        console.error(`❌ Error intentando abrir ${destino}:`, error);
    }
};

module.exports = {
    abrirAplicacionOWeb
};
