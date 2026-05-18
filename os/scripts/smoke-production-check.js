#!/usr/bin/env node
const baseUrl = process.argv[2] || process.env.BASE_URL;
const providedToken = process.argv[3] || process.env.SMOKE_TOKEN;

if (!baseUrl) {
  console.error('Usage: node scripts/smoke-production-check.js <BASE_URL> [TOKEN]');
  console.error('Optional env for login smoke: SMOKE_LOGIN + SMOKE_PASSWORD.');
  process.exit(2);
}

const normalized = baseUrl.replace(/\/+$/, '');

const check = async (path, opts = {}) => {
  const res = await fetch(`${normalized}${path}`, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
};

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loginForSmoke() {
  const login = process.env.SMOKE_LOGIN || process.env.BOOTSTRAP_ADMIN_LOGIN;
  const password = process.env.SMOKE_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!login || !password) return null;

  const result = await check('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, haslo: password }),
  });
  if (!result.ok) {
    throw new Error(`Login smoke failed: status=${result.status} body=${result.body.slice(0, 200)}`);
  }

  const json = parseJson(result.body);
  if (!json?.token) {
    throw new Error('Login smoke failed: response did not include token.');
  }
  console.log(`OK login-smoke status=${result.status} login=${login}`);
  return json.token;
}

(async () => {
  const token = providedToken || await loginForSmoke();
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
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
    const me = await check('/api/auth/me', { headers: authHeaders });
    checks.push({
      name: 'auth-me',
      result: me,
      expected: [200],
    });
    const meJson = parseJson(me.body);
    const role = meJson?.rola;
    const canRunOpsSmoke = ['Prezes', 'Dyrektor', 'Administrator'].includes(role);

    checks.push({
      name: 'ops-smoke',
      result: await check('/api/ops/smoke', { headers: authHeaders }),
      expected: canRunOpsSmoke ? [200] : [403],
    });
    checks.push({
      name: 'storage-smoke',
      result: await check('/api/ops/storage-smoke', { headers: authHeaders }),
      expected: canRunOpsSmoke ? [200] : [403],
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
