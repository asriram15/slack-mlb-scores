/** pm2 config — on Oracle VM: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'mlb-scores',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
