#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, '.expo-export-check');

function removeOutputDir() {
  const resolved = path.resolve(outputDir);
  if (!resolved.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error(`Refusing to remove unexpected path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runExpoExport() {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmCli
    ? [npmCli, 'exec', '--', 'expo', 'export', '--platform', 'ios', '--clear', '--output-dir', outputDir]
    : ['exec', '--', 'expo', 'export', '--platform', 'ios', '--clear', '--output-dir', outputDir];

  return spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
}

console.log('Checking Metro iOS bundle resolution...\n');

removeOutputDir();
const result = runExpoExport();
removeOutputDir();

if (result.status !== 0) {
  console.error('\nMetro bundle check failed.');
  process.exit(result.status || 1);
}

console.log('\nMetro bundle check passed.');
