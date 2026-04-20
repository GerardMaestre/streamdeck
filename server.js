const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const { emitErrorToFrontend, getErrorMessage } = require('./controllers/utils/utils');

// Importar controladores (Lógica modularizada)
const { initAudioMixer, sendInitialState, handleSocketCommands } = require('./controllers/audio/audioMixerController');
const { abrirAplicacionOWeb } = require('./controllers/app/appController');
const { ejecutarMacro, controlMultimedia } = require('./controllers/macros/macroController');
const { hacerCaptura } = require('./controllers/capture/captureController');
const { ejecutarScript, ejecutarScriptDinamico, listarScripts } = require('./controllers/scripts/scriptController');
const { initDiscordRPC, requestInitialDiscordState, discordToggleMute, discordToggleDeaf, discordSetUserVolume } = require('./controllers/discord/discordController');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Endpoint para entregar el JSON de configuración de los botones
app.get('/api/config', (req, res) => {
    try {
        const configData = fs.readFileSync('./config.json', 'utf8');
        res.json(JSON.parse(configData));
    } catch(err) {
        console.error('Error leyendo config.json', err);
        res.status(500).json({ error: 'No se pudo cargar la configuración.' });
    }
});

// Inicializar audio-mixer con el io del servidor
initAudioMixer(io);
initDiscordRPC(io);

const handleSocketError = (socket, eventName, error, ack) => {
    console.error(`❌ Error en evento socket [${eventName}]:`, error);
    emitErrorToFrontend(socket, eventName, error);

    if (typeof ack === 'function') {
        ack({ ok: false, message: getErrorMessage(error) });
    }
};

const runSafely = async (socket, eventName, action, ack) => {
    try {
        return await action();
    } catch (error) {
        handleSocketError(socket, eventName, error, ack);
        return null;
    }
};

io.on('connection', (socket) => {
    console.log('📱 Centro de mando conectado');

    // Routing de Eventos -> Controladores
    runSafely(socket, 'mixer_initial_state', async () => {
        sendInitialState(socket);
    });

    runSafely(socket, 'mixer_bind_commands', async () => {
        handleSocketCommands(socket);
    });

    runSafely(socket, 'discord_initial_state', async () => {
        await requestInitialDiscordState(socket); // Estado Discord para este cliente (conexión, mute/deaf, usuarios)
    });

    socket.on('abrir', async (destino, ack) => {
        const result = await runSafely(socket, 'abrir', () => abrirAplicacionOWeb(destino), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('macro', async (tipo, ack) => {
        const result = await runSafely(socket, 'macro', () => ejecutarMacro(tipo), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('multimedia', async (accion, ack) => {
        const result = await runSafely(socket, 'multimedia', () => controlMultimedia(accion), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('captura', async (pantalla, ack) => {
        const result = await runSafely(socket, 'captura', () => hacerCaptura(pantalla), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('ejecutar_script', async (scriptId, ack) => {
        const result = await runSafely(socket, 'ejecutar_script', () => ejecutarScript(scriptId, socket), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    socket.on('ejecutar_script_dinamico', async (payload, ack) => {
        const result = await runSafely(socket, 'ejecutar_script_dinamico', () => ejecutarScriptDinamico(payload, socket), ack);
        if (typeof ack === 'function' && result !== null) ack({ ok: true });
    });

    // Discord Sockets
    socket.on('discord_toggle_mute', async (ack) => {
        const result = await runSafely(socket, 'discord_toggle_mute', () => discordToggleMute(), ack);
        if (typeof ack === 'function' && result !== null) ack(result);
    });

    socket.on('discord_toggle_deaf', async (ack) => {
        const result = await runSafely(socket, 'discord_toggle_deaf', () => discordToggleDeaf(), ack);
        if (typeof ack === 'function' && result !== null) ack(result);
    });

    socket.on('discord_set_user_volume', async ({ userId, volume }, ack) => {
        const result = await runSafely(
            socket,
            'discord_set_user_volume',
            () => discordSetUserVolume(userId, volume),
            ack
        );

        if (typeof ack === 'function' && result !== null) ack(result);
    });

    socket.on('disconnect', () => {
        console.log('📴 Centro de mando desconectado');
    });
});

let PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const MAX_PORT_RETRIES = 5;
let portRetries = 0;

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.warn(`⚠️ Puerto ${PORT} en uso. Intentando puerto ${PORT + 1}...`);
        portRetries += 1;
        if (portRetries > MAX_PORT_RETRIES) {
            console.error(`❌ No se pudo iniciar el servidor: puerto ${PORT} en uso y se agotaron ${MAX_PORT_RETRIES} reintentos.`);
            process.exit(1);
        } else {
            PORT = PORT + 1;
            setTimeout(() => {
                try {
                    server.listen(PORT);
                } catch (e) {
                    console.error('❌ Error al reintentar server.listen:', e);
                    process.exit(1);
                }
            }, 200);
        }
        return;
    }
    console.error('❌ Error en el servidor:', err);
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`🚀 Stream Deck Pro operando en http://localhost:${PORT}`);
});

// Endpoint para listar scripts disponibles en el directorio `mis_scripts`
app.get('/api/scripts', async (req, res) => {
    try {
        const data = await listarScripts();
        res.json(data);
    } catch (err) {
        console.error('Error listando scripts', err);
        res.status(500).json({ error: 'No se pudieron listar los scripts.' });
    }
});