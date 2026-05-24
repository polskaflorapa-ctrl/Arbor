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
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${host}/api/ready`, { signal: controller.signal });
    const text = await res.text();
    assert(res.ok, `Remote API /api/ready failed: ${res.status} ${text.slice(0, 200)}`);
    console.log(`[deploy-netlify] Remote API ready OK: ${host}/api/ready`);
  } finally {
    clearTimeout(timer);
  }
}

function mainChecks() {
  const rootPackage = JSON.parse(read('package.json'));
  const webPackage = JSON.parse(read('web/package.json'));
  const netlifyToml = read('netlify.toml');
  const redirects = read('web/public/_redirects');

  assert(rootPackage.engines?.node === '>=20', 'Root package should require Node >=20.');
  assert(rootPackage.workspaces?.includes('web'), 'Root package workspaces should include web.');
  assert(rootPackage.workspaces?.includes('os'), 'Root package workspaces should include os.');
  assert(rootPackage.dependencies?.['serverless-http'], 'Root package should include serverless-http for Netlify API functions.');
  assert(rootPackage.dependencies?.['@netlify/database'], 'Root package should include @netlify/database for Netlify Database support.');
  assert(webPackage.scripts?.build === 'vite build', 'arbor-web build script should run Vite build.');

  assert(/\[build\]/.test(netlifyToml), 'netlify.toml is missing [build].');
  assert(/command\s*=\s*"npm ci && npm run build -w arbor-web"/.test(netlifyToml), 'netlify.toml build command is unexpected.');
  assert(/publish\s*=\s*"web\/build"/.test(netlifyToml), 'netlify.toml should publish web/build.');
  assert(/NODE_VERSION\s*=\s*"22\.12\.0"/.test(netlifyToml), 'netlify.toml should pin Node 22.12.0 for Vite 7.');
  assert(/VITE_API_URL\s*=\s*"\/api"/.test(netlifyToml), 'netlify.toml should build the web app against same-origin /api.');
  assert(/\[functions\]/.test(netlifyToml), 'netlify.toml is missing [functions].');
  assert(/directory\s*=\s*"netlify\/functions"/.test(netlifyToml), 'netlify.toml should use netlify/functions.');
  assert(/from\s*=\s*"\/api\/\*"/.test(netlifyToml), 'netlify.toml should route /api/* to the API function.');
  assert(/Cache-Control\s*=\s*"public, max-age=31536000, immutable"/.test(netlifyToml), 'netlify.toml should cache hashed static assets.');
  assert(/X-Content-Type-Options\s*=\s*"nosniff"/.test(netlifyToml), 'netlify.toml should set nosniff.');

  const spaRuleIndex = redirects.indexOf('/* /index.html 200');
  assert(!redirects.includes('/api/* /404.html 404'), 'web/public/_redirects should not shadow Netlify API functions.');
  assert(spaRuleIndex >= 0, 'web/public/_redirects should include the SPA fallback.');

  assert(fs.existsSync('netlify/functions/api.js'), 'Netlify API function is missing.');
  assert(fs.existsSync('web/public/404.html'), 'web/public/404.html is missing.');
  assert(fs.existsSync('deploy/netlify-web.env.example'), 'deploy/netlify-web.env.example is missing.');

  console.log('[deploy-netlify] Local Netlify config OK.');
  console.log('[deploy-netlify] Netlify will serve web/build and route /api/* to the Express API function.');
}

async function main() {
  mainChecks();
  await checkRemoteApi(process.argv[2]);
}

main().catch((error) => {
  console.error(`[deploy-netlify] FAILED: ${error.message}`);
  process.exit(1);
});
