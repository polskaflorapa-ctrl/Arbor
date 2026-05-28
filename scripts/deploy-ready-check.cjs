const { spawnSync } = require('node:child_process');

const criticalNodeFiles = [
  'scripts/deploy-free-preflight.cjs',
  'scripts/deploy-vercel-check.cjs',
  'scripts/deploy-netlify-check.cjs',
  'scripts/deploy-koyeb-check.cjs',
  'scripts/demo-deploy-check.cjs',
  'scripts/deploy-cloudflare-pages.cjs',
  'scripts/run-production-bootstrap.cjs',
  'scripts/start-api-with-migrations.cjs',
  'api/[...path].js',
  'os/scripts/seed-president-demo.js',
  'os/scripts/bootstrap-admin.js',
  'os/scripts/production-doctor.js',
  'os/scripts/db-backup.js',
  'os/scripts/db-restore.js',
  'os/scripts/smoke-production-check.js',
  'os/src/config/env.js',
  'os/src/routes/ops.js',
  'os/src/routes/tasks.js',
  'os/src/routes/quotations.js',
  'os/src/routes/ogledziny.js',
  'os/src/services/upload-storage.js',
  'os/src/services/quotationFinalize.js',
];

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`[deploy-ready] ${label}`);
  const executable = process.platform === 'win32' && command === 'npm' ? 'cmd.exe' : command;
  const finalArgs =
    process.platform === 'win32' && command === 'npm'
      ? ['/d', '/s', '/c', ['npm', ...args].join(' ')]
      : args;
  const result = spawnSync(executable, finalArgs, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Step failed: ${label}`);
  }
}

function main() {
  run('npm', ['run', 'deploy:free:check']);
  run('npm', ['run', 'deploy:vercel:check']);
  run('npm', ['run', 'deploy:netlify:check']);
  run('npm', ['run', 'deploy:koyeb:check']);
  run('npm', ['run', 'deploy:demo:check']);
  run('npm', ['run', 'deploy:prod:doctor', '--', '--skip-db', '--skip-storage']);
  run('npm', ['run', 'backup:db:check']);

  for (const file of criticalNodeFiles) {
    run('node', ['-c', file]);
  }

  console.log('[deploy-ready] OK');
}

try {
  main();
} catch (error) {
  console.error(`[deploy-ready] FAILED: ${error.message}`);
  process.exit(1);
}
