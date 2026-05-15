const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name:'Stream Deck Pro Server',
  description: 'The Node.js server for Stream Deck Pro.',
  script: path.join(__dirname, 'server.js')
});

// Listen for the "uninstall" event so we know when it's done.
svc.on('uninstall',function(){
  console.log('Uninstall complete.');
  console.log('The service exists: ',svc.exists);
});

// Uninstall the service.
svc.uninstall();
