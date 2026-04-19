const io = require('socket.io-client');

const socket = io('http://localhost:3000', { reconnectionDelayMax: 10000 });

socket.on('connect', () => {
    console.log('Client connected', socket.id);
});

socket.on('mixer_initial_state', (state) => {
    console.log('Received mixer_initial_state');
    console.log(JSON.stringify(state, null, 2));

    const sessions = (state && state.sessions) || [];
    if (sessions.length > 0) {
        const app = sessions[0].name;
        const newVol = Math.max(0, (sessions[0].volume || 50) - 10);
        console.log(`Emitting set_session_volume -> ${app} = ${newVol}`);
        socket.emit('set_session_volume', { app, value: newVol });

        setTimeout(() => {
            console.log(`Emitting toggle_session_mute -> ${app} = true`);
            socket.emit('toggle_session_mute', { app, isMuted: true });
        }, 700);
    } else {
        console.log('No sessions found, toggling master mute');
        socket.emit('toggle_master_mute', true);
    }

    setTimeout(() => process.exit(0), 2500);
});

socket.on('master_updated', (d) => console.log('master_updated ->', d));
socket.on('session_updated', (d) => console.log('session_updated ->', d));
socket.on('session_added', (d) => console.log('session_added ->', d));
socket.on('session_removed', (d) => console.log('session_removed ->', d));
socket.on('server_error', (e) => console.error('server_error ->', e));
