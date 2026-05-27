#!/usr/bin/env node
process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { resolvePostgresBinary } = require('./db-connection');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const strict = args.has('--strict');

function nowStamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
}

function backupDir() {
  return path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
}

function backupFilePath() {
  return path.join(backupDir(), `arbor_${nowStamp()}.dump`);
}

function pgDumpBin() {
  return resolvePostgresBinary('pg_dump', 'PG_DUMP_BIN');
}

function redact(value) {
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

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: options.stdio || 'inherit',
    shell: false,
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result;
}

function checkPgDumpAvailable() {
  try {
    run(pgDumpBin(), ['--version'], { stdio: 'pipe' });
    return true;
  } catch (error) {
    const message = `pg_dump not available (${error.message}). Install PostgreSQL client tools or set PG_DUMP_BIN.`;
    if (strict || !dryRun) throw new Error(message, { cause: error });
    console.warn(`[backup] WARN ${message}`);
    return false;
  }
}

function connectionArgs() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return { args: [databaseUrl], env: {} };

  const dbName = process.env.DB_NAME || 'arbor_os';
  return {
    args: [
      '-h',
      process.env.DB_HOST || 'localhost',
      '-p',
      String(process.env.DB_PORT || 5432),
      '-U',
      process.env.DB_USER || 'postgres',
      dbName,
    ],
    env: { PGPASSWORD: process.env.DB_PASSWORD || 'postgres' },
  };
}

function encryptFile(inputPath, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = fs.readFileSync(inputPath);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const outputPath = `${inputPath}.enc`;
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from('ARBORBK1'), salt, iv, tag, encrypted]));
  fs.rmSync(inputPath, { force: true });
  return outputPath;
}

function rotateOldBackups(dir) {
  const retainDays = Number(process.env.BACKUP_RETAIN_DAYS || 14);
  if (!Number.isFinite(retainDays) || retainDays <= 0) return 0;
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/^arbor_.*\.dump(\.enc)?$/.test(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(fullPath, { force: true });
      deleted += 1;
    }
  }
  return deleted;
}

function main() {
  const dir = backupDir();
  const databaseUrl = process.env.DATABASE_URL;
  console.log(`[backup] target_dir=${dir}`);
  console.log(`[backup] database=${databaseUrl ? redact(databaseUrl) : process.env.DB_NAME || 'arbor_os'}`);

  const toolOk = checkPgDumpAvailable();
  if (dryRun) {
    console.log(`[backup] dry_run=1 pg_dump=${toolOk ? 'ok' : 'missing'}`);
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  const filePath = backupFilePath();
  const conn = connectionArgs();
  const dumpArgs = ['--format=custom', '--compress=6', ...conn.args, '-f', filePath];
  console.log(`[backup] starting pg_dump -> ${filePath}`);
  run(pgDumpBin(), dumpArgs, { env: conn.env });

  let finalPath = filePath;
  if (process.env.BACKUP_ENCRYPT_KEY) {
    finalPath = encryptFile(filePath, process.env.BACKUP_ENCRYPT_KEY);
    console.log(`[backup] encrypted -> ${finalPath}`);
  }

  const latestPath = path.join(dir, process.env.BACKUP_ENCRYPT_KEY ? 'latest.dump.enc' : 'latest.dump');
  fs.copyFileSync(finalPath, latestPath);
  const sizeMb = Math.round((fs.statSync(finalPath).size / 1024 / 1024) * 100) / 100;
  const deleted = rotateOldBackups(dir);
  console.log(`[backup] done file=${finalPath} size_mb=${sizeMb} latest=${latestPath} rotated=${deleted}`);
}

try {
  main();
} catch (error) {
  console.error(`[backup] FAILED: ${error.message}`);
  process.exit(1);
}
