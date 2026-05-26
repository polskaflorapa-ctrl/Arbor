#!/usr/bin/env node
/**
 * Smoke for the office planning step:
 * - pick a task prepared by field smoke
 * - pick an available team for the task branch
 * - optionally reserve one equipment item through office-plan
 * - verify the task becomes Zaplanowane / crew-ready
 * - create a second smoke task and verify the same team slot is blocked
 *
 * Env:
 *   SMOKE_BASE_URL=http://127.0.0.1:3000
 *   SMOKE_LOGIN=smoke_admin
 *   SMOKE_PASSWORD=Smoke123!
 *   SMOKE_OFFICE_TASK_ID=required unless SMOKE_FIELD_TASK_ID/SMOKE_OPERATIONAL_TASK_ID is set
 *   SMOKE_OFFICE_CONFLICT_CHECK=0 to skip conflict assertion
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const LOGIN = process.env.SMOKE_LOGIN || 'smoke_admin';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Smoke123!';

async function requestJson(method, path, { token, body, headers = {}, okStatuses = [200] } = {}) {
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
  if (!okStatuses.includes(res.status)) {
    throw new Error(`${method} ${path} status=${res.status} body=${text.slice(0, 300)}`);
  }
  return { status: res.status, data };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function plannedSlot(seed = Date.now(), attempt = 0) {
  const dayOffset = 45 + ((Math.floor(seed / 1000) + attempt * 17) % 240);
  const minuteOffset = 6 * 60 + ((Math.floor(seed / 60000) + attempt * 37) % 540);
  const hour = Math.floor(minuteOffset / 60);
  const minute = minuteOffset % 60;
  return {
    date: dateKey(addDays(new Date(), dayOffset)),
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function taskIdFromEnv() {
  const raw =
    process.env.SMOKE_OFFICE_TASK_ID ||
    process.env.SMOKE_FIELD_TASK_ID ||
    process.env.SMOKE_OPERATIONAL_TASK_ID ||
    '';
  const id = Number(String(raw).trim());
  if (!Number.isFinite(id) || id < 1) {
    throw new Error('SMOKE_OFFICE_TASK_ID or SMOKE_FIELD_TASK_ID is required');
  }
  return id;
}

async function login() {
  const { data } = await requestJson('POST', '/api/auth/login', {
    body: { login: LOGIN, haslo: PASSWORD },
  });
  if (!data?.token) throw new Error('Login did not return token');
  return data.token;
}

async function fetchTask(token, taskId) {
  const { data } = await requestJson('GET', `/api/tasks/${taskId}`, { token });
  if (!data?.id) throw new Error(`Task ${taskId} not found`);
  return data;
}

async function resolveTeam(token, oddzialId) {
  const suffix = oddzialId ? `?oddzial_id=${encodeURIComponent(oddzialId)}&include_delegacje=true&limit=50` : '?limit=50';
  const { data } = await requestJson('GET', `/api/ekipy${suffix}`, { token });
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const team = items.find((row) => row?.id);
  if (!team) throw new Error(`No team available for office smoke (oddzial_id=${oddzialId || 'any'})`);
  return team;
}

async function resolveEquipmentIds(token, oddzialId, date, teamId) {
  if (!oddzialId) return [];
  const params = new URLSearchParams({
    oddzial_id: String(oddzialId),
    include_delegacje: 'true',
    date,
    limit: '50',
  });
  const { data } = await requestJson('GET', `/api/flota/sprzet?${params.toString()}`, { token });
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items
    .filter((row) => row?.id)
    .filter((row) => !row.ekipa_id || Number(row.ekipa_id) === Number(teamId))
    .slice(0, 1)
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));
}

async function putOfficePlan(token, taskId, payload, okStatuses = [200]) {
  return requestJson('PUT', `/api/tasks/${taskId}/office-plan`, {
    token,
    body: payload,
    okStatuses,
  });
}

async function planWithRetry(token, task, team) {
  const seed = Date.now();
  const oddzialId = task.oddzial_id || team.oddzial_id || null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slot = plannedSlot(seed, attempt);
    const equipmentIds = await resolveEquipmentIds(token, oddzialId, slot.date, team.id);
    const payload = {
      data_planowana: slot.date,
      godzina_rozpoczecia: slot.time,
      czas_planowany_godziny: 2.5,
      ekipa_id: team.id,
      sprzet_notatka: equipmentIds.length
        ? 'Smoke: sprzet zarezerwowany przez plan biura.'
        : 'Smoke: bez dodatkowego sprzetu.',
      ...(equipmentIds.length ? { sprzet_ids: equipmentIds } : {}),
    };
    const result = await putOfficePlan(token, task.id, payload, [200, 409]);
    if (result.status === 200) return { payload, response: result.data };
    const code = result.data?.code || result.data?.error || '';
    if (!String(code).includes('TASK_PLAN_CONFLICT')) {
      throw new Error(`Office plan blocked unexpectedly: ${JSON.stringify(result.data)}`);
    }
  }
  throw new Error('Could not find conflict-free office planning slot');
}

async function createConflictTask(token, task, slotPayload) {
  const stamp = Date.now();
  const { data } = await requestJson('POST', '/api/tasks/nowe', {
    token,
    body: {
      klient_nazwa: `SMOKE konflikt planu ${stamp}`,
      klient_telefon: '+48000000000',
      klient_email: 'smoke-office@example.invalid',
      adres: task.adres || 'Smoke konflikt 1',
      miasto: task.miasto || 'Krakow',
      typ_uslugi: 'Smoke plan konflikt',
      priorytet: 'Normalny',
      wartosc_planowana: 1500,
      czas_planowany_godziny: slotPayload.czas_planowany_godziny || 2.5,
      data_planowana: slotPayload.data_planowana,
      godzina_rozpoczecia: slotPayload.godzina_rozpoczecia,
      opis: 'Smoke: zadanie konfliktowe do sprawdzenia blokady harmonogramu.',
      opis_pracy: 'Smoke: zadanie konfliktowe do sprawdzenia blokady harmonogramu.',
      notatki_wewnetrzne: 'Smoke office conflict check.',
      oddzial_id: task.oddzial_id || undefined,
      status: 'Do_Zatwierdzenia',
      budzet: 1500,
      wynik: 'Klient zaakceptowal zakres i budzet w terenie.',
    },
  });
  if (!data?.id) throw new Error(`Conflict task create failed: ${JSON.stringify(data)}`);
  return data;
}

async function assertConflict(token, sourceTask, slotPayload) {
  if (process.env.SMOKE_OFFICE_CONFLICT_CHECK === '0') {
    console.log('SMOKE_OFFICE_CONFLICT=skipped');
    return;
  }
  const conflictTask = await createConflictTask(token, sourceTask, slotPayload);
  const { status, data } = await putOfficePlan(token, conflictTask.id, slotPayload, [409]);
  if (status !== 409 || data?.code !== 'TASK_PLAN_CONFLICT') {
    throw new Error(`Expected TASK_PLAN_CONFLICT, got status=${status} body=${JSON.stringify(data)}`);
  }
  console.log(`SMOKE_OFFICE_CONFLICT=ok conflict_task_id=${conflictTask.id}`);
}

async function main() {
  console.log(`SMOKE_OFFICE_BASE_URL=${BASE}`);
  const token = await login();
  console.log('SMOKE_OFFICE_LOGIN=ok');

  const taskId = taskIdFromEnv();
  const task = await fetchTask(token, taskId);
  console.log(`SMOKE_OFFICE_TASK_ID=${task.id}`);

  const team = await resolveTeam(token, task.oddzial_id);
  console.log(`SMOKE_OFFICE_TEAM_ID=${team.id}`);

  const { payload, response } = await planWithRetry(token, task, team);
  if (response?.status !== 'Zaplanowane') {
    throw new Error(`Office plan did not set Zaplanowane: ${JSON.stringify(response)}`);
  }
  if (response?.office_plan_ready !== true) {
    throw new Error(`Office plan is not ready: ${JSON.stringify(response?.office_plan_missing_labels || response)}`);
  }
  console.log(`SMOKE_OFFICE_PLAN=ok task_id=${task.id} date=${payload.data_planowana} time=${payload.godzina_rozpoczecia}`);

  await assertConflict(token, task, payload);
  console.log('SMOKE_OFFICE_PLAN_FLOW_OK');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
