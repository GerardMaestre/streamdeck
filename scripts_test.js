const { ejecutarScriptDinamico } = require('./controllers/scriptController');

const fakeSocket = {
  emit: (event, payload) => {
    console.log('SOCKET_EMIT', event, JSON.stringify(payload));
  }
};

(async () => {
  try {
    console.log('Iniciando prueba de script dinámico...');
    await ejecutarScriptDinamico({ carpeta: '00_Test', archivo: 'test_echo.bat' }, fakeSocket);
    console.log('Prueba de script finalizada.');
  } catch (err) {
    console.error('Error en prueba de script:', err);
    process.exit(1);
  }
})();
