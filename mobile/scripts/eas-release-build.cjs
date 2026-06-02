#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const easCliPackage = 'eas-cli@19.1.0';
const easExecDir = path.join(os.tmpdir(), 'arbor-eas-cli');

const [, , platformArg, profileArg] = process.argv;
const platform = platformArg || 'ios';
const profile = profileArg || 'preview';
const allowedPlatforms = new Set(['ios', 'android', 'all']);
const allowedProfiles = new Set(['development', 'preview', 'production']);

function fail(message) {
  console.error(`x ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      EAS_NO_VCS: process.env.EAS_NO_VCS || '1',
    },
    stdio: 'inherit',
    ...options,
  });
}

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = npmCli ? [npmCli, ...args] : args;
  return run(command, npmArgs);
}

function runStep(label, result) {
  if (result.status !== 0) {
    fail(`${label} failed`);
  }
}

if (!allowedPlatforms.has(platform)) {
  fail(`Unsupported platform "${platform}". Use ios, android, or all.`);
}

if (!allowedProfiles.has(profile)) {
  fail(`Unsupported profile "${profile}". Use development, preview, or production.`);
}

console.log(`Preparing EAS ${platform} ${profile} build...\n`);

runStep('release:check', runNpm(['run', 'release:check']));
runStep('release:eas-doctor', runNpm(['run', 'release:eas-doctor']));

const easArgs = [
  'exec',
  '--yes',
  '--prefix',
  easExecDir,
  '--package',
  easCliPackage,
  '--',
  'eas',
  'build',
  '--platform',
  platform,
  '--profile',
  profile,
  '--non-interactive',
];

fs.mkdirSync(easExecDir, { recursive: true });
runStep(`EAS ${platform} ${profile} build`, runNpm(easArgs));

console.log(`\nEAS ${platform} ${profile} build command completed.`);
