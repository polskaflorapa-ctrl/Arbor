const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const VERCEL_PACKAGE = 'vercel@50.28.0';

function withToken(args) {
  if (!process.env.VERCEL_TOKEN) {
    return args;
  }
  return [...args, '--token', process.env.VERCEL_TOKEN];
}

function displayArgs(args) {
  return args.map((arg, index) => (args[index - 1] === '--token' ? '<redacted>' : arg));
}

function run(command, args, options = {}) {
  const label = [command, ...displayArgs(args)].join(' ');
  console.log(`[deploy-vercel-prod] ${label}`);
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

function runVercel(args, options = {}) {
  run('npm', ['exec', '--yes', '--package', VERCEL_PACKAGE, '--', 'vercel', ...withToken(args)], options);
}

function assertVercelAuth() {
  const args = ['exec', '--yes', '--package', VERCEL_PACKAGE, '--', 'vercel', ...withToken(['whoami'])];
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        'Vercel CLI is not authenticated.',
        'Run: npm exec --yes --package vercel@50.28.0 -- vercel login',
        'Alternatively set VERCEL_TOKEN and rerun this script with the token-aware CLI workflow.',
      ].join(' '),
    );
  }
}

function hasCiProjectLink() {
  return Boolean(process.env.VERCEL_ORG_ID && process.env.VERCEL_PROJECT_ID);
}

function assertLinkedProject() {
  if (!fs.existsSync('.vercel/project.json') && !hasCiProjectLink()) {
    throw new Error(
      [
        'This repo is not linked to a Vercel project.',
        'Run: npm exec --yes --package vercel@50.28.0 -- vercel link',
        'Or set VERCEL_ORG_ID and VERCEL_PROJECT_ID for CI.',
        'Then set production env vars in Vercel and rerun deploy:vercel.',
      ].join(' '),
    );
  }
}

function main() {
  run('npm', ['run', 'deploy:vercel:check']);
  assertVercelAuth();
  assertLinkedProject();
  runVercel(['pull', '--yes', '--environment=production']);
  runVercel(['build', '--prod']);
  runVercel(['deploy', '--prebuilt', '--prod']);
}

try {
  main();
} catch (error) {
  console.error(`[deploy-vercel-prod] FAILED: ${error.message}`);
  process.exit(1);
}
