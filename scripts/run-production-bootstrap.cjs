#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const skipBackup = argv.includes('--skip-backup');
const skipStorage = argv.includes('--skip-storage');

function argValue(name, fallback = '') {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function envFilePath() {
  return path.resolve(argValue('--env', 'deploy/local-production.env'));
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return dotenv.parse(fs.readFileSync(file));
}

function redactedUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<unparseable>';
  }
}

function hasPlaceholder(value) {
  return /<[^>]+>/.test(String(value || ''));
}

function validate(env) {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'BOOTSTRAP_ADMIN_LOGIN',
    'BOOTSTRAP_ADMIN_PASSWORD',
    'BOOTSTRAP_ADMIN_EMAIL',
    'BOOTSTRAP_ADMIN_ROLE',
    'BOOTSTRAP_ADMIN_BRANCH_NAME',
  ];
  if ((env.UPLOAD_STORAGE || '').toLowerCase() === 's3') {
    required.push(
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_PUBLIC_BASE_URL'
    );
  }

  const missing = [];
  const placeholders = [];
  for (const key of required) {
    if (!env[key]) missing.push(key);
    else if (hasPlaceholder(env[key])) placeholders.push(key);
  }

  if (env.BOOTSTRAP_ADMIN_PASSWORD && env.BOOTSTRAP_ADMIN_PASSWORD.length < 12) {
    missing.push('BOOTSTRAP_ADMIN_PASSWORD(min 12 chars)');
  }

  if (missing.length || placeholders.length) {
    if (missing.length) console.error(`[prod-bootstrap] Missing: ${missing.join(', ')}`);
    if (placeholders.length) console.error(`[prod-bootstrap] Still placeholders: ${placeholders.join(', ')}`);
    throw new Error('Fill deploy/local-production.env before running production bootstrap.');
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'cmd.exe' : 'npm';
}

function npmArgs(args) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', ['npm', ...args].join(' ')] : args;
}

function run(label, args, env) {
  console.log(`[prod-bootstrap] ${label}`);
  if (dryRun) return;
  const result = spawnSync(npmCommand(), npmArgs(args), {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`${label} failed`);
}

function main() {
  const file = envFilePath();
  const fileEnv = loadEnvFile(file);
  const env = {
    ...process.env,
    ...fileEnv,
    NODE_ENV: fileEnv.NODE_ENV || process.env.NODE_ENV || 'production',
  };

  console.log(`[prod-bootstrap] env_file=${file}${fs.existsSync(file) ? '' : ' (missing)'}`);
  console.log(`[prod-bootstrap] database=${redactedUrl(env.DATABASE_URL) || 'missing'}`);
  console.log(`[prod-bootstrap] admin_login=${env.BOOTSTRAP_ADMIN_LOGIN || 'missing'}`);
  console.log(`[prod-bootstrap] upload_storage=${env.UPLOAD_STORAGE || 'local'}`);

  validate(env);

  run('database migration', ['run', 'db:migrate', '-w', 'arbor-os'], env);
  run('production admin bootstrap', ['run', 'bootstrap:admin', '-w', 'arbor-os'], env);
  run(
    'production doctor',
    ['run', 'deploy:prod:doctor', ...(skipStorage ? ['--', '--skip-storage'] : [])],
    env
  );

  if (!skipBackup) {
    run('first database backup', ['run', 'backup:db'], env);
  } else {
    console.log('[prod-bootstrap] backup skipped by --skip-backup');
  }

  console.log('[prod-bootstrap] done');
}

try {
  main();
} catch (error) {
  console.error(`[prod-bootstrap] FAILED: ${error.message}`);
  process.exit(1);
}
