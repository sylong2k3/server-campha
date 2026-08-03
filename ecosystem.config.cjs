module.exports = {
  apps: [
    {
      name: 'server-campha-hydromap',
      script: './server.js',
      cwd: __dirname,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      restart_delay: 3000,
      kill_timeout: 10000,

      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        PORT: 3006,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3006,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3006,
      },
    },
  ],
};
