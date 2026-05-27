const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const viteConfig = path.join(projectRoot, 'vite.config.js');
const command = process.argv[2] || 'dev';
const extraArgs = process.argv.slice(3);

const vitePkg = require.resolve('vite/package.json', { paths: [projectRoot] });
const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js');

const args = ['--configLoader', 'runner', command, '--config', viteConfig, ...extraArgs];
const result = spawnSync(process.execPath, [viteBin, ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
