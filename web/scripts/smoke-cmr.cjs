/**
 * Szybki smoke API pod CMR / regresję /tasks/stats.
 * Uruchom przy działającym lokalnym API (np. npm run dev:full lub npm run server w web).
 *
 *   node ./scripts/smoke-cmr.cjs
 *   ARBOR_SMOKE_API_BASE=http://127.0.0.1:3003/api node ./scripts/smoke-cmr.cjs
 *   ARBOR_SMOKE_LOGIN=oleg ARBOR_SMOKE_PASSWORD=oleg node ./scripts/smoke-cmr.cjs
 */
const base = (process.env.ARBOR_SMOKE_API_BASE || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const login = process.env.ARBOR_SMOKE_LOGIN || 'admin';
const password = process.env.ARBOR_SMOKE_PASSWORD || 'admin';

async function req(method, path, { headers = {}, body } = {}) {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  const errors = [];

  const h = await req('GET', '/health');
  if (!h.ok || !h.json?.ok) errors.push(`GET /health → ${h.status} ${h.text?.slice(0, 200)}`);

  const auth = await req('POST', '/auth/login', { body: { login, haslo: password } });
  if (!auth.ok || !auth.json?.token) {
    errors.push(`POST /auth/login (${login}) → ${auth.status} ${auth.text?.slice(0, 200)}`);
    console.error('[smoke:cmr] Błąd logowania — sprawdź API, port i ARBOR_SMOKE_API_BASE.');
    process.exit(1);
  }
  const token = auth.json.token;
  const authz = { Authorization: `Bearer ${token}` };

  const stats = await req('GET', '/tasks/stats', { headers: authz });
  if (!stats.ok) errors.push(`GET /tasks/stats → ${stats.status} ${stats.text?.slice(0, 300)}`);

  const cmr = await req('GET', '/cmr', { headers: authz });
  if (!cmr.ok) errors.push(`GET /cmr → ${cmr.status} ${cmr.text?.slice(0, 300)}`);

  if (errors.length) {
    console.error('[smoke:cmr] FAIL');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }

  const listLen = Array.isArray(cmr.json) ? cmr.json.length : '?';
  console.log('[smoke:cmr] OK', { base, user: login, cmrCount: listLen, statsOk: stats.ok });
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke:cmr]', e.message || e);
  process.exit(1);
});
