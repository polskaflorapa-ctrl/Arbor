#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function runEas(args) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = npmCli ? [npmCli, 'exec', '--', 'eas', ...args] : ['exec', '--', 'eas', ...args];

  return spawnSync(command, npmArgs, {
    cwd: rootDir,
    env: {
      ...process.env,
      EAS_NO_VCS: process.env.EAS_NO_VCS || '1',
    },
    encoding: 'utf8',
  });
}

function printResult(label, result, guidance) {
  if (result.status === 0) {
    const output = `${result.stdout || result.stderr || ''}`.trim().split(/\r?\n/)[0];
    console.log(`ok ${label}${output ? `: ${output}` : ''}`);
    return true;
  }

  console.error(`x ${label}`);
  const output = `${result.stderr || result.stdout || ''}`.trim();
  if (output) {
    console.error(output);
  }
  if (guidance) {
    console.error(guidance);
  }
  return false;
}

console.log('Checking EAS release operator environment...\n');

let ok = true;

const cliOk = printResult(
  'EAS CLI is available',
  runEas(['--version']),
  'Install or expose EAS CLI for this shell, then retry: npm install --save-dev eas-cli'
);

if (!cliOk) {
  console.error('\nEAS release doctor stopped before account checks because the EAS CLI is not available.');
  process.exit(1);
}

ok = printResult(
  'EAS account is authenticated',
  runEas(['whoami']),
  'Log in with an account that can access this Expo project: npx eas login'
) && ok;

ok = printResult(
  'EAS project access is available',
  runEas(['project:info', '--non-interactive']),
  'Run this from the mobile directory after EAS authentication and project access are ready. If this is the first cloud build, link or create the Expo project with EAS.'
) && ok;

if (!ok) {
  console.error('\nEAS release doctor failed. Code readiness can still pass, but cloud builds need these operator checks fixed.');
  process.exit(1);
}

console.log('\nEAS release doctor passed.');
