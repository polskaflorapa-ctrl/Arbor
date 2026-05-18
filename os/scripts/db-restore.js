#!/usr/bin/env node
process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const clean = argv.includes('--clean') || process.env.RESTORE_CLEAN === '1';

function argValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
}

function pgRestoreBin() {
  return process.env.PG_RESTORE_BIN || 'pg_restore';
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

function backupDir() {
  return path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
}

function latestBackupPath() {
  const encrypted = path.join(backupDir(), 'latest.dump.enc');
  if (fs.existsSync(encrypted)) return encrypted;
  return path.join(backupDir(), 'latest.dump');
}

function decryptFile(inputPath) {
  const passphrase = process.env.BACKUP_ENCRYPT_KEY;
  if (!passphrase) throw new Error('BACKUP_ENCRYPT_KEY is required for encrypted backup restore.');
  const payload = fs.readFileSync(inputPath);
  const magic = payload.subarray(0, 8).toString('utf8');
  if (magic !== 'ARBORBK1') throw new Error('Unsupported encrypted backup format.');
  const salt = payload.subarray(8, 24);
  const iv = payload.subarray(24, 36);
  const tag = payload.subarray(36, 52);
  const encrypted = payload.subarray(52);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const tempPath = path.join(os.tmpdir(), `arbor_restore_${Date.now()}.dump`);
  fs.writeFileSync(tempPath, plain);
  return tempPath;
}

function resolveDumpPath() {
  const fromArg = argValue('--file');
  const filePath = fromArg || process.env.RESTORE_FILE || latestBackupPath();
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`Backup file not found: ${resolved}`);
  if (resolved.endsWith('.enc')) return { original: resolved, usable: decryptFile(resolved), temporary: true };
  return { original: resolved, usable: resolved, temporary: false };
}

function targetDatabaseArg() {
  if (process.env.DATABASE_URL) return { args: ['--dbname', process.env.DATABASE_URL], env: {} };
  return {
    args: [
      '--host',
      process.env.DB_HOST || 'localhost',
      '--port',
      String(process.env.DB_PORT || 5432),
      '--username',
      process.env.DB_USER || 'postgres',
      '--dbname',
      process.env.DB_NAME || 'arbor_dev',
    ],
    env: { PGPASSWORD: process.env.DB_PASSWORD || 'postgres' },
  };
}

function main() {
  const dump = resolveDumpPath();
  try {
    console.log(`[restore] file=${dump.original}`);
    run(pgRestoreBin(), ['--version'], { stdio: 'pipe' });

    if (dryRun) {
      run(pgRestoreBin(), ['--list', dump.usable], { stdio: 'pipe' });
      console.log('[restore] dry_run=1 dump is readable');
      return;
    }

    if (process.env.CONFIRM_RESTORE !== 'YES') {
      throw new Error('Refusing restore. Set CONFIRM_RESTORE=YES to run pg_restore.');
    }

    const target = targetDatabaseArg();
    const restoreArgs = ['--verbose', '--no-owner', '--no-acl'];
    if (clean) restoreArgs.push('--clean', '--if-exists');
    restoreArgs.push(...target.args, dump.usable);
    run(pgRestoreBin(), restoreArgs, { env: target.env });
    console.log('[restore] done');
  } finally {
    if (dump.temporary) fs.rmSync(dump.usable, { force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[restore] FAILED: ${error.message}`);
  process.exit(1);
}
