const { spawnSync } = require('node:child_process');

const npmCommand = process.execPath;
const npmArgsPrefix = [process.env.npm_execpath].filter(Boolean);
const steps = [
  ['module resolution', [npmCommand, [...npmArgsPrefix, 'run', 'test:module-resolution']]],
  ['typecheck', [npmCommand, [...npmArgsPrefix, 'run', 'typecheck']]],
  ['lint', [npmCommand, [...npmArgsPrefix, 'run', 'lint']]],
  ['offline queue tests', [npmCommand, [...npmArgsPrefix, 'run', 'test:offline-queue']]],
];

if (process.env.SMOKE_API === '1') {
  steps.push(['backend API smoke', [npmCommand, [...npmArgsPrefix, 'run', 'smoke:api']]]);
}

function runStep(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error);
  }
  if (result.status !== 0) {
    console.error(`\nFAIL: ${label}`);
    process.exit(result.status || 1);
  }
}

for (const [label, [command, args]] of steps) {
  runStep(label, command, args);
}

console.log('\nPASS: automated mobile smoke checks completed.');
console.log('Next: run the manual device checklist in docs/mobile-device-smoke-checklist.md.');
if (process.env.SMOKE_API !== '1') {
  console.log('Optional: set SMOKE_API=1 and AUTH_TOKEN=... to include backend API smoke checks.');
}
