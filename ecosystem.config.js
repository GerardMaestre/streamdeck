module.exports = {
  apps: [
    {
      name: 'streamdeck-pro',
      script: 'server.js',
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
