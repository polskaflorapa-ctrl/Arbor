const assert = require('node:assert/strict');

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.argv[2]);
  if (!baseUrl) {
    throw new Error('Usage: npm run deploy:vercel:smoke -- https://<project>.vercel.app');
  }

  const root = await fetchText(`${baseUrl}/`);
  assert.equal(root.res.status, 200, `Expected / to return 200, got ${root.res.status}`);
  assert.match(root.text, /<div id="root"><\/div>/, 'Expected Vite app root in / HTML.');

  const health = await fetchText(`${baseUrl}/api/health`);
  assert.equal(health.res.status, 200, `Expected /api/health to return 200, got ${health.res.status}`);
  const healthJson = JSON.parse(health.text);
  assert.equal(healthJson.status, 'ok', 'Expected /api/health status ok.');

  const docs = await fetchText(`${baseUrl}/api/docs/openapi.yaml`);
  assert.equal(docs.res.status, 200, `Expected /api/docs/openapi.yaml to return 200, got ${docs.res.status}`);
  assert.match(docs.text, /openapi:/, 'Expected OpenAPI YAML content.');

  console.log(`[deploy-vercel-smoke] OK ${baseUrl}`);
}

main().catch((error) => {
  console.error(`[deploy-vercel-smoke] FAILED: ${error.message}`);
  process.exit(1);
});
