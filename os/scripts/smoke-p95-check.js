#!/usr/bin/env node
const DEFAULT_THRESHOLD_MS = 500;
const DEFAULT_SAMPLES = 5;
const DEFAULT_TIMEOUT_MS = 30000;

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parsePositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const positional = [];
  const options = {
    thresholdMs: parsePositiveInt(env.P95_THRESHOLD_MS, DEFAULT_THRESHOLD_MS, { min: 1, max: 60000 }),
    samples: parsePositiveInt(env.P95_SAMPLES, DEFAULT_SAMPLES, { min: 1, max: 50 }),
    timeoutMs: parsePositiveInt(env.P95_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, { min: 100, max: 120000 }),
    json: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--threshold=')) {
      options.thresholdMs = parsePositiveInt(arg.slice('--threshold='.length), options.thresholdMs, { min: 1, max: 60000 });
    } else if (arg === '--threshold') {
      options._expectThreshold = true;
    } else if (options._expectThreshold) {
      options.thresholdMs = parsePositiveInt(arg, options.thresholdMs, { min: 1, max: 60000 });
      delete options._expectThreshold;
    } else if (arg.startsWith('--samples=')) {
      options.samples = parsePositiveInt(arg.slice('--samples='.length), options.samples, { min: 1, max: 50 });
    } else if (arg === '--samples') {
      options._expectSamples = true;
    } else if (options._expectSamples) {
      options.samples = parsePositiveInt(arg, options.samples, { min: 1, max: 50 });
      delete options._expectSamples;
    } else if (arg.startsWith('--timeout=')) {
      options.timeoutMs = parsePositiveInt(arg.slice('--timeout='.length), options.timeoutMs, { min: 100, max: 120000 });
    } else if (arg === '--timeout') {
      options._expectTimeout = true;
    } else if (options._expectTimeout) {
      options.timeoutMs = parsePositiveInt(arg, options.timeoutMs, { min: 100, max: 120000 });
      delete options._expectTimeout;
    } else {
      positional.push(arg);
    }
  }

  delete options._expectThreshold;
  delete options._expectSamples;
  delete options._expectTimeout;

  options.baseUrl = normalizeBaseUrl(positional[0] || env.BASE_URL);
  options.token = positional[1] || env.SMOKE_TOKEN || '';
  return options;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMs(value) {
  if (value == null) return null;
  return Math.round(value * 10) / 10;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function timedFetch(url, options = {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || (() => performance.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const started = now();
  try {
    const res = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      body,
      durationMs: now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loginForSmoke(baseUrl, env = process.env, deps = {}) {
  const login = env.SMOKE_LOGIN || env.BOOTSTRAP_ADMIN_LOGIN;
  const password = env.SMOKE_PASSWORD || env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!login || !password) return null;

  const result = await timedFetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    timeoutMs: deps.timeoutMs || DEFAULT_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, haslo: password }),
  }, deps);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Login smoke failed: status=${result.status} body=${result.body.slice(0, 200)}`);
  }
  const json = parseJson(result.body);
  if (!json?.token) throw new Error('Login smoke failed: response did not include token.');
  return json.token;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildChecks({ token = '', date = todayIso() } = {}) {
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  const checks = [
    { name: 'ready', method: 'GET', path: '/api/ready', expected: [200] },
    { name: 'health', method: 'GET', path: '/api/health', expected: [200] },
  ];

  if (!token) {
    checks.push(
      { name: 'tasks-auth-boundary', method: 'GET', path: '/api/tasks/wszystkie?limit=10', expected: [401, 403] },
      { name: 'quotations-auth-boundary', method: 'GET', path: '/api/quotations', expected: [401, 403] },
    );
    return checks;
  }

  checks.push(
    { name: 'auth-me', method: 'GET', path: '/api/auth/me', expected: [200], headers: auth },
    { name: 'tasks-list', method: 'GET', path: '/api/tasks/wszystkie?limit=10', expected: [200], headers: auth },
    {
      name: 'kierownik-today',
      method: 'GET',
      path: `/api/ops/kierownik-today?date=${encodeURIComponent(date)}`,
      expected: [200, 403],
      headers: auth,
    },
    { name: 'bi-drill', method: 'GET', path: '/api/bi/drill?days=7', expected: [200, 403], headers: auth },
  );
  return checks;
}

async function measureCheck(baseUrl, check, options, deps = {}) {
  const durations = [];
  const statuses = [];
  const errors = [];
  for (let i = 0; i < options.samples; i += 1) {
    try {
      const result = await timedFetch(`${baseUrl}${check.path}`, {
        method: check.method,
        headers: check.headers || {},
        timeoutMs: options.timeoutMs,
      }, deps);
      statuses.push(result.status);
      durations.push(result.durationMs);
      if (!check.expected.includes(result.status)) {
        errors.push(`unexpected_status=${result.status}`);
      }
    } catch (error) {
      statuses.push('ERR');
      errors.push(error.name === 'AbortError' ? 'timeout' : error.message);
    }
  }

  const p95 = percentile(durations, 0.95);
  if (p95 != null && p95 > options.thresholdMs) {
    errors.push(`p95>${options.thresholdMs}ms`);
  }

  return {
    name: check.name,
    method: check.method,
    path: check.path,
    expected: check.expected,
    statuses,
    samples: durations.length,
    avg_ms: roundMs(average(durations)),
    p95_ms: roundMs(p95),
    max_ms: roundMs(durations.length ? Math.max(...durations) : null),
    pass: errors.length === 0,
    errors: [...new Set(errors)],
  };
}

async function runP95Smoke(options, deps = {}) {
  if (!options.baseUrl) {
    throw new Error('Usage: npm run smoke:p95 -- https://<arbor-os-url> [TOKEN] [--threshold 500] [--samples 5]');
  }
  const token = options.token || await loginForSmoke(options.baseUrl, deps.env || process.env, {
    ...deps,
    timeoutMs: options.timeoutMs,
  });
  const checks = buildChecks({ token });
  const results = [];
  for (const check of checks) {
    results.push(await measureCheck(options.baseUrl, check, options, deps));
  }
  const failed = results.filter((result) => !result.pass);
  return {
    ok: failed.length === 0,
    baseUrl: options.baseUrl,
    threshold_ms: options.thresholdMs,
    samples: options.samples,
    authenticated: Boolean(token),
    results,
  };
}

function printReport(report) {
  console.log(`[smoke-p95] base=${report.baseUrl} threshold=${report.threshold_ms}ms samples=${report.samples} auth=${report.authenticated ? 'yes' : 'no'}`);
  for (const result of report.results) {
    const marker = result.pass ? 'PASS' : 'FAIL';
    console.log(
      `${marker} ${result.name} ${result.method} ${result.path} statuses=${result.statuses.join(',')} avg=${result.avg_ms ?? '-'}ms p95=${result.p95_ms ?? '-'}ms max=${result.max_ms ?? '-'}ms`,
    );
    if (!result.pass) console.log(`  errors=${result.errors.join(', ')}`);
  }
  console.log(`[smoke-p95] ${report.ok ? 'OK' : 'FAILED'}`);
}

async function main() {
  const options = parseArgs();
  const report = await runP95Smoke(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[smoke-p95] FAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_THRESHOLD_MS,
  DEFAULT_SAMPLES,
  normalizeBaseUrl,
  parseArgs,
  percentile,
  buildChecks,
  measureCheck,
  runP95Smoke,
  printReport,
};
