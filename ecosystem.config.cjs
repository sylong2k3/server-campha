module.exports = {
  apps: [
    {
      name: 'gis-campha',
      script: './server.js',
      cwd: __dirname,
      interpreter: 'node',

      // Production runtime
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      restart_delay: 3000,
      kill_timeout: 10000,

      // Logs
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // `pm2 start ecosystem.config.cjs` (không cờ --env) dùng khối `env` này.
      // Đây là runtime production thật (out_file/error_file, autorestart,
      // max_memory_restart ở trên đều nhắm production) — nếu default là
      // 'development', quên gõ `--env production` lúc deploy sẽ âm thầm chạy
      // sai môi trường và lộ stack trace lỗi cho client (xem error-handler.js).
      // Nên mặc định PHẢI là production; muốn chạy dev qua PM2 thì gõ rõ
      // `pm2 start ecosystem.config.cjs --env development`.
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3005,
      },
    },
  ],
};
