/**
 * Smoke: Kommo payload for CRM (task + optional client).
 * Does not call POST push unless ARBOR_KOMMO_SMOKE_PUSH=1.
 *
 *   npm run smoke:kommo:crm
 */
const axios = require('axios');

const base = (process.env.ARBOR_SMOKE_API_BASE || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const envLogin = process.env.ARBOR_SMOKE_LOGIN;
const envPassword = process.env.ARBOR_SMOKE_PASSWORD;
const credentials = (envLogin || envPassword)
  ? [{ login: envLogin || 'smoke_admin', haslo: envPassword || 'Smoke123!' }]
  : [
      { login: 'smoke_admin', haslo: 'Smoke123!' },
      { login: 'demo_dyrektor', haslo: 'Demo123!ARBOR' },
      { login: 'admin', haslo: 'admin' },
    ];

async function req(method, path, { headers = {}, body } = {}) {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await axios({
      method,
      url,
      headers,
      data: body,
      timeout: 30000,
      validateStatus: () => true,
      transitional: { silentJSONParsing: true, forcedJSONParsing: true },
    });
    const json = typeof res.data === 'object' ? res.data : null;
    const text = typeof res.data === 'string' ? res.data : '';
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json, text };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: error.message || 'request failed' };
  }
}

async function loginSmoke() {
  const attempts = [];
  for (const cred of credentials) {
    const auth = await req('POST', '/auth/login', { body: cred });
    if (auth.ok && auth.json?.token) {
      return { ok: true, token: auth.json.token, login: cred.login, attempts };
    }
    const detail = auth.json?.error || auth.text?.slice(0, 200) || 'missing token';
    attempts.push(`${cred.login} -> ${auth.status} (${detail})`);
  }
  return { ok: false, token: null, login: null, attempts };
}

async function main() {
  const errors = [];

  const auth = await loginSmoke();
  if (!auth.ok || !auth.token) {
    console.error('[smoke:kommo:crm] Login failed');
    for (const attempt of auth.attempts) console.error(` - ${attempt}`);
    console.error('[smoke:kommo:crm] FAIL');
    return 1;
  }

  const token = auth.token;
  const activeLogin = auth.login;
  const authz = { Authorization: `Bearer ${token}` };

  const tasks = await req('GET', '/tasks', { headers: authz });
  if (!tasks.ok || !Array.isArray(tasks.json)) {
    errors.push(`GET /tasks -> ${tasks.status}`);
  } else {
    const tid = tasks.json[0]?.id;
    if (tid == null) {
      errors.push('No tasks in DB: task payload check skipped');
    } else {
      const tp = await req('GET', `/tasks/${tid}/kommo-payload`, { headers: authz });
      if (!tp.ok) errors.push(`GET /tasks/${tid}/kommo-payload -> ${tp.status}`);
      else if (tp.json?.event !== 'task.sync') errors.push(`task payload expected event task.sync, got ${tp.json?.event}`);
      else console.log('[smoke:kommo:crm] task', { id: tid, event: tp.json.event });
    }
  }

  const klienci = await req('GET', '/klienci', { headers: authz });
  if (!klienci.ok || !Array.isArray(klienci.json)) {
    errors.push(`GET /klienci -> ${klienci.status}`);
  } else if (klienci.json.length === 0) {
    console.log('[smoke:kommo:crm] No clients in DB: client payload check skipped');
  } else {
    const kid = klienci.json[0].id;
    const kp = await req('GET', `/klienci/${kid}/kommo-payload`, { headers: authz });
    if (!kp.ok) errors.push(`GET /klienci/${kid}/kommo-payload -> ${kp.status}`);
    else if (kp.json?.event !== 'klient.sync') errors.push(`client payload expected event klient.sync, got ${kp.json?.event}`);
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
    return 1;
  }

  console.log('[smoke:kommo:crm] OK', { base, user: activeLogin });
  return 0;
}

main()
  .catch((e) => {
    console.error('[smoke:kommo:crm]', e.message || e);
    return 1;
  })
  .then((code) => {
    process.exitCode = Number.isInteger(code) ? code : 1;
  });
