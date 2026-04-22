/** Uruchamia `tsc --noEmit` przez npx z oczyszczonym env (bez przestarzałego npm_config_devdir). */
const { spawnSync } = require('node:child_process');

function envWithoutLegacyNpmDevdir() {
  const env = { ...process.env };
  delete env.npm_config_devdir;
  delete env.NPM_CONFIG_DEVDIR;
  return env;
}

const result = spawnSync('npx', ['tsc', '--noEmit'], {
  stdio: 'inherit',
  env: envWithoutLegacyNpmDevdir(),
  shell: true,
});

process.exit(result.status ?? 1);
