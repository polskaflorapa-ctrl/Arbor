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
const eslintBinCandidates = [
  join(__dirname, '..', 'node_modules', '.bin', eslintName),
  join(__dirname, '..', '..', 'node_modules', '.bin', eslintName),
];
const eslintJsCandidates = [
  join(__dirname, '..', 'node_modules', 'eslint', 'bin', 'eslint.js'),
  join(__dirname, '..', '..', 'node_modules', 'eslint', 'bin', 'eslint.js'),
];
const eslintBin = eslintBinCandidates.find((candidate) => existsSync(candidate));
const eslintJs = eslintJsCandidates.find((candidate) => existsSync(candidate));

const command = eslintBin ? eslintBin : process.execPath;
const lintTargets = ['app', 'components', 'hooks', 'utils', 'constants'];
const args = eslintBin
  ? [...lintTargets, '--ext', 'ts,tsx']
  : eslintJs
    ? [eslintJs, ...lintTargets, '--ext', 'ts,tsx']
    : null;

if (!args) {
  console.error('Could not locate ESLint binary or eslint/bin/eslint.js in mobile or repo root node_modules.');
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: envWithoutLegacyNpmDevdir(),
  shell: Boolean(eslintBin && process.platform === 'win32'),
});

process.exit(result.status ?? 1);
