#!/usr/bin/env node

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const MANAGER_LOGIN = process.env.SMOKE_MANAGER_LOGIN || process.env.SMOKE_LOGIN || 'smoke_admin';
const MANAGER_PASSWORD = process.env.SMOKE_MANAGER_PASSWORD || process.env.SMOKE_PASSWORD || 'Smoke123!';
const BRANCH_LOGIN = process.env.SMOKE_BRANCH_LOGIN || 'smoke_brygadzista';
const BRANCH_PASSWORD = process.env.SMOKE_BRANCH_PASSWORD || 'Smoke123!';

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function request(method, path, token, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    json: parseJson(text),
    text,
  };
}

async function login(loginValue, passwordValue) {
  const result = await request('POST', '/api/auth/login', null, {
    login: loginValue,
    haslo: passwordValue,
  });
  if (result.status !== 200 || !result.json?.token) {
    throw new Error(`login_failed user=${loginValue} status=${result.status} body=${result.text.slice(0, 220)}`);
  }
  return result.json.token;
}

function pickItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function assertStatus(name, result, expected) {
  if (!expected.includes(result.status)) {
    throw new Error(`${name}_status_mismatch status=${result.status} expected=${expected.join('|')} body=${result.text.slice(0, 220)}`);
  }
}

function includesId(items, id) {
  return items.some((row) => Number(row?.id) === Number(id));
}

async function main() {
  const marker = `tele-scope-${Date.now()}`;
  const managerToken = await login(MANAGER_LOGIN, MANAGER_PASSWORD);
  const branchToken = await login(BRANCH_LOGIN, BRANCH_PASSWORD);
  const branchPayload = decodeJwtPayload(branchToken);
  const branchId = Number(branchPayload?.oddzial_id);
  if (!Number.isFinite(branchId) || branchId <= 0) {
    throw new Error(`branch_user_missing_oddzial_id payload=${JSON.stringify(branchPayload || {})}`);
  }
  const foreignBranchId = branchId + 9999;

  const branchCallBlocked = await request('POST', '/api/telephony/calls', branchToken, {
    oddzial_id: foreignBranchId,
    phone: '+48511122001',
    call_type: 'outbound',
    status: 'answered',
  });
  assertStatus('branch_call_create_foreign', branchCallBlocked, [403]);

  const branchCallbackBlocked = await request('POST', '/api/telephony/callbacks', branchToken, {
    oddzial_id: foreignBranchId,
    phone: '+48511122002',
    priority: 'normal',
  });
  assertStatus('branch_callback_create_foreign', branchCallbackBlocked, [403]);

  const createCall = await request('POST', '/api/telephony/calls', managerToken, {
    oddzial_id: branchId,
    phone: '+48511122003',
    call_type: 'outbound',
    status: 'answered',
    duration_sec: 21,
    lead_name: marker,
    notes: marker,
  });
  assertStatus('manager_call_create', createCall, [201]);

  const dueAt = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16);
  const createCallback = await request('POST', '/api/telephony/callbacks', managerToken, {
    oddzial_id: branchId,
    phone: '+48511122004',
    lead_name: marker,
    priority: 'high',
    due_at: dueAt,
    notes: marker,
  });
  assertStatus('manager_callback_create', createCallback, [201]);

  const callId = createCall.json?.id;
  const callbackId = createCallback.json?.id;
  if (!callId || !callbackId) {
    throw new Error(`create_missing_ids call_id=${callId || 'none'} callback_id=${callbackId || 'none'}`);
  }

  const branchCalls = await request(
    'GET',
    `/api/telephony/calls?oddzial_id=${foreignBranchId}&status=answered&limit=200&offset=0`,
    branchToken
  );
  assertStatus('branch_calls_list', branchCalls, [200]);

  const branchCallbacks = await request(
    'GET',
    `/api/telephony/callbacks?oddzial_id=${foreignBranchId}&status=open&limit=200&offset=0`,
    branchToken
  );
  assertStatus('branch_callbacks_list', branchCallbacks, [200]);

  const managerTargetCallbacks = await request(
    'GET',
    `/api/telephony/callbacks?oddzial_id=${branchId}&status=open&limit=200&offset=0`,
    managerToken
  );
  assertStatus('manager_callbacks_target_list', managerTargetCallbacks, [200]);

  const managerForeignCallbacks = await request(
    'GET',
    `/api/telephony/callbacks?oddzial_id=${foreignBranchId}&status=open&limit=200&offset=0`,
    managerToken
  );
  assertStatus('manager_callbacks_foreign_list', managerForeignCallbacks, [200]);

  const branchCallItems = pickItems(branchCalls.json);
  const branchCallbackItems = pickItems(branchCallbacks.json);
  const managerTargetItems = pickItems(managerTargetCallbacks.json);
  const managerForeignItems = pickItems(managerForeignCallbacks.json);

  const assertions = {
    branch_user_sees_own_call_with_foreign_filter: includesId(branchCallItems, callId),
    branch_user_sees_own_callback_with_foreign_filter: includesId(branchCallbackItems, callbackId),
    manager_sees_callback_when_filtering_target_branch: includesId(managerTargetItems, callbackId),
    manager_does_not_see_callback_when_filtering_foreign_branch: !includesId(managerForeignItems, callbackId),
  };

  const failed = Object.entries(assertions).filter(([, ok]) => !ok).map(([name]) => name);
  const summary = {
    base: BASE,
    users: {
      manager_login: MANAGER_LOGIN,
      branch_login: BRANCH_LOGIN,
      branch_id: branchId,
      foreign_branch_id: foreignBranchId,
    },
    created: {
      marker,
      call_id: callId,
      callback_id: callbackId,
    },
    assertions,
    counts: {
      branch_calls: branchCallItems.length,
      branch_callbacks: branchCallbackItems.length,
      manager_target_callbacks: managerTargetItems.length,
      manager_foreign_callbacks: managerForeignItems.length,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) {
    throw new Error(`telephony_scope_smoke_failed ${failed.join(',')}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
