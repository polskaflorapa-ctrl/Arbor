const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeHost(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  return raw.replace(/\/api$/i, '');
}

async function checkRemoteApi(value) {
  const host = normalizeHost(value);
  if (!host) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${host}/api/ready`, { signal: controller.signal });
    const text = await res.text();
    assert(res.ok, `Remote API /api/ready failed: ${res.status} ${text.slice(0, 200)}`);
    console.log(`[deploy-koyeb] Remote API ready OK: ${host}/api/ready`);
  } finally {
    clearTimeout(timer);
  }
}

function mainChecks() {
  const rootPackage = JSON.parse(read('package.json'));
  const osPackage = JSON.parse(read('os/package.json'));
  const procfile = read('os/Procfile');
  const envConfig = read('os/src/config/env.js');
  const envExample = read('deploy/koyeb-arbor-os.env.example');

  assert(rootPackage.scripts?.['deploy:koyeb:check'], 'Root deploy:koyeb:check script is missing.');
  assert(osPackage.scripts?.start === 'node src/server.js', 'arbor-os start script should run src/server.js.');
  assert(osPackage.engines?.node?.startsWith('>=20'), 'arbor-os should require Node >=20.');
  assert(procfile.trim() === 'web: npm start', 'os/Procfile should start the web process with npm start.');
  assert(fs.existsSync('os/.koyebignore'), 'os/.koyebignore is missing.');
  assert(envConfig.includes('KOYEB_PUBLIC_DOMAIN'), 'env.js should infer PUBLIC_BASE_URL from KOYEB_PUBLIC_DOMAIN.');
  assert(envExample.includes('DATABASE_URL='), 'Koyeb env template is missing DATABASE_URL.');
  assert(envExample.includes('CORS_ORIGINS='), 'Koyeb env template is missing CORS_ORIGINS.');
  assert(envExample.includes('PUBLIC_BASE_URL='), 'Koyeb env template is missing PUBLIC_BASE_URL.');
  assert(envExample.includes('PHONE_RECORDING_STORAGE=none'), 'Koyeb env template should avoid ephemeral phone recordings by default.');

  console.log('[deploy-koyeb] Local Koyeb backend config OK.');
  console.log('[deploy-koyeb] Deploy os/ as a Koyeb Web Service and set env from deploy/koyeb-arbor-os.env.example.');
}

async function main() {
  mainChecks();
  await checkRemoteApi(process.argv[2]);
}

main().catch((error) => {
  console.error(`[deploy-koyeb] FAILED: ${error.message}`);
  process.exit(1);
});
