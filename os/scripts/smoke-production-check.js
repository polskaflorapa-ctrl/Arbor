#!/usr/bin/env node
/* eslint-disable no-console */
const baseUrl = process.argv[2] || process.env.BASE_URL;
const token = process.argv[3] || process.env.SMOKE_TOKEN;

if (!baseUrl) {
  console.error('Usage: node scripts/smoke-production-check.js <BASE_URL> [TOKEN]');
  process.exit(2);
}

const normalized = baseUrl.replace(/\/+$/, '');

const check = async (path, opts = {}) => {
  const res = await fetch(`${normalized}${path}`, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
};

(async () => {
  const checks = [];
  checks.push(['root', await check('/')]);
  checks.push(['ready', await check('/api/ready')]);
  checks.push(['health', await check('/api/health')]);

  if (token) {
    checks.push([
      'ops-smoke',
      await check('/api/ops/smoke', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
  }

  let failed = 0;
  for (const [name, result] of checks) {
    const marker = result.ok ? 'OK' : 'FAIL';
    console.log(`${marker} ${name} status=${result.status}`);
    if (!result.ok) {
      failed += 1;
      console.log(result.body.slice(0, 400));
    }
  }
  if (failed > 0) process.exit(1);
})();
