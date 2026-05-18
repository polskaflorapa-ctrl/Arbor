#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const projectName = process.env.CF_PAGES_PROJECT_NAME || 'arbor-web';
const dryRun = process.argv.includes('--dry-run');

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`[cloudflare-pages] ${label}`);
  if (dryRun) return;
  const executable = process.platform === 'win32' && (command === 'npm' || command === 'npx') ? 'cmd.exe' : command;
  const finalArgs =
    process.platform === 'win32' && (command === 'npm' || command === 'npx')
      ? ['/d', '/s', '/c', [command, ...args].join(' ')]
      : args;
  const result = spawnSync(executable, finalArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) throw new Error(`Step failed: ${label}`);
}

try {
  run('npm', ['run', 'build', '-w', 'arbor-web']);
  run('npx', ['--yes', 'wrangler', 'pages', 'deploy', 'web/build', '--project-name', projectName]);
  console.log('[cloudflare-pages] done');
} catch (error) {
  console.error(`[cloudflare-pages] FAILED: ${error.message}`);
  process.exit(1);
}
