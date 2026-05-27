const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const viteConfig = path.join(projectRoot, 'vite.config.js');
const mode = process.argv[2] === 'watch' ? 'watch' : 'run';
const extraArgs = process.argv.slice(3);
const vitestBin = path.join(projectRoot, '..', 'node_modules', 'vitest', 'vitest.mjs');

const args = [
  mode,
  '--config',
  viteConfig,
  '--root',
  projectRoot,
  '--configLoader',
  'runner',
  '--maxWorkers',
  '1',
  '--no-file-parallelism',
];

if (mode === 'run') {
  args.push('--passWithNoTests');
}

args.push(...extraArgs);

const result = spawnSync(process.execPath, [vitestBin, ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
