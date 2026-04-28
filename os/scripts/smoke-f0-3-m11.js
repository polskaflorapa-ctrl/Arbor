#!/usr/bin/env node
/**
 * F0.3 — smoke M11 / payroll po zalogowaniu.
 * Domyślnie: GET /api/ready, login (SMOKE_LOGIN), endpointy payroll, eksport CSV/ZIP (200 lub 409).
 * Opcjonalnie na końcu: mutacja zlecenia — ustaw `SMOKE_FINISH_TASK_ID` (np. zlecenie nie-Zakonczone).
 *   • Bez `SMOKE_TEAM_*`: ten sam użytkownik co smoke robi POST /tasks/:id/start (admin — bez checklisty) + POST /finish bez płatności (audyt task_calc_log).
 *   • Z `SMOKE_TEAM_LOGIN` + `SMOKE_TEAM_PASSWORD`: login ekipy, start z GPS + checklistą, finish z `payment` (domyślnie Gotówka 1 PLN — `SMOKE_FINISH_KWOTA`, `SMOKE_FINISH_FORMA`).
 * Wymaga: działający OS + `npm run smoke:user` (tworzy `smoke_admin` i `smoke_brygadzista` / ta sama baza co `SMOKE_*` w DB) lub własne SMOKE_LOGIN / SMOKE_PASSWORD.
 *
 * Env: SMOKE_BASE_URL, SMOKE_LOGIN, SMOKE_PASSWORD, SMOKE_FINISH_TASK_ID?, SMOKE_TEAM_LOGIN? (np. smoke_brygadzista), SMOKE_TEAM_PASSWORD?,
 *      SMOKE_FINISH_LAT?, SMOKE_FINISH_LNG?, SMOKE_FINISH_FORMA?, SMOKE_FINISH_KWOTA?, SMOKE_FINISH_NIP? (przy Faktura_VAT)
 */
const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const LOGIN = process.env.SMOKE_LOGIN || 'smoke_admin';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Smoke123!';

function currentMonthParam() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

async function request(method, path, { body, token, accept } = {}) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(p, `${BASE}/`);
  const headers = {};
  if (accept) headers.Accept = accept;
  else headers.Accept = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text && (headers.Accept || '').includes('json')) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, text, json };
}

/** Eksport binarny (ZIP); przy 409 treść to zwykle JSON tekstowy. */
async function requestBinary(method, path, { token } = {}) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(p, `${BASE}/`);
  const headers = { Accept: '*/*' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, contentType: res.headers.get('content-type') || '', body: buf };
}

/** Multipart „Po” — gdy `TASK_FINISH_REQUIRE_PO_PHOTO=1` albo zawsze dla ścieżki ekipy (spójność z OS). */
async function uploadSmokePoPhoto(taskId, token) {
  const jpegB64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';
  const buf = Buffer.from(jpegB64, 'base64');
  const form = new FormData();
  form.append('typ', 'po');
  form.append('zdjecie', new Blob([buf], { type: 'image/jpeg' }), 'smoke-po.jpg');
  const url = new URL(`/api/tasks/${taskId}/zdjecia`, `${BASE}/`);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`smoke_upload_po_photo status=${res.status} ${txt.slice(0, 200)}`);
  }
  console.log('F0.3_FINISH_PO_PHOTO=uploaded');
}

/**
 * @param {typeof request} request
 */
async function runOptionalTaskFinish(request, adminToken) {
  const raw = process.env.SMOKE_FINISH_TASK_ID;
  if (raw == null || String(raw).trim() === '') return;
  const tid = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(tid) || tid < 1) {
    throw new Error(`SMOKE_FINISH_TASK_ID invalid: ${raw}`);
  }

  const teamLogin = String(process.env.SMOKE_TEAM_LOGIN || '').trim();
  const teamPass = process.env.SMOKE_TEAM_PASSWORD || '';
  const useTeam = !!(teamLogin && teamPass);

  let token = adminToken;
  if (useTeam) {
    const tl = await request('POST', '/api/auth/login', { body: { login: teamLogin, haslo: teamPass } });
    if (tl.status !== 200 || !tl.json?.token) {
      throw new Error(`smoke_team_login_failed status=${tl.status} ${(tl.text || '').slice(0, 180)}`);
    }
    token = tl.json.token;
    console.log('F0.3_TEAM_LOGIN=ok');
  }

  const taskGet = await request('GET', `/api/tasks/${tid}`, { token });
  if (taskGet.status === 403) {
    throw new Error(`finish_task_access_denied task_id=${tid} (ekipa musi mieć dostęp do zlecenia)`);
  }
  if (taskGet.status !== 200) {
    throw new Error(`finish_task_get status=${taskGet.status} ${(taskGet.text || '').slice(0, 200)}`);
  }
  if (taskGet.json?.status === 'Zakonczone') {
    console.log('F0.3_FINISH=skipped_task_already_closed');
    return;
  }

  const logi = await request('GET', `/api/tasks/${tid}/logi`, { token });
  if (logi.status !== 200) {
    throw new Error(`finish_logi status=${logi.status}`);
  }
  const hasOpen = Array.isArray(logi.json) && logi.json.some((r) => r.end_time == null);

  if (!hasOpen) {
    const startBody = useTeam
      ? {
          lat: parseFloat(process.env.SMOKE_FINISH_LAT || '52.2297', 10),
          lng: parseFloat(process.env.SMOKE_FINISH_LNG || '21.0122', 10),
          dmuchawa_filtr_ok: true,
          rebak_zatankowany: true,
          kaski_zespol: true,
          bhp_potwierdzone: true,
        }
      : {};
    const st = await request('POST', `/api/tasks/${tid}/start`, { body: startBody, token });
    if (st.status !== 200) {
      throw new Error(
        `finish_start_failed status=${st.status} ${JSON.stringify(st.json || (st.text || '').slice(0, 220))}`
      );
    }
    console.log(`F0.3_FINISH_START=ok work_log_id=${st.json?.work_log_id}`);
  } else {
    console.log('F0.3_FINISH_START=skipped_open_work_log');
  }

  if (useTeam) {
    await uploadSmokePoPhoto(tid, token);
  }

  const latD = parseFloat(process.env.SMOKE_FINISH_LAT || '52.2297', 10);
  const lngD = parseFloat(process.env.SMOKE_FINISH_LNG || '21.0122', 10);
  const forma = String(process.env.SMOKE_FINISH_FORMA || 'Gotowka').trim();
  const kwota = parseFloat(process.env.SMOKE_FINISH_KWOTA || '1', 10);
  const nip = String(process.env.SMOKE_FINISH_NIP || '5250007276').replace(/\s/g, '');

  /** @type {Record<string, unknown>} */
  let finishBody = {};
  if (useTeam) {
    const isFakturaVat = forma === 'Faktura_VAT';
    finishBody = {
      lat: latD,
      lng: lngD,
      zuzyte_materialy: [{ nazwa: 'smoke_test_material', ilosc: 1, jednostka: 'szt' }],
      payment: {
        forma_platnosc: forma,
        kwota_odebrana: Number.isFinite(kwota) ? kwota : 1,
        faktura_vat: isFakturaVat,
        ...(isFakturaVat ? { nip } : {}),
      },
    };
    if (isFakturaVat && (!nip || nip.length < 10)) {
      throw new Error('SMOKE_FINISH_NIP wymagany (min. 10 znaków) przy Faktura_VAT');
    }
  }

  const fin = await request('POST', `/api/tasks/${tid}/finish`, { body: finishBody, token });
  if (fin.status !== 200) {
    throw new Error(`finish_failed status=${fin.status} ${JSON.stringify(fin.json || (fin.text || '').slice(0, 320))}`);
  }
  console.log(
    `F0.3_FINISH=ok net=${fin.json?.wartosc_netto_do_rozliczenia}${useTeam ? ' (payment_path)' : ' (admin_no_payment)'}`
  );
}

async function main() {
  const month = currentMonthParam();
  console.log(`SMOKE_BASE_URL=${BASE}`);
  console.log(`SMOKE_MONTH=${month.slice(0, 7)}`);

  const ready = await request('GET', '/api/ready');
  if (ready.status !== 200 || ready.json?.status !== 'ready') {
    throw new Error(`api_ready_failed status=${ready.status} ${ready.text?.slice(0, 120)}`);
  }
  console.log('F0.3_API_READY=ok');

  const login = await request('POST', '/api/auth/login', { body: { login: LOGIN, haslo: PASSWORD } });
  if (login.status !== 200 || !login.json?.token) {
    throw new Error(`login_failed status=${login.status} body=${login.text?.slice(0, 200)}`);
  }
  console.log('F0.3_LOGIN=ok');
  const token = login.json.token;

  const tasks = await request('GET', '/api/tasks/wszystkie?limit=5&offset=0', { token });
  if (tasks.status !== 200 || !tasks.json || typeof tasks.json !== 'object') {
    throw new Error(`tasks_list_failed status=${tasks.status}`);
  }
  const total = tasks.json.total ?? (Array.isArray(tasks.json.items) ? tasks.json.items.length : null);
  console.log(`F0.3_TASKS_LIST=ok total=${total ?? 'n/a'}`);

  const close = await request('GET', `/api/payroll/month-close-status?month=${encodeURIComponent(month)}`, { token });
  if (close.status !== 200) {
    throw new Error(`payroll_month_close_status status=${close.status} ${JSON.stringify(close.json)}`);
  }
  console.log(
    `F0.3_PAYROLL_MONTH_CLOSE=ok export_allowed=${close.json?.export_allowed} pending=${close.json?.pending_count ?? 0}`
  );

  const reports = await request('GET', `/api/payroll/team-day-reports?month=${encodeURIComponent(month)}`, { token });
  if (reports.status !== 200 || !Array.isArray(reports.json)) {
    throw new Error(`payroll_team_day_reports status=${reports.status}`);
  }
  console.log(`F0.3_PAYROLL_TEAM_DAY_REPORTS=ok count=${reports.json.length}`);

  const log = await request('GET', `/api/payroll/line-correction-log?month=${encodeURIComponent(month)}`, { token });
  if (log.status !== 200 || !Array.isArray(log.json)) {
    throw new Error(`payroll_line_correction_log status=${log.status}`);
  }
  console.log(`F0.3_PAYROLL_CORRECTION_LOG=ok count=${log.json.length}`);

  const exp = await request('GET', `/api/payroll/export.csv?month=${encodeURIComponent(month.slice(0, 7))}&format=csv`, {
    token,
    accept: 'text/csv, application/json',
  });
  if (exp.status === 200) {
    console.log(`F0.3_PAYROLL_EXPORT_CSV=ok bytes=${exp.text?.length ?? 0}`);
  } else if (exp.status === 409) {
    let msg = 'blocked';
    try {
      const j = JSON.parse(exp.text);
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    console.log(`F0.3_PAYROLL_EXPORT_CSV=skipped_409 (${msg})`);
  } else {
    throw new Error(`payroll_export_csv unexpected status=${exp.status} ${exp.text?.slice(0, 120)}`);
  }

  const zip = await requestBinary('GET', `/api/payroll/export.zip?month=${encodeURIComponent(month.slice(0, 7))}`, {
    token,
  });
  if (zip.status === 200) {
    const isZip =
      zip.contentType.includes('zip') || (zip.body.length >= 2 && zip.body[0] === 0x50 && zip.body[1] === 0x4b);
    if (!isZip) {
      throw new Error(`payroll_export_zip not_zip content_type=${zip.contentType} bytes=${zip.body.length}`);
    }
    console.log(`F0.3_PAYROLL_EXPORT_ZIP=ok bytes=${zip.body.length}`);
  } else if (zip.status === 409) {
    let msg = 'blocked';
    try {
      const j = JSON.parse(zip.body.toString('utf8'));
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    console.log(`F0.3_PAYROLL_EXPORT_ZIP=skipped_409 (${msg})`);
  } else {
    throw new Error(`payroll_export_zip unexpected status=${zip.status} ${zip.body.toString('utf8').slice(0, 120)}`);
  }

  await runOptionalTaskFinish(request, token);

  console.log('F0.3_M11_SMOKE_OK');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
