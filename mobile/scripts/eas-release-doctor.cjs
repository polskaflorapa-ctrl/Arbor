#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const easCliPackage = 'eas-cli@19.1.0';
const easExecDir = path.join(os.tmpdir(), 'arbor-eas-cli');

function runEas(args) {
  fs.mkdirSync(easExecDir, { recursive: true });
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = npmCli
    ? [npmCli, 'exec', '--yes', '--prefix', easExecDir, '--package', easCliPackage, '--', 'eas', ...args]
    : ['exec', '--yes', '--prefix', easExecDir, '--package', easCliPackage, '--', 'eas', ...args];

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
  `EAS CLI ${easCliPackage} is available`,
  runEas(['--version']),
  'Check npm network/package access or install EAS CLI globally, then retry: npm install -g eas-cli@19.1.0'
);

if (!cliOk) {
  console.error('\nEAS release doctor stopped before account checks because the EAS CLI is not available.');
  process.exit(1);
}

const authOk = printResult(
  'EAS account is authenticated',
  runEas(['whoami']),
  'Log in with an account that can access this Expo project: npm exec --yes --package eas-cli@19.1.0 -- eas login'
);

if (!authOk) {
  console.error('\nEAS release doctor stopped before project checks because this shell is not logged in.');
  process.exit(1);
}

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
