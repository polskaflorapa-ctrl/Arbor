#!/usr/bin/env node
/**
 * Smoke for mobile field flow:
 * - login
 * - pick an accessible task
 * - upload estimation/scope/access photos required by workflow readiness
 * - save the field package: scope, time, budget, risks, acceptance
 * - report a problem with opis
 * - upload a task photo
 * - repeat the same photo upload with the same Idempotency-Key and expect replay
 *
 * Env:
 *   SMOKE_BASE_URL=http://127.0.0.1:3000
 *   SMOKE_LOGIN=smoke_admin
 *   SMOKE_PASSWORD=Smoke123!
 *   SMOKE_FIELD_TASK_ID=optional existing task id
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const LOGIN = process.env.SMOKE_LOGIN || 'smoke_admin';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Smoke123!';

const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
  'base64',
);

async function requestJson(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} status=${res.status} body=${text.slice(0, 240)}`);
  }
  return data;
}

async function uploadTaskPhoto(taskId, token, key, { typ = 'Przed', opis = 'smoke field idempotency' } = {}) {
  const form = new FormData();
  form.append('typ', typ);
  form.append('opis', opis);
  form.append('zdjecie', new Blob([JPEG_1X1], { type: 'image/jpeg' }), 'smoke-field.jpg');
  const res = await fetch(`${BASE}/api/tasks/${taskId}/zdjecia`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: form,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`POST /api/tasks/${taskId}/zdjecia status=${res.status} body=${text.slice(0, 240)}`);
  }
  return data;
}

async function fetchTask(token, taskId) {
  return requestJson('GET', `/api/tasks/${taskId}`, { token });
}

async function resolveTask(token) {
  const explicit = String(process.env.SMOKE_FIELD_TASK_ID || '').trim();
  if (explicit) return fetchTask(token, Number(explicit));
  const tasks = await requestJson('GET', '/api/tasks/wszystkie?limit=25&offset=0', { token });
  const items = Array.isArray(tasks?.items) ? tasks.items : Array.isArray(tasks) ? tasks : [];
  const preferredStatuses = ['Wycena_Terenowa', 'Nowe', 'Do_Zatwierdzenia'];
  const preferred = items.find((row) => preferredStatuses.includes(row?.status));
  const task = preferred || items.find((row) => !['Zakonczone', 'Anulowane'].includes(row?.status));
  if (!task?.id) throw new Error('No task available for smoke field flow');
  return fetchTask(token, Number(task.id));
}

async function saveFieldPackage(taskId, token, stamp) {
  const payload = {
    zakres_prac: `Smoke: ogledziny terenowe ${stamp}. Przycinka korony, zabezpieczenie posesji, wywoz galezi.`,
    ryzyka: 'Smoke: linia ogrodzenia i dojscie dla rebaka do potwierdzenia przez biuro.',
    typy_prac: ['Przycinka', 'Wycinka kontrolowana'],
    sprzet: ['Pilarka', 'Rebak', 'Liny'],
    warunki_rozliczenia: 'Smoke: klient akceptuje budzet po ogledzinach; biuro potwierdza termin.',
    odpady: 'Wywoz galezi i uporzadkowanie terenu.',
    czas_planowany_godziny: 2.5,
    wartosc_planowana: 1500,
    klient_zaakceptowal: true,
    send_to_office: true,
  };
  return requestJson('PUT', `/api/tasks/${taskId}/field-package`, { token, body: payload });
}

async function main() {
  console.log(`SMOKE_FIELD_BASE_URL=${BASE}`);
  const ready = await requestJson('GET', '/api/ready');
  if (ready?.status !== 'ready') throw new Error(`API not ready: ${JSON.stringify(ready)}`);
  console.log('SMOKE_FIELD_READY=ok');

  const login = await requestJson('POST', '/api/auth/login', {
    body: { login: LOGIN, haslo: PASSWORD },
  });
  if (!login?.token) throw new Error('Login did not return token');
  const token = login.token;
  console.log('SMOKE_FIELD_LOGIN=ok');

  const task = await resolveTask(token);
  const taskId = Number(task.id);
  if (!taskId) throw new Error('Resolved task has no id');
  console.log(`SMOKE_FIELD_TASK_ID=${taskId}`);
  console.log(`SMOKE_FIELD_TASK_STATUS=${task.status || 'unknown'}`);

  const stamp = Date.now();
  const wycenaPhoto = await uploadTaskPhoto(taskId, token, `smoke-field-photo-wycena-${stamp}`, {
    typ: 'Wycena',
    opis: 'smoke field estimation photo',
  });
  if (!wycenaPhoto?.sciezka) throw new Error('Wycena photo upload did not return sciezka');
  const szkicPhoto = await uploadTaskPhoto(taskId, token, `smoke-field-photo-szkic-${stamp}`, {
    typ: 'Szkic',
    opis: 'smoke field scope sketch',
  });
  if (!szkicPhoto?.sciezka) throw new Error('Szkic photo upload did not return sciezka');
  const dojazdPhoto = await uploadTaskPhoto(taskId, token, `smoke-field-photo-dojazd-${stamp}`, {
    typ: 'Dojazd',
    opis: 'smoke field access and property photo',
  });
  if (!dojazdPhoto?.sciezka) throw new Error('Dojazd photo upload did not return sciezka');
  console.log('SMOKE_FIELD_REQUIRED_PHOTOS=ok');

  if (['Nowe', 'Wycena_Terenowa', 'Do_Zatwierdzenia'].includes(task.status)) {
    const fieldPackage = await saveFieldPackage(taskId, token, stamp);
    if (!fieldPackage?.id) throw new Error('Field package response did not return task id');
    console.log(`SMOKE_FIELD_PACKAGE=ok status=${fieldPackage.status || 'n/a'}`);
  } else {
    console.log(`SMOKE_FIELD_PACKAGE=skipped_status_${task.status || 'unknown'}`);
  }

  const opis = `smoke-field-opis-${stamp}`;
  await requestJson('POST', `/api/tasks/${taskId}/problemy`, {
    token,
    headers: { 'Idempotency-Key': `smoke-field-problem-${stamp}` },
    body: { typ: 'usterka', opis },
  });
  const issues = await requestJson('GET', `/api/tasks/${taskId}/problemy`, { token });
  const issueOk = Array.isArray(issues) && issues.some((x) => x.opis === opis && x.typ === 'Awaria_Sprzetu');
  if (!issueOk) throw new Error('Problem opis/typ was not returned by API');
  console.log('SMOKE_FIELD_PROBLEM=ok');

  const photoKey = `smoke-field-photo-${stamp}`;
  const firstPhoto = await uploadTaskPhoto(taskId, token, photoKey);
  if (!firstPhoto?.sciezka) throw new Error('First photo upload did not return sciezka');
  const replayPhoto = await uploadTaskPhoto(taskId, token, photoKey);
  if (!replayPhoto?.idempotent_replay) throw new Error('Second photo upload was not idempotent replay');
  console.log('SMOKE_FIELD_PHOTO=ok');
  console.log('SMOKE_FIELD_PHOTO_REPLAY=ok');
  console.log('SMOKE_FIELD_FLOW_OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
