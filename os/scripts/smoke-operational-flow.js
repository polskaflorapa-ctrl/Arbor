#!/usr/bin/env node
/**
 * One-command operational smoke for the "phone -> field -> office -> crew" backbone.
 *
 * It stitches existing smoke checks into a single gate:
 * - auth and permission contract
 * - field package with required photos, issue report, photo idempotency
 * - payroll/reporting smoke and optional start/finish mutation
 *
 * Env:
 *   SMOKE_BASE_URL=http://127.0.0.1:3000
 *   SMOKE_LOGIN=smoke_admin
 *   SMOKE_PASSWORD=Smoke123!
 *   SMOKE_OPERATIONAL_TASK_ID=optional existing task id; otherwise a smoke task is created
 *   SMOKE_OPERATIONAL_FINISH=1 arms the finish path; requires SMOKE_OPERATIONAL_TASK_ID
 *   SMOKE_FINISH_TASK_ID can still be set directly for the F0.3 finish path
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SCRIPTS_DIR = __dirname;
const CWD = path.resolve(SCRIPTS_DIR, '..');
const LOGIN = process.env.SMOKE_LOGIN || 'smoke_admin';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Smoke123!';

function envForPhase() {
  const env = {
    ...process.env,
    SMOKE_BASE_URL: BASE,
  };

  const operationalTaskId = String(process.env.SMOKE_OPERATIONAL_TASK_ID || '').trim();
  if (operationalTaskId && !env.SMOKE_FIELD_TASK_ID) {
    env.SMOKE_FIELD_TASK_ID = operationalTaskId;
  }
  if (operationalTaskId && !env.SMOKE_OFFICE_TASK_ID) {
    env.SMOKE_OFFICE_TASK_ID = operationalTaskId;
  }

  const finishArmed = process.env.SMOKE_OPERATIONAL_FINISH === '1';
  if (finishArmed) {
    if (!operationalTaskId && !env.SMOKE_FINISH_TASK_ID) {
      throw new Error('SMOKE_OPERATIONAL_FINISH=1 requires SMOKE_OPERATIONAL_TASK_ID or SMOKE_FINISH_TASK_ID');
    }
    if (!env.SMOKE_FINISH_TASK_ID) {
      env.SMOKE_FINISH_TASK_ID = operationalTaskId;
    }
  }

  return env;
}

async function requestJson(method, apiPath, { token, body, okStatuses = [200] } = {}) {
  const response = await fetch(`${BASE}${apiPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!okStatuses.includes(response.status)) {
    throw new Error(`${method} ${apiPath} status=${response.status} body=${text.slice(0, 300)}`);
  }
  return data;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function loginForPrepare() {
  const data = await requestJson('POST', '/api/auth/login', {
    body: { login: LOGIN, haslo: PASSWORD },
  });
  if (!data?.token) throw new Error('prepare login did not return token');
  return data.token;
}

async function resolveAnyTeam(token) {
  const data = await requestJson('GET', '/api/ekipy?include_delegacje=true&limit=50', { token });
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const team = items.find((row) => row?.id && row?.oddzial_id);
  if (!team) throw new Error('No team with oddzial_id available for operational smoke');
  return team;
}

async function createOperationalTask(token) {
  const team = await resolveAnyTeam(token);
  const stamp = Date.now();
  const inspectionDate = addDays(new Date(), 1 + (stamp % 7)).toISOString().slice(0, 10);
  const data = await requestJson('POST', '/api/tasks/nowe', {
    token,
    body: {
      klient_nazwa: `SMOKE klient operacyjny ${stamp}`,
      klient_telefon: '+48000000000',
      klient_email: 'smoke-operational@example.invalid',
      adres: 'Smoke testowa 1',
      miasto: 'Krakow',
      typ_uslugi: 'Smoke ogledziny',
      priorytet: 'Normalny',
      wartosc_planowana: 1000,
      czas_planowany_godziny: 2,
      data_planowana: inspectionDate,
      godzina_rozpoczecia: '09:00',
      opis: 'Smoke: klient dzwoni, biuro tworzy ogledziny, wyceniacz uzupelnia teren.',
      opis_pracy: 'Smoke: startowy opis z biura przed ogledzinami.',
      notatki_wewnetrzne: 'Smoke operational backbone task.',
      oddzial_id: team.oddzial_id,
      status: 'Wycena_Terenowa',
    },
  });
  if (!data?.id) throw new Error(`Operational smoke task create failed: ${JSON.stringify(data)}`);
  return data.id;
}

async function prepareOperationalTask(env) {
  if (env.SMOKE_FIELD_TASK_ID && env.SMOKE_OFFICE_TASK_ID) {
    console.log(`OP_FLOW_PREPARE_TASK=provided_${env.SMOKE_FIELD_TASK_ID}`);
    return env;
  }
  const token = await loginForPrepare();
  const taskId = await createOperationalTask(token);
  env.SMOKE_FIELD_TASK_ID = String(taskId);
  env.SMOKE_OFFICE_TASK_ID = String(taskId);
  console.log(`OP_FLOW_PREPARE_TASK=created_${taskId}`);
  return env;
}

function finishModeLabel(env) {
  if (env.SMOKE_FINISH_TASK_ID) return `armed_task_${env.SMOKE_FINISH_TASK_ID}`;
  return 'skipped_no_SMOKE_FINISH_TASK_ID';
}

function runScript(label, script, env) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, script);
    console.log(`OP_FLOW_PHASE=${label}`);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: CWD,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        console.log(`OP_FLOW_PHASE_${label}=ok`);
        resolve();
        return;
      }
      reject(new Error(`${label} failed with ${signal || `exit_${code}`}`));
    });
  });
}

async function main() {
  const env = envForPhase();
  console.log(`OP_FLOW_BASE_URL=${BASE}`);
  console.log(`OP_FLOW_TASK=${env.SMOKE_FIELD_TASK_ID || 'auto'}`);
  console.log(`OP_FLOW_FINISH=${finishModeLabel(env)}`);

  await runScript('auth', 'smoke-auth-check.js', env);
  await prepareOperationalTask(env);
  await runScript('field', 'smoke-field-flow.js', env);
  await runScript('office', 'smoke-office-plan-flow.js', env);
  await runScript('f03', 'smoke-f0-3-m11.js', env);

  console.log('OP_FLOW_OK');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
