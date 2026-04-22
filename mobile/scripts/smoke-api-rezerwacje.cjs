/**
 * Smoke test backend API for mobile reservations flow.
 *
 * Usage:
 *   API_URL=https://host/api AUTH_TOKEN=... node scripts/smoke-api-rezerwacje.cjs
 *   API_URL=https://host/api node scripts/smoke-api-rezerwacje.cjs
 *
 * Notes:
 * - If AUTH_TOKEN is missing, protected endpoints are expected to return 401/403.
 * - If reservation endpoints are not deployed yet, 404 is accepted and reported as "NOT_IMPLEMENTED".
 */
const API_URL = (process.env.API_URL || 'https://arbor-os-dvf7.onrender.com/api').replace(/\/+$/, '');
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const from = `${year}-${month}-01`;
const to = `${year}-${month}-31`;

function withAuth(headers = {}) {
  if (!AUTH_TOKEN) return headers;
  return { ...headers, Authorization: `Bearer ${AUTH_TOKEN}` };
}

async function probe(name, url, init = {}, expected = []) {
  const started = Date.now();
  try {
    const res = await fetch(url, init);
    const ms = Date.now() - started;
    const ok = expected.includes(res.status) || (expected.length === 0 && res.ok);
    const tag = ok ? 'OK' : 'FAIL';
    console.log(`${tag}\t${name}\t${res.status}\t${ms}ms\t${url}`);
    return { ok, status: res.status };
  } catch (e) {
    const ms = Date.now() - started;
    console.log(`ERR\t${name}\t-\t${ms}ms\t${url}\t${String(e && e.message ? e.message : e)}`);
    return { ok: false, status: null };
  }
}

async function main() {
  console.log(`API_URL=${API_URL}`);
  console.log(`AUTH_TOKEN=${AUTH_TOKEN ? 'SET' : 'MISSING'}`);

  const authExpected = AUTH_TOKEN ? [200] : [401, 403];
  const tasksExpected = AUTH_TOKEN ? [200] : [401, 403];
  const reservExpected = AUTH_TOKEN ? [200, 404] : [401, 403, 404];
  const postExpected = AUTH_TOKEN ? [201, 400, 404, 409] : [401, 403, 404];
  const putExpected = AUTH_TOKEN ? [200, 400, 404, 409] : [401, 403, 404];

  await probe('AUTH_ME', `${API_URL}/auth/me`, { headers: withAuth() }, authExpected);
  await probe('TASKS_ALL', `${API_URL}/tasks/wszystkie`, { headers: withAuth() }, tasksExpected);
  await probe(
    'REZERWACJE_GET',
    `${API_URL}/flota/rezerwacje?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: withAuth() },
    reservExpected,
  );

  const postBody = {
    sprzet_id: 12,
    ekipa_id: 3,
    data_od: `${year}-${month}-29`,
    data_do: `${year}-${month}-29`,
    caly_dzien: true,
    status: 'Zarezerwowane',
  };
  await probe(
    'REZERWACJE_POST',
    `${API_URL}/flota/rezerwacje`,
    {
      method: 'POST',
      headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(postBody),
    },
    postExpected,
  );

  await probe(
    'REZERWACJE_STATUS_PUT',
    `${API_URL}/flota/rezerwacje/101/status`,
    {
      method: 'PUT',
      headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'Wydane' }),
    },
    putExpected,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

