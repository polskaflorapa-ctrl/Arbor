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
  const netlifyToml = read('netlify.toml');
  const rootPackage = JSON.parse(read('package.json'));
  const osPackage = JSON.parse(read('os/package.json'));

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
  assert(apiService.envVars.some((env) => env.key === 'UPLOAD_STORAGE'), 'UPLOAD_STORAGE must be explicit.');
  assert(apiService.envVars.some((env) => env.key === 'DB_POOL_MAX' && Number(env.value) <= 5), 'DB_POOL_MAX should stay low for Neon Free.');

  assert(osBlueprint.services?.[0]?.plan === 'free', 'os/render.yaml should also use Render Free.');
  assert(webBlueprint.services?.[0]?.runtime === 'static', 'web/render.yaml should deploy as static.');
  assert(vercel.framework === 'vite', 'vercel.json should identify the web framework as Vite.');
  assert(vercel.outputDirectory === 'web/build', 'vercel.json should publish web/build.');
  assert(/publish\s*=\s*"web\/build"/.test(netlifyToml), 'netlify.toml should publish web/build.');
  assert(/directory\s*=\s*"netlify\/functions"/.test(netlifyToml), 'netlify.toml should configure Netlify Functions.');
  assert(/VITE_API_URL\s*=\s*"\/api"/.test(netlifyToml), 'netlify.toml should build web against same-origin /api.');
  assert(fs.existsSync('web/src/utils/apiBase.js'), 'web API URL normalizer is missing.');
  assert(fs.existsSync('deploy/render-arbor-os.env.example'), 'Render env template is missing.');
  assert(fs.existsSync('deploy/local-production-doctor.env.example'), 'Local production doctor env template is missing.');
  assert(fs.existsSync('deploy/mobile-production.env.example'), 'Mobile production env template is missing.');
  assert(fs.existsSync('deploy/web-production.env.example'), 'Web production env template is missing.');
  assert(fs.existsSync('deploy/netlify-web.env.example'), 'Netlify web env template is missing.');
  assert(fs.existsSync('deploy/koyeb-arbor-os.env.example'), 'Koyeb arbor-os env template is missing.');
  assert(fs.existsSync('os/Procfile'), 'Koyeb arbor-os Procfile is missing.');
  assert(fs.existsSync('os/scripts/bootstrap-admin.js'), 'Production admin bootstrap script is missing.');
  assert(fs.existsSync('os/scripts/production-doctor.js'), 'Production doctor script is missing.');
  assert(fs.existsSync('os/scripts/db-backup.js'), 'Database backup script is missing.');
  assert(fs.existsSync('os/scripts/db-restore.js'), 'Database restore script is missing.');
  assert(fs.existsSync('scripts/run-production-bootstrap.cjs'), 'Production bootstrap runner is missing.');
  assert(fs.existsSync('docs/backup-restore.md'), 'Backup/restore runbook is missing.');
  assert(fs.existsSync('scripts/print-production-env-template.cjs'), 'Production env print script is missing.');
  assert(rootPackage.scripts?.['bootstrap:admin'], 'Root bootstrap:admin script is missing.');
  assert(rootPackage.scripts?.['deploy:env:print'], 'Root deploy:env:print script is missing.');
  assert(rootPackage.scripts?.['deploy:prod:doctor'], 'Root deploy:prod:doctor script is missing.');
  assert(rootPackage.scripts?.['deploy:prod:bootstrap'], 'Root deploy:prod:bootstrap script is missing.');
  assert(rootPackage.scripts?.['backup:db'], 'Root backup:db script is missing.');
  assert(rootPackage.scripts?.['backup:db:check'], 'Root backup:db:check script is missing.');
  assert(rootPackage.scripts?.['restore:db'], 'Root restore:db script is missing.');
  assert(rootPackage.scripts?.['restore:db:check'], 'Root restore:db:check script is missing.');
  assert(osPackage.scripts?.['bootstrap:admin'], 'arbor-os bootstrap:admin script is missing.');
  assert(osPackage.scripts?.['prod:doctor'], 'arbor-os prod:doctor script is missing.');
  assert(osPackage.scripts?.['backup:db'], 'arbor-os backup:db script is missing.');
  assert(osPackage.scripts?.['backup:db:check'], 'arbor-os backup:db:check script is missing.');
  assert(osPackage.scripts?.['restore:db'], 'arbor-os restore:db script is missing.');
  assert(osPackage.scripts?.['restore:db:check'], 'arbor-os restore:db:check script is missing.');

  console.log('[deploy-free] Local config OK.');
  console.log('[deploy-free] Required manual env in Render arbor-os: DATABASE_URL from Neon Free.');
  console.log('[deploy-free] Print env templates with: npm run deploy:env:print');
  console.log('[deploy-free] After first DB migration, create the first admin with: npm run bootstrap:admin');
  console.log('[deploy-free] After first admin, create the first database backup with: npm run backup:db');
  console.log('[deploy-free] Before/after deploy run: npm run deploy:prod:doctor');
  console.log('[deploy-free] For real photos on Render Free, switch UPLOAD_STORAGE=s3 and set S3/R2 env vars.');
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
