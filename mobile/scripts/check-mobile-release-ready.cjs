#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`x ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`ok ${message}`);
}

function readJson(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${relativePath} is missing or invalid JSON: ${error.message}`);
    return null;
  }
}

function assertFile(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (fs.existsSync(filePath)) {
    pass(`${relativePath} exists`);
  } else {
    fail(`${relativePath} is missing`);
  }
}

function assertValue(label, value) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    pass(label);
  } else {
    fail(`${label} is missing`);
  }
}

function assertBuildProfile(easConfig, name) {
  const profile = easConfig?.build?.[name];
  if (profile) {
    pass(`eas build profile "${name}" exists`);
  } else {
    fail(`eas build profile "${name}" is missing`);
  }
}

function runNpmScript(name) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmCli ? [npmCli, 'run', name] : ['run', name];

  return spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
}

function runNpmAuditHigh() {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmCli
    ? [npmCli, 'audit', '--omit=dev', '--audit-level=high']
    : ['audit', '--omit=dev', '--audit-level=high'];

  return spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
}

function runExpoConfigCheck() {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmCli
    ? [npmCli, 'exec', '--', 'expo', 'config', '--type', 'public', '--json']
    : ['exec', '--', 'expo', 'config', '--type', 'public', '--json'];

  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    return result;
  }

  try {
    const config = JSON.parse(result.stdout);
    pass(`Expo config resolves for SDK ${config.sdkVersion || 'unknown'}`);
  } catch (error) {
    result.status = 1;
    result.stderr = `Expo config returned invalid JSON: ${error.message}`;
    process.stderr.write(result.stderr);
  }

  return result;
}

console.log('Checking mobile release readiness...\n');

const appConfig = readJson('app.json');
const easConfig = readJson('eas.json');

assertValue('ios.bundleIdentifier is set', appConfig?.expo?.ios?.bundleIdentifier);
assertValue('ios.buildNumber is set', appConfig?.expo?.ios?.buildNumber);
assertValue('android.package is set', appConfig?.expo?.android?.package);
assertValue('android.versionCode is set', appConfig?.expo?.android?.versionCode);

assertBuildProfile(easConfig, 'development');
assertBuildProfile(easConfig, 'preview');
assertBuildProfile(easConfig, 'production');
assertValue('eas cli version guard is set', easConfig?.cli?.version);

assertFile('docs/mobile-device-smoke-checklist.md');
assertFile('docs/mobile-release-runbook.md');
assertFile('docs/mobile-release-risks.md');

if (process.exitCode) {
  console.error('\nRelease readiness check failed before smoke tests.');
  process.exit(process.exitCode);
}

console.log('\nValidating Expo public config...\n');

const expoConfigResult = runExpoConfigCheck();

if (expoConfigResult.status !== 0) {
  fail('npm exec -- expo config --type public failed');
  process.exit(process.exitCode);
}

console.log('\nRunning mobile smoke gate...\n');

const result = runNpmScript('smoke:mobile');

if (result.status !== 0) {
  fail('npm run smoke:mobile failed');
  process.exit(process.exitCode);
}

console.log('\nChecking for high or critical production dependency advisories...\n');

const auditResult = runNpmAuditHigh();

if (auditResult.status !== 0) {
  fail('npm audit --omit=dev --audit-level=high failed');
  process.exit(process.exitCode);
}

console.log('\nMobile release readiness check passed.');
