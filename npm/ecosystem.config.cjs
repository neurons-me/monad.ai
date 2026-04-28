// PM2 ecosystem configuration file
// This file defines how the "monad.ai" application should be run and managed by PM2
// PM2 is a process manager for Node.js applications (handles restarts, logs, scaling, etc.)
module.exports = {
  apps: [
    // List of applications managed by PM2
    {
      // Name of the app as it will appear in PM2 process list
      name: "monad.ai",
      // Entry point of the application (TypeScript file in this case)
      script: "server.ts",
      // Current working directory where the app will be executed
      cwd: "/mnt/neuroverse/monad.ai/monad.npm",
      // Environment variables passed to the application
      env: {
        // Defines environment mode (production, development, etc.)
        NODE_ENV: "production",
        // Port where the server will run
        PORT: 8383
      },
      // Execution mode: "fork" runs a single instance (no clustering)
      exec_mode: "fork",
      // Number of instances to run (only relevant in cluster mode)
      instances: 1,
      // Automatically restart the app if it crashes
      autorestart: true,
      // Watch files for changes and restart automatically (disabled in production)
      watch: false,
      // Restart the app if it exceeds this memory limit
      max_memory_restart: "1G",
      // File where standard output logs are written
      output: "logs/output.log",
      // File where error logs are written
      error: "logs/error.log",
      // Format for timestamps in logs
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};
