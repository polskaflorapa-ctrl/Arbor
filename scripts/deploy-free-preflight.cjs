const fs = require('fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseYaml(file) {
  try {
    const YAML = require('yaml');
    return YAML.parse(read(file));
  } catch (error) {
    throw new Error(`${file}: YAML parse failed: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function checkRemoteApi(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${base}/api/ready`, { signal: controller.signal });
    const text = await res.text();
    assert(res.ok, `Remote API /api/ready failed: ${res.status} ${text.slice(0, 200)}`);
    console.log(`[deploy-free] Remote API ready OK: ${base}/api/ready`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const apiUrlArg = process.argv[2] || '';
  const rootBlueprint = parseYaml('render.yaml');
  const osBlueprint = parseYaml('os/render.yaml');
  const webBlueprint = parseYaml('web/render.yaml');
  const vercel = JSON.parse(read('vercel.json'));

  assert(!rootBlueprint.databases, 'render.yaml should not create paid Render databases in free-first mode.');
  assert(Array.isArray(rootBlueprint.services), 'render.yaml must contain services.');

  const apiService = rootBlueprint.services.find((service) => service.name === 'arbor-os');
  const webService = rootBlueprint.services.find((service) => service.name === 'arbor-web');
  assert(apiService, 'render.yaml is missing arbor-os service.');
  assert(webService, 'render.yaml is missing arbor-web service.');
  assert(apiService.plan === 'free', 'arbor-os should use Render Free in free-first mode.');
  assert(webService.runtime === 'static', 'arbor-web should be a Render static site.');
  assert(apiService.envVars.some((env) => env.key === 'DATABASE_URL' && env.sync === false), 'DATABASE_URL must be manual from Neon Free.');
  assert(apiService.envVars.some((env) => env.key === 'UPLOADS_DIR'), 'UPLOADS_DIR must be configured.');
  assert(apiService.envVars.some((env) => env.key === 'DB_POOL_MAX' && Number(env.value) <= 5), 'DB_POOL_MAX should stay low for Neon Free.');

  assert(osBlueprint.services?.[0]?.plan === 'free', 'os/render.yaml should also use Render Free.');
  assert(webBlueprint.services?.[0]?.runtime === 'static', 'web/render.yaml should deploy as static.');
  assert(vercel.outputDirectory === 'web/build', 'vercel.json should publish web/build.');
  assert(fs.existsSync('web/src/utils/apiBase.js'), 'web API URL normalizer is missing.');

  console.log('[deploy-free] Local config OK.');
  console.log('[deploy-free] Required manual env in Render arbor-os: DATABASE_URL from Neon Free.');
  console.log('[deploy-free] Recommended after web deploy: CORS_ORIGINS=https://<your-web-domain>.');

  if (apiUrlArg) {
    await checkRemoteApi(apiUrlArg);
  } else {
    console.log('[deploy-free] After deploy run: npm run deploy:free:check -- https://<arbor-os>.onrender.com');
  }
}

main().catch((error) => {
  console.error(`[deploy-free] FAILED: ${error.message}`);
  process.exit(1);
});
