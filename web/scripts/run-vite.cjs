const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const vitePkg = require.resolve('vite/package.json', { paths: [projectRoot] });
const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js');
const extraArgs = process.argv.slice(2);

const result = spawnSync(process.execPath, [viteBin, '--configLoader', 'runner', ...extraArgs], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
