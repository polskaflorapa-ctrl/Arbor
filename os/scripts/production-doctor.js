#!/usr/bin/env node
process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const { getPgClientConfig } = require('./db-connection');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const skipDb = args.has('--skip-db');
const skipStorage = args.has('--skip-storage');
const strict = args.has('--strict');

const checks = [];

function mark(level, name, message, details) {
  checks.push({ level, name, message, details });
  const prefix = level === 'ok' ? 'OK' : level === 'warn' ? 'WARN' : 'FAIL';
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[prod-doctor] ${prefix} ${name}: ${message}${suffix}`);
}

function ok(name, message, details) {
  mark('ok', name, message, details);
}

function warn(name, message, details) {
  mark('warn', name, message, details);
}

function fail(name, message, details) {
  mark('fail', name, message, details);
}

function env(name) {
  const value = process.env[name];
  return value == null ? '' : String(value).trim();
}

function redactConnectionString(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    if (url.username) url.username = '***';
    return url.toString();
  } catch {
    return '<unparseable>';
  }
}

function checkRuntimeEnv() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) ok('node', `Node ${process.versions.node}`);
  else fail('node', `Node ${process.versions.node} is too old. Required: >=20.`);

  const nodeEnv = env('NODE_ENV') || 'development';
  ok('NODE_ENV', nodeEnv);

  if (nodeEnv === 'production') {
    if (env('JWT_SECRET')) ok('JWT_SECRET', 'configured');
    else fail('JWT_SECRET', 'missing in production');
  } else if (!env('JWT_SECRET')) {
    warn('JWT_SECRET', 'missing, local dev fallback will be used');
  }

  const cors = env('CORS_ORIGINS');
  if (cors) ok('CORS_ORIGINS', 'configured', { value: cors });
  else warn('CORS_ORIGINS', 'not configured yet; set it after web deploy URL is known');

  const publicBase = env('PUBLIC_BASE_URL') || env('RENDER_EXTERNAL_URL');
  if (publicBase) ok('PUBLIC_BASE_URL', 'configured or provided by Render', { value: publicBase });
  else warn('PUBLIC_BASE_URL', 'not set; Render normally provides RENDER_EXTERNAL_URL');
}

function checkDatabaseEnv() {
  const databaseUrl = env('DATABASE_URL');
  if (!databaseUrl) {
    if (skipDb) {
      warn('DATABASE_URL', 'missing, skipped by --skip-db');
      return;
    }
    fail('DATABASE_URL', 'missing. Use Neon pooled connection string.');
    return;
  }

  const redacted = redactConnectionString(databaseUrl);
  ok('DATABASE_URL', 'configured', { value: redacted });

  try {
    const url = new URL(databaseUrl);
    const host = url.hostname || '';
    if (host.includes('neon.tech')) ok('DATABASE_URL.host', 'Neon host detected', { host });
    else warn('DATABASE_URL.host', 'host does not look like Neon', { host });
    if (host.includes('pooler')) ok('DATABASE_URL.pooler', 'pooled Neon host detected');
    else warn('DATABASE_URL.pooler', 'host does not include pooler; Neon Free should use pooled connection');
  } catch {
    fail('DATABASE_URL.parse', 'cannot parse DATABASE_URL');
  }

  const poolMaxRaw = env('DB_POOL_MAX');
  const poolMax = Number(poolMaxRaw || 20);
  if (poolMax <= 5) ok('DB_POOL_MAX', `${poolMax}`);
  else warn('DB_POOL_MAX', `${poolMax}; recommended <=5 for Neon Free`);
}

async function checkDatabaseConnection() {
  if (skipDb) {
    warn('database', 'skipped by --skip-db');
    return;
  }
  if (!env('DATABASE_URL')) return;

  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const ping = await client.query('SELECT 1 AS ok');
    if (ping.rows[0]?.ok === 1) ok('database.ping', 'connected');
    else fail('database.ping', 'unexpected ping result');

    const tables = ['branches', 'users', 'tasks', 'quotations', 'photos', 'annotated_photos'];
    const tableRes = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [tables]
    );
    const existing = new Set(tableRes.rows.map((row) => row.table_name));
    const missing = tables.filter((table) => !existing.has(table));
    if (missing.length) fail('database.schema', 'missing migrated tables', { missing });
    else ok('database.schema', 'core tables present');

    const adminRes = await client.query(
      `SELECT COUNT(*)::int AS c
       FROM users
       WHERE aktywny IS NOT FALSE AND rola IN ('Prezes', 'Dyrektor', 'Administrator')`
    );
    const adminCount = adminRes.rows[0]?.c || 0;
    if (adminCount > 0) ok('database.admin', `${adminCount} active admin/director users`);
    else fail('database.admin', 'no active Prezes/Dyrektor/Administrator user; run npm run bootstrap:admin');

    const login = env('SMOKE_LOGIN') || env('BOOTSTRAP_ADMIN_LOGIN');
    if (login) {
      const loginRes = await client.query(
        `SELECT id, rola, aktywny FROM users WHERE login = $1 LIMIT 1`,
        [login]
      );
      const row = loginRes.rows[0];
      if (row?.aktywny !== false) ok('database.smokeLogin', 'login exists and is active', { login, role: row.rola });
      else fail('database.smokeLogin', 'login missing or inactive', { login });
    } else {
      warn('database.smokeLogin', 'SMOKE_LOGIN/BOOTSTRAP_ADMIN_LOGIN not set; exact login not checked');
    }
  } finally {
    await client.end();
  }
}

async function checkStorage() {
  const mode = (env('UPLOAD_STORAGE') || 'local').toLowerCase();
  if (mode === 'local') {
    warn('UPLOAD_STORAGE', 'local; OK for quick tests, not durable on Render Free');
  } else if (mode === 's3') {
    ok('UPLOAD_STORAGE', 's3');
    for (const name of ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL']) {
      if (env(name)) ok(name, 'configured');
      else fail(name, 'missing for UPLOAD_STORAGE=s3');
    }
  } else {
    fail('UPLOAD_STORAGE', `unsupported mode: ${mode}`);
  }

  if (skipStorage) {
    warn('storage.selftest', 'skipped by --skip-storage');
    return;
  }

  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'production-doctor-placeholder';
  }
  const { runUploadStorageSelfTest } = require('../src/services/upload-storage');
  const result = await runUploadStorageSelfTest();
  if (result.ok) {
    ok('storage.selftest', result.checked, {
      mode: result.mode,
      durable: result.durable,
      public_check: result.public_check || null,
    });
  } else {
    fail('storage.selftest', 'failed', result);
  }
}

async function main() {
  checkRuntimeEnv();
  checkDatabaseEnv();
  await checkDatabaseConnection();
  await checkStorage();

  const failCount = checks.filter((check) => check.level === 'fail').length;
  const warnCount = checks.filter((check) => check.level === 'warn').length;
  const okCount = checks.filter((check) => check.level === 'ok').length;
  console.log(`[prod-doctor] SUMMARY ok=${okCount} warn=${warnCount} fail=${failCount}`);

  if (failCount > 0 || (strict && warnCount > 0)) {
    process.exit(1);
  }
}

main().catch((error) => {
  fail('doctor', error.message);
  console.log('[prod-doctor] SUMMARY ok=0 warn=0 fail=1');
  process.exit(1);
});
