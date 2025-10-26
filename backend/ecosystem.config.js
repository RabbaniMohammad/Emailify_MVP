/**
 * PM2 Ecosystem Configuration for Emailify Backend
 * 
 * This file configures how PM2 manages the Node.js application in production.
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 logs emailify-backend
 * 
 * Learn more: https://pm2.keymetrics.io/docs/usage/application-declaration/
 */

module.exports = {
  apps: [
    {
      // Application name
      name: 'emailify-backend',
      
      // Script to run
      script: './dist/server.js',
      
      // Current working directory
      cwd: '/var/www/emailify-backend/backend',
      
      // Instances (cluster mode)
      // For $10 Lightsail (1 vCPU): Use 1 instance
      // For $20 Lightsail (2 vCPU): Use 2 instances for better concurrency
      // For $40+ Lightsail: Use 'max' to utilize all CPUs
      instances: 1,
      
      // Execution mode
      // 'cluster' for load balancing across instances (use when instances > 1)
      // 'fork' for single instance
      exec_mode: 'fork',
      
      // Watch for file changes (disable in production)
      watch: false,
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/emailify/pm2-error.log',
      out_file: '/var/log/emailify/pm2-out.log',
      log_file: '/var/log/emailify/pm2-combined.log',
      
      // Merge logs from all instances
      merge_logs: true,
      
      // Auto restart on crash
      autorestart: true,
      
      // Maximum restarts within restart_delay
      max_restarts: 10,
      
      // Time to consider app running successfully (ms)
      min_uptime: '10s',
      
      // Max memory restart (auto-restart if memory exceeds)
      // 1536 MB (leave some headroom on 2GB instance)
      max_memory_restart: '1536M',
      
      // Restart delay
      restart_delay: 4000,
      
      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100,
      
      // Listen timeout (time to wait for app to be ready)
      listen_timeout: 10000,
      
      // Kill timeout (time to wait before force killing)
      kill_timeout: 5000,
      
      // Wait for app to be ready before considering it running
      wait_ready: true,
      
      // Advanced features
      instance_var: 'INSTANCE_ID',
      
      // Source map support for better error traces
      source_map_support: true,
      
      // Cron restart (optional - restart daily at 3 AM)
      // cron_restart: '0 3 * * *',
      
      // Auto restart if app is idle
      // autorestart: true,
      
      // Node.js flags (if needed)
      node_args: [
        '--max-old-space-size=1024',  // Limit heap size to 1GB
        // '--inspect',  // Uncomment for debugging
      ],
      
      // Environment-specific args
      args: [],
    },
  ],

  /**
   * Deployment configuration (optional)
   * Use this for automated deployments with PM2
   */
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'YOUR_LIGHTSAIL_IP',  // Replace with your Lightsail public IP
      ref: 'origin/main',
      repo: 'https://github.com/RabbaniMohammad/Emailify_MVP.git',
      path: '/var/www/emailify-backend',
      'post-deploy': 'cd backend && npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      'post-setup': 'npm install',
    },
  },
};
