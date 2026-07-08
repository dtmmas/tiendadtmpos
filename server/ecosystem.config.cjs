const appName = process.env.APP_NAME || 'tiendadtmpos-api'
const appCwd = process.env.APP_CWD || './server'
const appPort = Number(process.env.PORT || 4003)

module.exports = {
  apps: [
    {
      name: appName,
      cwd: appCwd,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        HOST: process.env.HOST || '0.0.0.0',
        PORT: appPort,
      },
    },
  ],
}
