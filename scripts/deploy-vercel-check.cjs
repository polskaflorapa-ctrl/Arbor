const fs = require('node:fs');
const http = require('node:http');

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

function getApiIncludeFiles(vercel) {
  return vercel.functions?.['api/[...path].js']?.includeFiles || '';
}

async function smokeVercelApiWrapper() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'deploy-vercel-check-secret';
  process.env.DATABASE_URL = process.env.DATABASE_URL || '';
  process.env.VERCEL_RUN_MIGRATIONS = '0';

  try {
    const handler = require('../api/[...path].js');
    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => handler(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        try {
          const { port } = server.address();
          const res = await fetch(`http://127.0.0.1:${port}/api/health`);
          const body = await res.json();
          assert(res.status === 200, `Vercel API smoke expected 200, got ${res.status}`);
          assert(body.status === 'ok', 'Vercel API smoke expected /api/health status ok.');
          const docsRes = await fetch(`http://127.0.0.1:${port}/api/docs/openapi.yaml`);
          const docsBody = await docsRes.text();
          assert(docsRes.status === 200, `Vercel API docs smoke expected 200, got ${docsRes.status}`);
          assert(docsBody.includes('openapi:'), 'Vercel API docs smoke expected openapi.yaml content.');
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          server.close();
        }
      });
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

async function smokeVercelApiInitFailure() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousConnectTimeout = process.env.DB_CONNECT_TIMEOUT_MS;
  const previousRunMigrations = process.env.VERCEL_RUN_MIGRATIONS;
  const previousConsoleError = console.error;

  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'deploy-vercel-check-secret';
  process.env.DATABASE_URL = 'postgres://invalid:invalid@127.0.0.1:1/invalid';
  process.env.DB_CONNECT_TIMEOUT_MS = '100';
  process.env.VERCEL_RUN_MIGRATIONS = '1';

  const modulePath = require.resolve('../api/[...path].js');
  delete require.cache[modulePath];

  try {
    console.error = () => {};
    const handler = require('../api/[...path].js');
    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => handler(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        try {
          const { port } = server.address();
          const res = await fetch(`http://127.0.0.1:${port}/api/health`);
          const body = await res.json();
          assert(res.status === 500, `Vercel API init failure smoke expected 500, got ${res.status}`);
          assert(body.error === 'API initialization failed', 'Vercel API init failure smoke expected JSON error payload.');
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          server.close();
        }
      });
    });
  } finally {
    console.error = previousConsoleError;
    delete require.cache[modulePath];
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousConnectTimeout === undefined) delete process.env.DB_CONNECT_TIMEOUT_MS;
    else process.env.DB_CONNECT_TIMEOUT_MS = previousConnectTimeout;
    if (previousRunMigrations === undefined) delete process.env.VERCEL_RUN_MIGRATIONS;
    else process.env.VERCEL_RUN_MIGRATIONS = previousRunMigrations;
  }
}

async function smokeVercelApiSkipsMigrationsByDefault() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousRunMigrations = process.env.VERCEL_RUN_MIGRATIONS;

  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'deploy-vercel-check-secret';
  process.env.DATABASE_URL = 'postgres://invalid:invalid@127.0.0.1:1/invalid';
  delete process.env.VERCEL_RUN_MIGRATIONS;

  const modulePath = require.resolve('../api/[...path].js');
  delete require.cache[modulePath];

  try {
    const handler = require('../api/[...path].js');
    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => handler(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        try {
          const { port } = server.address();
          const res = await fetch(`http://127.0.0.1:${port}/api/health`);
          const body = await res.json();
          assert(res.status === 200, `Vercel API migration-skip smoke expected 200, got ${res.status}`);
          assert(body.status === 'ok', 'Vercel API migration-skip smoke expected /api/health status ok.');
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          server.close();
        }
      });
    });
  } finally {
    delete require.cache[modulePath];
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousRunMigrations === undefined) delete process.env.VERCEL_RUN_MIGRATIONS;
    else process.env.VERCEL_RUN_MIGRATIONS = previousRunMigrations;
  }
}

async function main() {
  const rootPackage = JSON.parse(read('package.json'));
  const vercel = JSON.parse(read('vercel.json'));
  const webIndex = read('web/index.html');
  const vercelApiWrapper = read('api/[...path].js');

  assert(rootPackage.engines?.node === '>=22.12.0', 'Root package should pin Node >=22.12.0 for Vite 7 and Vercel.');
  assert(rootPackage.scripts?.['deploy:vercel:check'] === 'node ./scripts/deploy-vercel-check.cjs', 'Root deploy:vercel:check script is missing.');
  assert(rootPackage.scripts?.['deploy:vercel:migrate'] === 'npm run db:migrate -w arbor-os', 'Root deploy:vercel:migrate script is missing.');
  assert(rootPackage.scripts?.['deploy:vercel:smoke'] === 'node ./scripts/deploy-vercel-smoke.cjs', 'Root deploy:vercel:smoke script is missing.');
  assert(rootPackage.dependencies?.['serverless-http'], 'Root package should include serverless-http for the Vercel API wrapper.');

  assert(vercel.version === 2, 'vercel.json should use version 2.');
  assert(vercel.framework === 'vite', 'vercel.json should identify the web framework as Vite.');
  assert(vercel.installCommand === 'npm ci', 'vercel.json install command should be npm ci.');
  assert(vercel.buildCommand === 'npm run build -w arbor-web', 'vercel.json build command is unexpected.');
  assert(vercel.outputDirectory === 'web/build', 'vercel.json should publish web/build.');
  const includeFiles = getApiIncludeFiles(vercel);
  assert(typeof includeFiles === 'string', 'vercel.json API includeFiles should be a glob string.');
  assert(includeFiles.includes('migrate.sql'), 'vercel.json should include migrate.sql for API cold-start migrations.');
  assert(includeFiles.includes('docs/openapi.yaml'), 'vercel.json should include openapi.yaml for the API function.');
  assert(includeFiles.includes('public/app/**'), 'vercel.json should include the embedded /app panel for the API function.');
  assert(includeFiles.includes('data/flota-pojazdy-katalog.json'), 'vercel.json should include the fleet catalog JSON for the API function.');
  assert(Array.isArray(vercel.headers), 'vercel.json should define headers.');
  assert(hasHeader(vercel.headers, '/(.*)', 'Referrer-Policy', /^strict-origin-when-cross-origin$/), 'vercel.json should set Referrer-Policy.');
  assert(hasHeader(vercel.headers, '/(.*)', 'X-Content-Type-Options', /^nosniff$/), 'vercel.json should set nosniff.');
  assert(hasHeader(vercel.headers, '/(.*)', 'X-Frame-Options', /^SAMEORIGIN$/), 'vercel.json should set X-Frame-Options.');
  assert(hasHeader(vercel.headers, '/static/(.*)', 'Cache-Control', /immutable/), 'vercel.json should cache hashed static assets.');
  assert(vercel.rewrites?.some((rule) => rule.source === '/(.*)' && rule.destination === '/index.html'), 'vercel.json should include the SPA fallback rewrite.');

  assert(fs.existsSync('api/[...path].js'), 'Vercel API wrapper api/[...path].js is missing.');
  assert(fs.existsSync('deploy/vercel.env.example'), 'Vercel env template is missing.');
  assert(!/serverless-http/.test(vercelApiWrapper), 'Vercel API wrapper should use native req/res, not serverless-http.');
  assert(/VERCEL_RUN_MIGRATIONS=0/.test(read('deploy/vercel.env.example')), 'Vercel env template should default VERCEL_RUN_MIGRATIONS to 0.');
  assert(!/fonts\.googleapis\.com\/css2\?family=Inter:wght@400;500;600;700&display=swap/.test(webIndex), 'web/index.html should not duplicate the Inter font stylesheet.');

  await smokeVercelApiWrapper();
  await smokeVercelApiSkipsMigrationsByDefault();
  await smokeVercelApiInitFailure();

  console.log('[deploy-vercel] Local Vercel config OK.');
  console.log('[deploy-vercel] Vercel will serve web/build and route /api/* to api/[...path].js.');
}

try {
  main().catch((error) => {
    console.error(`[deploy-vercel] FAILED: ${error.message}`);
    process.exit(1);
  });
} catch (error) {
  console.error(`[deploy-vercel] FAILED: ${error.message}`);
  process.exit(1);
}
