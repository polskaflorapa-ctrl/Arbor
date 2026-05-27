/** Runs the local TypeScript compiler from the mobile workspace or repo root. */
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

function envWithoutLegacyNpmDevdir() {
  const env = { ...process.env };
  delete env.npm_config_devdir;
  delete env.NPM_CONFIG_DEVDIR;
  return env;
}

const tscName = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
const tscBinCandidates = [
  join(__dirname, '..', 'node_modules', '.bin', tscName),
  join(__dirname, '..', '..', 'node_modules', '.bin', tscName),
];
const tscJsCandidates = [
  join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc'),
  join(__dirname, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'),
];
const tscBin = tscBinCandidates.find((candidate) => existsSync(candidate));
const tscJs = tscJsCandidates.find((candidate) => existsSync(candidate));
const projectPath = join(__dirname, '..', 'tsconfig.json');

const command = tscBin ? tscBin : process.execPath;
const args = tscBin
  ? ['--noEmit', '--project', projectPath]
  : tscJs
    ? [tscJs, '--noEmit', '--project', projectPath]
    : null;

if (!args) {
  console.error('Could not locate TypeScript compiler in mobile or repo root node_modules.');
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: envWithoutLegacyNpmDevdir(),
  shell: Boolean(tscBin && process.platform === 'win32'),
});

process.exit(result.status ?? 1);
