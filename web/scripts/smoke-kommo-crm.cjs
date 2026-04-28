/**
 * Smoke: payload Kommo dla CRM (zlecenie + opcjonalnie klient).
 * Nie wywołuje POST push (chyba że ARBOR_KOMMO_SMOKE_PUSH=1 — wtedy trafia na prawdziwy webhook).
 *
 *   npm run smoke:kommo:crm
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

  const auth = await req('POST', '/auth/login', { body: { login, haslo: password } });
  if (!auth.ok || !auth.json?.token) {
    console.error('[smoke:kommo:crm] Błąd logowania');
    process.exit(1);
  }
  const token = auth.json.token;
  const authz = { Authorization: `Bearer ${token}` };

  const tasks = await req('GET', '/tasks', { headers: authz });
  if (!tasks.ok || !Array.isArray(tasks.json)) {
    errors.push(`GET /tasks → ${tasks.status}`);
  } else {
    const tid = tasks.json[0]?.id;
    if (tid == null) {
      errors.push('Brak zleceń w bazie — pominięto kommo-payload zlecenia');
    } else {
      const tp = await req('GET', `/tasks/${tid}/kommo-payload`, { headers: authz });
      if (!tp.ok) errors.push(`GET /tasks/${tid}/kommo-payload → ${tp.status}`);
      else if (tp.json?.event !== 'task.sync') errors.push(`task payload: oczekiwano event task.sync, jest ${tp.json?.event}`);
      else console.log('[smoke:kommo:crm] task', { id: tid, event: tp.json.event });
    }
  }

  const klienci = await req('GET', '/klienci', { headers: authz });
  if (!klienci.ok || !Array.isArray(klienci.json)) {
    errors.push(`GET /klienci → ${klienci.status}`);
  } else if (klienci.json.length === 0) {
    console.log('[smoke:kommo:crm] brak klientów — pominięto kommo-payload klienta');
  } else {
    const kid = klienci.json[0].id;
    const kp = await req('GET', `/klienci/${kid}/kommo-payload`, { headers: authz });
    if (!kp.ok) errors.push(`GET /klienci/${kid}/kommo-payload → ${kp.status}`);
    else if (kp.json?.event !== 'klient.sync') errors.push(`klient payload: oczekiwano event klient.sync, jest ${kp.json?.event}`);
    else console.log('[smoke:kommo:crm] klient', { id: kid, event: kp.json.event });
  }

  if (process.env.ARBOR_KOMMO_SMOKE_PUSH === '1' && tasks.json?.[0]?.id) {
    const tid = tasks.json[0].id;
    const push = await req('POST', `/tasks/${tid}/kommo-push`, { headers: authz, body: {} });
    console.log('[smoke:kommo:crm] push (ARBOR_KOMMO_SMOKE_PUSH=1)', push.status, push.json || push.text?.slice(0, 200));
  }

  if (errors.length) {
    console.error('[smoke:kommo:crm] FAIL');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }
  console.log('[smoke:kommo:crm] OK', { base, user: login });
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke:kommo:crm]', e.message || e);
  process.exit(1);
});
