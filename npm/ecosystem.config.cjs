module.exports = {
  apps: [
    {
      name: "monad.ai",
      script: "server.ts",
      cwd: "/mnt/neuroverse/monad.ai/monad.npm",
      env: {
        NODE_ENV: "production",
        PORT: 8383
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      output: "logs/output.log",
      error: "logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};
