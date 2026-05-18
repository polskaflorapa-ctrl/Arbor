const fs = require('node:fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const rootPackage = readJson('package.json');
  const railway = readJson('railway.json');

  assert(fs.existsSync('railway.json'), 'railway.json is missing.');
  assert(railway.build?.builder === 'NIXPACKS', 'railway.json should use Nixpacks.');
  assert(railway.deploy?.startCommand === 'npm run start:api:prod', 'Railway startCommand should run migrations and API.');
  assert(railway.deploy?.healthcheckPath === '/api/ready', 'Railway healthcheck should use /api/ready.');

  assert(fs.existsSync('deploy/railway-arbor-os.env.example'), 'Railway env template is missing.');
  assert(fs.existsSync('deploy/cloudflare-pages.env.example'), 'Cloudflare Pages env template is missing.');
  assert(fs.existsSync('docs/free-demo-deploy.md'), 'Free demo deploy runbook is missing.');
  assert(fs.existsSync('scripts/start-api-with-migrations.cjs'), 'API production start script is missing.');
  assert(fs.existsSync('scripts/deploy-cloudflare-pages.cjs'), 'Cloudflare Pages deploy script is missing.');
  assert(fs.existsSync('os/scripts/seed-president-demo.js'), 'President demo seed script is missing.');

  assert(rootPackage.scripts?.['start:api:prod'], 'Root start:api:prod script is missing.');
  assert(rootPackage.scripts?.['deploy:demo:check'], 'Root deploy:demo:check script is missing.');
  assert(rootPackage.scripts?.['deploy:pages:cloudflare'], 'Root deploy:pages:cloudflare script is missing.');
  assert(rootPackage.scripts?.['seed:president-demo'], 'Root seed:president-demo script is missing.');

  console.log('[demo-deploy] OK');
}

try {
  main();
} catch (error) {
  console.error(`[demo-deploy] FAILED: ${error.message}`);
  process.exit(1);
}
