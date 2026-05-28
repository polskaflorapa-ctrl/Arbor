process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/arbor-uploads';
process.env.PHONE_RECORDING_STORAGE = process.env.PHONE_RECORDING_STORAGE || 'none';
process.env.METRICS_ENABLED = process.env.METRICS_ENABLED || 'false';

const { createApp } = require('../os/src/app');

let app;

module.exports = (req, res) => {
  if (!app) {
    app = createApp();
  }
  return app(req, res);
};
