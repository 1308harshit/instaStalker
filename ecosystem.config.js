module.exports = {
    apps: [
      {
        name: "instagram-scraper-backend",
        script: "dotenv",
        args: "-- node server.js",
        cwd: "/root/instaStalker/backend",
        instances: 1,
        exec_mode: "fork",
        env: {
          NODE_ENV: "production",
          PORT: 3000,
        },
        error_file: "../logs/backend-error.log",
        out_file: "../logs/backend-out.log",
        log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        merge_logs: true,
        autorestart: true,
        watch: false,
        max_memory_restart: "500M",
        min_uptime: "10s",
        max_restarts: 10,
      },
    ],
  };