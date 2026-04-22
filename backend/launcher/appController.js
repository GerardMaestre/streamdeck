const open = require('open');

const abrirAplicacionOWeb = async (destino) => {
    try {
        if (destino === 'youtube') await open('https://www.youtube.com');
        if (destino === 'twitch') await open('https://www.twitch.tv');
        if (destino === 'spotify') await open('spotify:');
        if (destino === 'google-keep') {
            // Abrir como app de Chrome si es posible para una UX limpia
            const command = 'start chrome --app="https://keep.google.com/"';
            const { exec } = require('child_process');
            exec(command);
        }
        console.log(`[App] Abriendo app/web: ${destino}`);
    } catch (error) {
        console.error(`[Error] Error intentando abrir ${destino}:`, error);
    }
};

module.exports = {
    abrirAplicacionOWeb
};
