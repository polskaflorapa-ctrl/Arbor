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
  assert(webPackage.scripts?.build === 'react-scripts build', 'arbor-web build script should run CRA build.');

  assert(/\[build\]/.test(netlifyToml), 'netlify.toml is missing [build].');
  assert(/base\s*=\s*"web"/.test(netlifyToml), 'netlify.toml should build from web/.');
  assert(/command\s*=\s*"npm ci && npm run build"/.test(netlifyToml), 'netlify.toml build command is unexpected.');
  assert(/publish\s*=\s*"build"/.test(netlifyToml), 'netlify.toml should publish web/build via base=web.');
  assert(/NODE_VERSION\s*=\s*"20"/.test(netlifyToml), 'netlify.toml should pin Node 20.');
  assert(/Cache-Control\s*=\s*"public, max-age=31536000, immutable"/.test(netlifyToml), 'netlify.toml should cache hashed static assets.');
  assert(/X-Content-Type-Options\s*=\s*"nosniff"/.test(netlifyToml), 'netlify.toml should set nosniff.');

  const apiRuleIndex = redirects.indexOf('/api/* /404.html 404');
  const spaRuleIndex = redirects.indexOf('/* /index.html 200');
  assert(apiRuleIndex >= 0, 'web/public/_redirects should return a 404 for missing /api/* proxy.');
  assert(spaRuleIndex >= 0, 'web/public/_redirects should include the SPA fallback.');
  assert(apiRuleIndex < spaRuleIndex, 'The /api/* 404 rule must come before the SPA fallback.');

  assert(fs.existsSync('web/public/404.html'), 'web/public/404.html is missing.');
  assert(fs.existsSync('deploy/netlify-web.env.example'), 'deploy/netlify-web.env.example is missing.');

  console.log('[deploy-netlify] Local Netlify config OK.');
  console.log('[deploy-netlify] Set REACT_APP_API_URL in Netlify before production deploy.');
}

async function main() {
  mainChecks();
  await checkRemoteApi(process.argv[2]);
}

main().catch((error) => {
  console.error(`[deploy-netlify] FAILED: ${error.message}`);
  process.exit(1);
});
