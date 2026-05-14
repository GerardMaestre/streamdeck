const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name:'Stream Deck Pro Server',
  description: 'The Node.js server for Stream Deck Pro.',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install',function(){
  svc.start();
  console.log('Service installed and started!');
});

svc.install();
