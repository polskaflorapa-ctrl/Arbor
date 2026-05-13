#!/usr/bin/env node
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

const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

(async () => {
  const checks = [];
  checks.push({ name: 'ready', result: await check('/api/ready'), expected: [200] });
  checks.push({
    name: 'health',
    result: await check('/api/health'),
    expected: [200],
    includes: ['2.2.0-quotations', '"quotations":true'],
  });
  checks.push({
    name: 'tasks-route-mounted',
    result: await check('/api/tasks/wszystkie'),
    expected: [401, 403],
  });
  checks.push({
    name: 'quotations-route-mounted',
    result: await check('/api/quotations'),
    expected: [401, 403],
  });
  checks.push({
    name: 'quotations-panel-assign-mounted',
    result: await check('/api/quotations/panel/do-przypisania'),
    expected: [401, 403],
  });
  checks.push({
    name: 'quotations-panel-approvals-mounted',
    result: await check('/api/quotations/panel/moje-zatwierdzenia'),
    expected: [401, 403],
  });
  checks.push({
    name: 'quotations-norms-mounted',
    result: await check('/api/quotations/norms/service-times'),
    expected: [401, 403],
  });

  if (token) {
    checks.push({
      name: 'ops-smoke',
      result: await check('/api/ops/smoke', { headers: authHeaders }),
      expected: [200],
    });
    checks.push({
      name: 'quotations-panel-assign-auth',
      result: await check('/api/quotations/panel/do-przypisania', { headers: authHeaders }),
      expected: [200],
    });
    checks.push({
      name: 'quotations-panel-approvals-auth',
      result: await check('/api/quotations/panel/moje-zatwierdzenia', { headers: authHeaders }),
      expected: [200],
    });
  }

  let failed = 0;
  for (const { name, result, expected, includes = [] } of checks) {
    const missing = includes.filter((fragment) => !result.body.includes(fragment));
    const passed = expected.includes(result.status) && missing.length === 0;
    const marker = passed ? 'OK' : 'FAIL';
    console.log(`${marker} ${name} status=${result.status} expected=${expected.join('|')}`);
    if (!passed) {
      failed += 1;
      if (missing.length) console.log(`missing: ${missing.join(', ')}`);
      console.log(result.body.slice(0, 400));
    }
  }
  if (failed > 0) process.exit(1);
})();
