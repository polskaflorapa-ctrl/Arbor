import { spawn } from 'node:child_process';
import { resetDb } from './db.mjs';

const API = process.env.VITE_ARBOR_API_URL || 'http://127.0.0.1:8790';

const checks = [
  ['core', 'server/smoke-core.mjs', { ZADARMA_SECRET: process.env.ZADARMA_SECRET || 'dev-zadarma-secret' }],
  ['tenant', 'server/smoke-tenant-isolation.mjs'],
  ['realtime', 'server/smoke-realtime.mjs'],
  ['branch', 'server/smoke-branch-access.mjs'],
  ['ui', 'server/smoke-ui.mjs'],
];

function runCheck(label, script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VITE_ARBOR_API_URL: API,
        ...extraEnv,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`smoke:${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

// Reset przez API gdy podano sekret dev-resetu — konieczne dla DB_DRIVER=postgres,
// gdzie działające API trzyma stan w pamięci i lokalny resetDb() z tego procesu
// zostawiłby serwerowi przestarzały cache (architektura single-writer).
async function resetSeed() {
  const resetSecret = process.env.ARBOR_DEV_RESET_SECRET;
  if (resetSecret) {
    const response = await fetch(`${API}/api/dev/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-arbor-dev-secret': resetSecret },
      body: '{}',
    });
    if (!response.ok) throw new Error(`dev reset przez API nie powiódł się: ${response.status} ${await response.text()}`);
    return;
  }
  await resetDb();
}

for (const [label, script, env] of checks) {
  console.log(`\n[smoke:${label}] reset seed`);
  await resetSeed();
  console.log(`[smoke:${label}] ${API}`);
  await runCheck(label, script, env);
}

console.log('\n[smoke:all] ok');
