#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const platforms = ['ios', 'android'];

function getWindowsHermescPath() {
  return path.join(rootDir, '..', 'node_modules', 'react-native', 'sdks', 'hermesc', 'win64-bin', 'hermesc.exe');
}

function getOutputDir(platform) {
  return path.join(rootDir, `.expo-export-check-${platform}`);
}

function removeOutputDir(outputDir) {
  const resolved = path.resolve(outputDir);
  if (!resolved.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error(`Refusing to remove unexpected path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runExpoExport(platform, outputDir) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmCli
    ? [npmCli, 'exec', '--', 'expo', 'export', '--platform', platform, '--clear', '--output-dir', outputDir]
    : ['exec', '--', 'expo', 'export', '--platform', platform, '--clear', '--output-dir', outputDir];

  return spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
}

function preflightHermesCompiler() {
  if (process.platform !== 'win32') {
    return;
  }

  const hermescPath = getWindowsHermescPath();
  if (!fs.existsSync(hermescPath)) {
    return;
  }

  const check = spawnSync(hermescPath, ['-help'], { stdio: 'pipe', encoding: 'utf8' });
  const output = `${check.stdout || ''}\n${check.stderr || ''}`;
  const permissionDenied =
    check.error?.code === 'EACCES' ||
    check.error?.code === 'EPERM' ||
    /permission denied|access is denied/i.test(output);

  if (permissionDenied) {
    console.error('Hermes compiler cannot execute on this machine.');
    console.error(`Path: ${hermescPath}`);
    console.error('Fix permissions (example: Unblock-File or ACL update) and rerun release checks.');
    process.exit(1);
  }
}

console.log('Checking Metro native bundle resolution...\n');
preflightHermesCompiler();

for (const platform of platforms) {
  const outputDir = getOutputDir(platform);

  console.log(`== ${platform} ==\n`);
  removeOutputDir(outputDir);
  const result = runExpoExport(platform, outputDir);
  removeOutputDir(outputDir);

  if (result.status !== 0) {
    console.error(`\nMetro ${platform} bundle check failed.`);
    process.exit(result.status || 1);
  }
}

console.log('\nMetro bundle check passed.');
