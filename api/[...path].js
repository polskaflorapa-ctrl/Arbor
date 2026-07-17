process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/arbor-uploads';
process.env.PHONE_RECORDING_STORAGE = process.env.PHONE_RECORDING_STORAGE || 'none';
process.env.METRICS_ENABLED = process.env.METRICS_ENABLED || 'false';

const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../os/src/app');
const { initSentry } = require('../os/src/config/sentry');
const { createRetryableInitializer } = require('../os/src/lib/retryable-initializer');

let app;

async function runColdStartMigrations() {
  if (process.env.VERCEL_RUN_MIGRATIONS !== '1') {
    return;
  }

  if (!process.env.DATABASE_URL) {
    return;
  }

  const pool = require('../os/src/config/database');
  const migratePath = path.resolve(__dirname, '../os/migrate.sql');
  if (!fs.existsSync(migratePath)) {
    console.warn('[vercel-api] os/migrate.sql not found, skipping cold-start migrations');
    return;
  }

  await pool.query(fs.readFileSync(migratePath, 'utf8'));
}

const getApp = createRetryableInitializer(async () => {
  await runColdStartMigrations();
  return app || (app = createApp({ sentry: initSentry() }));
});

module.exports = async (req, res) => {
  try {
    if (!app) {
      app = await getApp();
    }
    return app(req, res);
  } catch (error) {
    console.error('[vercel-api] initialization failed', { message: error.message });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'API initialization failed' }));
    }
  }
};
