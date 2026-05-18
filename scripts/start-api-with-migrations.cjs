#!/usr/bin/env node
const { spawn, spawnSync } = require('node:child_process');

function npmCommand() {
  return process.platform === 'win32' ? 'cmd.exe' : 'npm';
}

function npmArgs(args) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', ['npm', ...args].join(' ')] : args;
}

function run(label, args) {
  console.log(`[api-prod] ${label}`);
  const result = spawnSync(npmCommand(), npmArgs(args), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`[api-prod] ${label} failed`);
    process.exit(result.status || 1);
  }
}

function start(args) {
  const child = spawn(npmCommand(), npmArgs(args), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code || 0);
  });
}

run('database migration', ['run', 'db:migrate', '-w', 'arbor-os']);
start(['run', 'start', '-w', 'arbor-os']);
