#!/usr/bin/env node
/**
 * Smoke for signature -> protocol PDF flow:
 * - login
 * - resolve accessible task
 * - upsert client signature
 * - read signature
 * - generate short protocol link
 * - fetch PDF using access_token link (without Authorization header)
 *
 * Env:
 *   SMOKE_BASE_URL=http://127.0.0.1:3000
 *   SMOKE_LOGIN=smoke_admin
 *   SMOKE_PASSWORD=Smoke123!
 *   SMOKE_TASK_ID=optional existing task id
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const LOGIN = process.env.SMOKE_LOGIN || 'smoke_admin';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Smoke123!';

const SIGNATURE_PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5w7kQAAAAASUVORK5CYII=';

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
    throw new Error(`${method} ${path} status=${res.status} body=${text.slice(0, 280)}`);
  }
  return data;
}

async function resolveTaskId(token) {
  const explicit = String(process.env.SMOKE_TASK_ID || '').trim();
  if (explicit) return Number(explicit);
  const tasks = await requestJson('GET', '/api/tasks/wszystkie?limit=1&offset=0', { token });
  const task = Array.isArray(tasks?.items) ? tasks.items[0] : Array.isArray(tasks) ? tasks[0] : null;
  if (!task?.id) throw new Error('No task available for signature/protocol smoke flow');
  return Number(task.id);
}

function ensurePdfBuffer(buffer) {
  const prefix = buffer.subarray(0, 5).toString('utf8');
  if (prefix !== '%PDF-') {
    throw new Error(`Invalid PDF header: ${JSON.stringify(prefix)}`);
  }
}

async function fetchPdfFromShortLink(path) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PDF fetch failed status=${res.status} body=${body.slice(0, 240)}`);
  }
  const arr = await res.arrayBuffer();
  const buf = Buffer.from(arr);
  ensurePdfBuffer(buf);
  return buf;
}

async function main() {
  console.log(`SMOKE_SIGNATURE_BASE_URL=${BASE}`);
  const ready = await requestJson('GET', '/api/ready');
  if (ready?.status !== 'ready') throw new Error(`API not ready: ${JSON.stringify(ready)}`);
  console.log('SMOKE_SIGNATURE_READY=ok');

  const login = await requestJson('POST', '/api/auth/login', {
    body: { login: LOGIN, haslo: PASSWORD },
  });
  if (!login?.token) throw new Error('Login did not return token');
  const token = login.token;
  console.log('SMOKE_SIGNATURE_LOGIN=ok');

  const taskId = await resolveTaskId(token);
  console.log(`SMOKE_SIGNATURE_TASK_ID=${taskId}`);

  const stamp = Date.now();
  const signerName = `Smoke Klient ${stamp}`;
  const signatureNote = `smoke-signature-note-${stamp}`;
  await requestJson('PUT', `/api/tasks/${taskId}/client-signature`, {
    token,
    body: {
      signer_name: signerName,
      signature_data_url: SIGNATURE_PNG_1X1,
      signed_at: new Date().toISOString(),
      note: signatureNote,
    },
  });
  console.log('SMOKE_SIGNATURE_SAVE=ok');

  const signature = await requestJson('GET', `/api/tasks/${taskId}/client-signature`, { token });
  if (!signature || signature.signer_name !== signerName) {
    throw new Error(`Signature read mismatch: ${JSON.stringify(signature)}`);
  }
  console.log('SMOKE_SIGNATURE_READ=ok');

  const protokol = await requestJson('GET', `/api/tasks/${taskId}/protokol-link`, { token });
  if (!protokol?.path || !String(protokol.path).includes(`/api/pdf/zlecenie/${taskId}?access_token=`)) {
    throw new Error(`Invalid protocol path payload: ${JSON.stringify(protokol)}`);
  }
  console.log('SMOKE_SIGNATURE_LINK=ok');

  const pdfBuffer = await fetchPdfFromShortLink(String(protokol.path));
  if (pdfBuffer.length < 500) {
    throw new Error(`Protocol PDF looks too small (${pdfBuffer.length} bytes)`);
  }
  console.log(`SMOKE_SIGNATURE_PDF_BYTES=${pdfBuffer.length}`);
  console.log('SMOKE_SIGNATURE_PROTOCOL_OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

