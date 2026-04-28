/** Uruchamia lokalny ESLint z katalogu mobile w monorepo. */
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

function envWithoutLegacyNpmDevdir() {
  const env = { ...process.env };
  delete env.npm_config_devdir;
  delete env.NPM_CONFIG_DEVDIR;
  return env;
}

const eslintBin = process.platform === 'win32'
  ? join(__dirname, '..', 'node_modules', '.bin', 'eslint.cmd')
  : join(__dirname, '..', 'node_modules', '.bin', 'eslint');

const result = spawnSync(eslintBin, ['app', '--ext', 'ts,tsx'], {
  stdio: 'inherit',
  env: envWithoutLegacyNpmDevdir(),
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
