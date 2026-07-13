const fs = require('node:fs');
const path = require('node:path');
const { createRetryableInitializer } = require('../../os/src/lib/retryable-initializer');

async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  try {
    const { getConnectionString } = await import('@netlify/database');
    const connectionString = getConnectionString();
    if (connectionString) process.env.DATABASE_URL = connectionString;
  } catch (error) {
    console.warn('[netlify-api] Netlify Database connection unavailable', { message: error.message });
  }
}

async function runColdStartMigrations() {
  const pool = require('../../os/src/config/database');
  const migratePath = path.resolve(__dirname, '../../os/migrate.sql');
  if (fs.existsSync(migratePath)) {
    await pool.query(fs.readFileSync(migratePath, 'utf8'));
  }

  const tasksRoutes = require('../../os/src/routes/tasks');
  if (tasksRoutes.runMigration) await tasksRoutes.runMigration();
}

function normalizeEventPath(event) {
  const functionPath = '/.netlify/functions/api';
  const pathValue = event.path || '';
  if (pathValue === functionPath) {
    return { ...event, path: '/api' };
  }
  if (pathValue.startsWith(`${functionPath}/`)) {
    return { ...event, path: `/api/${pathValue.slice(`${functionPath}/`.length)}` };
  }
  return event;
}

const getHandler = createRetryableInitializer(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
  process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/arbor-uploads';
  process.env.PHONE_RECORDING_STORAGE = process.env.PHONE_RECORDING_STORAGE || 'none';
  process.env.METRICS_ENABLED = process.env.METRICS_ENABLED || 'false';

  await resolveDatabaseUrl();
  await runColdStartMigrations();

  const serverless = require('serverless-http');
  const { createApp } = require('../../os/src/app');
  const { initSentry } = require('../../os/src/config/sentry');
  return serverless(createApp({ sentry: initSentry() }));
});

exports.handler = async (event, context) => {
  const handler = await getHandler();
  return handler(normalizeEventPath(event), context);
};

exports.config = {
  path: '/api/*',
};
