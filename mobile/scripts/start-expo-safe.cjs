#!/usr/bin/env node

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const COMMON_EXPO_PORTS = [8081, 8082, 8083, 19000, 19001, 19002];

function runVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) return `unavailable (${result.error.message})`;
  return String(result.stdout || result.stderr || '').trim() || `exit ${result.status}`;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve({ port, busy: true }));
    server.once('listening', () => {
      server.close(() => resolve({ port, busy: false }));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function printDiagnostics() {
  const nodeVersion = process.version;
  const npmVersion = process.env.npm_execpath
    ? runVersion(process.execPath, [process.env.npm_execpath, '-v'])
    : 'unknown';
  const expoCli = findExpoCli();
  const expoVersion = expoCli
    ? runVersion(process.execPath, [expoCli, '--version'])
    : 'unavailable (expo CLI not found)';
  const ports = await Promise.all(COMMON_EXPO_PORTS.map(checkPort));
  const busyPorts = ports.filter((item) => item.busy).map((item) => item.port);

  console.log('[arbor-mobile] Expo start diagnostics');
  console.log(`[arbor-mobile] node ${nodeVersion}, npm ${npmVersion}, expo ${expoVersion}`);
  if (busyPorts.length) {
    console.log(`[arbor-mobile] busy dev ports: ${busyPorts.join(', ')}`);
    console.log('[arbor-mobile] If Expo exits with code 7, close stale node/expo processes or pass --port <free-port>.');
  } else {
    console.log('[arbor-mobile] common Expo ports look free.');
  }
}

function findExpoCli() {
  const candidates = [
    path.resolve(__dirname, '..', 'node_modules', 'expo', 'bin', 'cli'),
    path.resolve(__dirname, '..', '..', 'node_modules', 'expo', 'bin', 'cli'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function main() {
  await printDiagnostics();
  if (process.env.ARBOR_EXPO_START_DIAGNOSE_ONLY === '1') return;

  const expoCli = findExpoCli();
  if (!expoCli) {
    console.error('[arbor-mobile] Failed to start Expo: local expo CLI was not found. Run npm install from the repo root.');
    process.exit(1);
  }
  const args = [expoCli, 'start', ...process.argv.slice(2)];
  const child = spawn(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[arbor-mobile] Expo stopped by signal ${signal}.`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    console.error(`[arbor-mobile] Failed to start Expo: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(`[arbor-mobile] Start diagnostics failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
