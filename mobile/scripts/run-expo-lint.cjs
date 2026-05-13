/** Uruchamia lokalny ESLint z katalogu mobile w monorepo. */
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

function envWithoutLegacyNpmDevdir() {
  const env = { ...process.env };
  delete env.npm_config_devdir;
  delete env.NPM_CONFIG_DEVDIR;
  return env;
}

const eslintName = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
const eslintCandidates = [
  join(__dirname, '..', 'node_modules', '.bin', eslintName),
  join(__dirname, '..', '..', 'node_modules', '.bin', eslintName),
];
const eslintBin = eslintCandidates.find((candidate) => existsSync(candidate)) || eslintCandidates[0];

const result = spawnSync(eslintBin, ['app', '--ext', 'ts,tsx'], {
  stdio: 'inherit',
  env: envWithoutLegacyNpmDevdir(),
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
