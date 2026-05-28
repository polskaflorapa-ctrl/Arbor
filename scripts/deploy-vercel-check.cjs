const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasHeader(headers, source, key, valuePattern) {
  const item = headers.find((entry) => entry.source === source);
  if (!item) return false;
  const header = item.headers?.find((entry) => entry.key === key);
  if (!header) return false;
  return valuePattern ? valuePattern.test(String(header.value || '')) : true;
}

function main() {
  const rootPackage = JSON.parse(read('package.json'));
  const vercel = JSON.parse(read('vercel.json'));
  const webIndex = read('web/index.html');

  assert(rootPackage.engines?.node === '>=22.12.0', 'Root package should pin Node >=22.12.0 for Vite 7 and Vercel.');
  assert(rootPackage.scripts?.['deploy:vercel:check'] === 'node ./scripts/deploy-vercel-check.cjs', 'Root deploy:vercel:check script is missing.');
  assert(rootPackage.dependencies?.['serverless-http'], 'Root package should include serverless-http for the Vercel API wrapper.');

  assert(vercel.version === 2, 'vercel.json should use version 2.');
  assert(vercel.framework === 'vite', 'vercel.json should identify the web framework as Vite.');
  assert(vercel.installCommand === 'npm ci', 'vercel.json install command should be npm ci.');
  assert(vercel.buildCommand === 'npm run build -w arbor-web', 'vercel.json build command is unexpected.');
  assert(vercel.outputDirectory === 'web/build', 'vercel.json should publish web/build.');
  assert(Array.isArray(vercel.headers), 'vercel.json should define headers.');
  assert(hasHeader(vercel.headers, '/(.*)', 'Referrer-Policy', /^strict-origin-when-cross-origin$/), 'vercel.json should set Referrer-Policy.');
  assert(hasHeader(vercel.headers, '/(.*)', 'X-Content-Type-Options', /^nosniff$/), 'vercel.json should set nosniff.');
  assert(hasHeader(vercel.headers, '/(.*)', 'X-Frame-Options', /^SAMEORIGIN$/), 'vercel.json should set X-Frame-Options.');
  assert(hasHeader(vercel.headers, '/static/(.*)', 'Cache-Control', /immutable/), 'vercel.json should cache hashed static assets.');
  assert(vercel.rewrites?.some((rule) => rule.source === '/(.*)' && rule.destination === '/index.html'), 'vercel.json should include the SPA fallback rewrite.');

  assert(fs.existsSync('api/[...path].js'), 'Vercel API wrapper api/[...path].js is missing.');
  assert(fs.existsSync('deploy/vercel.env.example'), 'Vercel env template is missing.');
  assert(!/fonts\.googleapis\.com\/css2\?family=Inter:wght@400;500;600;700&display=swap/.test(webIndex), 'web/index.html should not duplicate the Inter font stylesheet.');

  console.log('[deploy-vercel] Local Vercel config OK.');
  console.log('[deploy-vercel] Vercel will serve web/build and route /api/* to api/[...path].js.');
}

try {
  main();
} catch (error) {
  console.error(`[deploy-vercel] FAILED: ${error.message}`);
  process.exit(1);
}
