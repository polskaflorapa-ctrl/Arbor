/**
 * Payload + webhook Kommo (CRM: zlecenie / klient; CMR osobno w web/server).
 * Zmienne środowiska jak w web/.env.example — bez wpisu w env.js (wszystko opcjonalne).
 */

const KOMMO_WEBHOOK_URL =
  (process.env.KOMMO_WEBHOOK_URL || process.env.KOMMO_CMR_WEBHOOK_URL || '').trim();
const KOMMO_CRM_WEBHOOK_URL = (process.env.KOMMO_CRM_WEBHOOK_URL || '').trim();
const KOMMO_WEBHOOK_SECRET_HEADER = (process.env.KOMMO_WEBHOOK_SECRET_HEADER || '').trim();
const KOMMO_WEBHOOK_SECRET = (process.env.KOMMO_WEBHOOK_SECRET || '').trim();
const { calculateTaskMargin, money } = require('./taskMargin');

function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsvStrings(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const KOMMO_PIPELINE_ID = toNum(process.env.KOMMO_PIPELINE_ID);
const KOMMO_STATUS_ID = toNum(process.env.KOMMO_STATUS_ID);
const KOMMO_RESPONSIBLE_USER_ID = toNum(process.env.KOMMO_RESPONSIBLE_USER_ID);
const _KOMMO_TAGS = parseCsvStrings(process.env.KOMMO_TAGS || 'CMR,Arbor');
const KOMMO_CRM_TAGS = parseCsvStrings(process.env.KOMMO_CRM_TAGS || 'Arbor,CRM');
const KOMMO_CF_ORDER_ID = toNum(process.env.KOMMO_CF_ORDER_ID);
const KOMMO_CF_BRANCH_ID = toNum(process.env.KOMMO_CF_BRANCH_ID);
const KOMMO_CF_STATUS_ID = toNum(process.env.KOMMO_CF_STATUS_ID);
const KOMMO_CF_LOAD_DATE_ID = toNum(process.env.KOMMO_CF_LOAD_DATE_ID);
const KOMMO_CF_PHONE_ID = toNum(process.env.KOMMO_CF_PHONE_ID);
const KOMMO_CF_GOODS_SUMMARY_ID = toNum(process.env.KOMMO_CF_GOODS_SUMMARY_ID);
const KOMMO_CF_KLIENT_RECORD_ID = toNum(process.env.KOMMO_CF_KLIENT_RECORD_ID);
const KOMMO_TASK_SYNC_EVENT = 'task.sync';
const KOMMO_PHONE_CALL_EVENT = 'phone_call.recording';

function kommoTaskSyncIdempotencyKey(taskId) {
  return `arbor:${KOMMO_TASK_SYNC_EVENT}:task:${taskId}`;
}

function kommoPhoneCallIdempotencyKey(callSid) {
  return `arbor:${KOMMO_PHONE_CALL_EVENT}:call:${callSid}`;
}

function kommoPayloadIdempotencyKey(payload) {
  return (
    payload?.idempotency_key
    || payload?.task?.sync_meta?.idempotency_key
    || payload?.task?.idempotency_key
    || null
  );
}

async function ensureKommoTaskSyncQueue(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_kommo_sync_queue (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      event VARCHAR(40) NOT NULL DEFAULT 'task.sync',
      idempotency_key VARCHAR(180),
      status VARCHAR(32) NOT NULL DEFAULT 'failed',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMPTZ,
      last_http_status INTEGER,
      last_error TEXT,
      payload_json JSONB,
      actor_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_attempt_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      UNIQUE (task_id, event)
    )
  `);
  await pool.query('ALTER TABLE task_kommo_sync_queue ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180)');
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_task_kommo_sync_queue_status_retry
      ON task_kommo_sync_queue (status, next_retry_at)
  `);
}

function retryDelayMinutes(retryCount) {
  const n = Number(retryCount || 0);
  return Math.min(60, Math.max(5, 5 * Math.pow(2, Math.max(0, n))));
}

async function recordKommoTaskSyncFailure(pool, {
  taskId,
  payload,
  actor = null,
  httpStatus = null,
  error = '',
  retryCount = 0,
  maxRetries = 3,
}) {
  await ensureKommoTaskSyncQueue(pool);
  const nextRetryCount = Number(retryCount || 0) + 1;
  const status = nextRetryCount >= maxRetries ? 'dead_letter' : 'failed';
  const delay = retryDelayMinutes(nextRetryCount);
  const idempotencyKey = kommoPayloadIdempotencyKey(payload) || kommoTaskSyncIdempotencyKey(taskId);
  const result = await pool.query(
    `INSERT INTO task_kommo_sync_queue (
       task_id, event, idempotency_key, status, retry_count, next_retry_at, last_http_status, last_error,
       payload_json, actor_json, last_attempt_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6::text || ' minutes')::interval, $7, $8, $9::jsonb, $10::jsonb, NOW(), NOW())
     ON CONFLICT (task_id, event)
     DO UPDATE SET
       idempotency_key = EXCLUDED.idempotency_key,
       status = EXCLUDED.status,
       retry_count = EXCLUDED.retry_count,
       next_retry_at = EXCLUDED.next_retry_at,
       last_http_status = EXCLUDED.last_http_status,
       last_error = EXCLUDED.last_error,
       payload_json = EXCLUDED.payload_json,
       actor_json = EXCLUDED.actor_json,
       last_attempt_at = NOW(),
       updated_at = NOW(),
       sent_at = NULL
     RETURNING *`,
    [
      taskId,
      KOMMO_TASK_SYNC_EVENT,
      idempotencyKey,
      status,
      nextRetryCount,
      delay,
      httpStatus,
      String(error || '').slice(0, 1000),
      JSON.stringify(payload || {}),
      JSON.stringify(actor || null),
    ]
  );
  return result.rows[0] || null;
}

async function markKommoTaskSyncSuccess(pool, taskId) {
  await ensureKommoTaskSyncQueue(pool);
  const result = await pool.query(
    `INSERT INTO task_kommo_sync_queue (
       task_id, event, idempotency_key, status, retry_count, next_retry_at, last_error, last_attempt_at, sent_at, updated_at
     )
     VALUES ($1, $2, $3, 'sent', 0, NULL, NULL, NOW(), NOW(), NOW())
     ON CONFLICT (task_id, event)
     DO UPDATE SET
       idempotency_key = EXCLUDED.idempotency_key,
       status = 'sent',
       retry_count = 0,
       next_retry_at = NULL,
       last_http_status = NULL,
       last_error = NULL,
       last_attempt_at = NOW(),
       sent_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [taskId, KOMMO_TASK_SYNC_EVENT, kommoTaskSyncIdempotencyKey(taskId)]
  );
  return result.rows[0] || null;
}

async function getKommoTaskSyncQueueRow(pool, taskId) {
  await ensureKommoTaskSyncQueue(pool);
  const result = await pool.query(
    `SELECT * FROM task_kommo_sync_queue WHERE task_id = $1 AND event = $2`,
    [taskId, KOMMO_TASK_SYNC_EVENT]
  );
  return result.rows[0] || null;
}

function toCompactText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function dateToYmd(dateLike) {
  if (dateLike == null) return null;
  if (dateLike instanceof Date && !Number.isNaN(dateLike.getTime())) {
    return dateLike.toISOString().slice(0, 10);
  }
  const s = String(dateLike).trim();
  if (!s) return null;
  return s.slice(0, 10);
}

function toIsoDateStart(dateLike) {
  const d = dateToYmd(dateLike);
  if (!d) return null;
  const v = `${d}T00:00:00.000Z`;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function customField(fieldId, value) {
  if (!fieldId || value === null || value === undefined || value === '') return null;
  return {
    field_id: fieldId,
    values: [{ value }],
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function publicTaskUrl(rowOrTaskId) {
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  const token = typeof rowOrTaskId === 'object' ? rowOrTaskId?.link_statusowy_token : null;
  if (token) return `${base}/track/${token}`;
  const taskId = typeof rowOrTaskId === 'object' ? rowOrTaskId?.id : rowOrTaskId;
  return taskId ? `${base}/#/zlecenia/${taskId}` : null;
}

function absolutePublicUrl(value) {
  const url = toCompactText(value);
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base && url.startsWith('/') ? `${base}${url}` : url;
}

function buildKommoTaskPayload(row, actor = null) {
  const client = toCompactText(row.klient_nazwa);
  const leadName = ['Zlecenie', `#${row.id}`, client].filter(Boolean).join(' · ');
  const addr = [toCompactText(row.adres), toCompactText(row.miasto)].filter(Boolean).join(', ');
  const settlementRevenue = money(row.wartosc_netto_do_rozliczenia ?? row.rozliczenie_wartosc_netto ?? row.wartosc_planowana);
  const helperCost = money(row.rozliczenie_koszt_pomocnikow);
  const crewLeadCost = money(row.rozliczenie_wynagrodzenie_brygadzisty);
  const materialRows = parseJsonArray(row.materialy_zuzyte);
  const workLogRows = parseJsonArray(row.work_logs);
  const photoRows = parseJsonArray(row.photos);
  const documentRows = parseJsonArray(row.documents);
  const photoCountsByType = parseJsonObject(row.photo_counts_by_type);
  const margin = calculateTaskMargin({
    revenue_net: settlementRevenue,
    helper_cost: helperCost,
    crew_lead_pay: crewLeadCost,
    equipment_cost: row.koszt_sprzetu,
    fuel_cost: row.koszt_paliwa,
    material_cost: row.koszt_materialow,
    disposal_cost: row.koszt_utylizacji,
    other_cost: row.koszt_inne,
    marza_pct: row.marza_pct,
  });
  const customFields = [
    customField(KOMMO_CF_ORDER_ID, row.id),
    customField(KOMMO_CF_BRANCH_ID, row.oddzial_id ?? null),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.status)),
    customField(KOMMO_CF_LOAD_DATE_ID, toIsoDateStart(row.data_planowana)),
    customField(KOMMO_CF_PHONE_ID, toCompactText(row.klient_telefon)),
    customField(KOMMO_CF_GOODS_SUMMARY_ID, toCompactText(row.typ_uslugi)),
  ].filter(Boolean);
  const tags = KOMMO_CRM_TAGS.map((name) => ({ name }));
  return {
    source: 'arbor-os',
    event: 'task.sync',
    idempotency_key: kommoTaskSyncIdempotencyKey(row.id),
    sent_at: new Date().toISOString(),
    integration: { provider: 'kommo', version: '1' },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName || `Zlecenie ${row.id}`,
        external_id: `task:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    task: {
      id: row.id,
      status: row.status,
      typ_uslugi: toCompactText(row.typ_uslugi),
      priorytet: toCompactText(row.priorytet),
      klient_nazwa: client,
      klient_telefon: toCompactText(row.klient_telefon),
      klient_email: toCompactText(row.klient_email),
      adres: addr || null,
      oddzial_id: row.oddzial_id ?? null,
      data_planowana: dateToYmd(row.data_planowana),
      status_url: publicTaskUrl(row),
      wartosc_planowana: row.wartosc_planowana != null ? Number(row.wartosc_planowana) : null,
      wartosc_netto_do_rozliczenia: row.wartosc_netto_do_rozliczenia != null
        ? Number(row.wartosc_netto_do_rozliczenia)
        : null,
      marza_pct: margin.margin_pct,
      financials: {
        revenue_net: margin.revenue_net,
        direct_labor_cost: margin.costs.direct_labor_cost,
        helper_cost: helperCost,
        crew_lead_pay: crewLeadCost,
        equipment_cost: margin.costs.equipment_cost,
        fuel_cost: margin.costs.fuel_cost,
        material_cost: margin.costs.material_cost,
        disposal_cost: margin.costs.disposal_cost,
        other_cost: margin.costs.other_cost,
        total_known_cost: margin.total_known_cost,
        gross_margin: margin.gross_margin,
        margin_pct: margin.margin_pct,
      },
      settlement: {
        gross: money(row.rozliczenie_wartosc_brutto),
        vat_rate: row.rozliczenie_vat_stawka != null ? Number(row.rozliczenie_vat_stawka) : null,
        net: money(row.rozliczenie_wartosc_netto),
        helper_cost: helperCost,
        crew_lead_base: money(row.rozliczenie_podstawa_brygadzisty),
        crew_lead_pct: row.rozliczenie_procent_brygadzisty != null ? Number(row.rozliczenie_procent_brygadzisty) : null,
        crew_lead_pay: crewLeadCost,
      },
      material_usage: {
        count: Number(row.materialy_zuzyte_count || materialRows.length || 0),
        items: materialRows.map((item) => ({
          nazwa: toCompactText(item?.nazwa),
          ilosc: item?.ilosc != null ? Number(item.ilosc) : null,
          jednostka: toCompactText(item?.jednostka),
          koszt_jednostkowy: money(item?.koszt_jednostkowy, null),
          koszt_laczny: money(item?.koszt_laczny, null),
          notatka: toCompactText(item?.notatka),
        })),
      },
      work_time: {
        logs_count: Number(row.work_logs_count || workLogRows.length || 0),
        total_minutes: Number(row.work_total_minutes || 0),
        started_at: row.work_started_at || null,
        finished_at: row.work_finished_at || null,
        logs: workLogRows.map((log) => ({
          id: log?.id ?? null,
          user_id: log?.user_id ?? null,
          start_time: log?.start_time || null,
          end_time: log?.end_time || null,
          minutes: log?.minutes != null ? Number(log.minutes) : null,
          start_gps: log?.start_lat != null && log?.start_lng != null ? { lat: Number(log.start_lat), lng: Number(log.start_lng) } : null,
          end_gps: log?.end_lat != null && log?.end_lng != null ? { lat: Number(log.end_lat), lng: Number(log.end_lng) } : null,
        })),
      },
      photos: {
        count: Number(row.photos_count || photoRows.length || 0),
        by_type: photoCountsByType,
        items: photoRows.map((photo) => ({
          id: photo?.id ?? null,
          typ: toCompactText(photo?.typ),
          url: absolutePublicUrl(photo?.url || photo?.sciezka),
          opis: toCompactText(photo?.opis),
          data_dodania: photo?.data_dodania || null,
        })),
      },
      documents: {
        count: Number(row.documents_count || documentRows.length || 0),
        items: documentRows.map((doc) => ({
          id: doc?.id ?? null,
          nazwa: toCompactText(doc?.nazwa),
          kategoria: toCompactText(doc?.kategoria),
          url: absolutePublicUrl(doc?.sciezka),
          remote_url: absolutePublicUrl(doc?.remote_url),
          source_provider: toCompactText(doc?.source_provider),
        })),
      },
      notatki_wewnetrzne: toCompactText(row.notatki_wewnetrzne),
      sync_meta: {
        idempotency_key: kommoTaskSyncIdempotencyKey(row.id),
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

function buildKommoKlientPayload(row, actor = null) {
  const namePerson = [toCompactText(row.imie), toCompactText(row.nazwisko)].filter(Boolean).join(' ');
  const leadName = row.firma
    ? `${toCompactText(row.firma)} · ${namePerson || 'Klient'}`
    : namePerson || `Klient #${row.id}`;
  const customFields = [
    customField(KOMMO_CF_KLIENT_RECORD_ID, row.id),
    customField(KOMMO_CF_PHONE_ID, toCompactText(row.telefon)),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.zrodlo)),
  ].filter(Boolean);
  const tags = KOMMO_CRM_TAGS.map((name) => ({ name }));
  const addr = [toCompactText(row.adres), toCompactText(row.miasto)].filter(Boolean).join(', ');
  return {
    source: 'arbor-os',
    event: 'klient.sync',
    sent_at: new Date().toISOString(),
    integration: { provider: 'kommo', version: '1' },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName,
        external_id: `klient:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    klient: {
      id: row.id,
      imie: toCompactText(row.imie),
      nazwisko: toCompactText(row.nazwisko),
      firma: toCompactText(row.firma),
      telefon: toCompactText(row.telefon),
      email: toCompactText(row.email),
      adres: addr || null,
      zrodlo: toCompactText(row.zrodlo),
      notatki: toCompactText(row.notatki),
      sync_meta: {
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

function buildKommoPhoneCallPayload({
  callSid,
  clientNumber = null,
  transcript = null,
  raport = null,
  wskazowki = null,
  status = null,
  crmMessage = null,
  recordingUrl = null,
  recordingArchiveUrl = null,
}) {
  const noteText = toCompactText(crmMessage?.body)
    || [
      'Rozmowa telefoniczna ARBOR',
      raport ? `Raport: ${raport}` : null,
      transcript ? `Transkrypcja: ${String(transcript).slice(0, 4000)}` : null,
      wskazowki ? `Wskazowki: ${wskazowki}` : null,
    ].filter(Boolean).join('\n\n');
  const leadId = crmMessage?.lead_id ?? crmMessage?.leadId ?? null;
  const crmMessageId = crmMessage?.id ?? null;
  const idempotencyKey = kommoPhoneCallIdempotencyKey(callSid);

  return {
    source: 'arbor-os',
    event: KOMMO_PHONE_CALL_EVENT,
    idempotency_key: idempotencyKey,
    sent_at: new Date().toISOString(),
    integration: { provider: 'kommo', version: '1' },
    kommo: {
      note: {
        entity_type: 'lead',
        note_type: 'common',
        external_id: idempotencyKey,
        match: {
          phone: toCompactText(clientNumber),
          arbor_lead_id: leadId,
        },
        text: noteText || null,
      },
    },
    phone_call: {
      call_sid: callSid,
      provider: String(callSid || '').startsWith('zadarma:') ? 'zadarma' : 'twilio',
      client_number: toCompactText(clientNumber),
      transcript: toCompactText(transcript),
      raport: toCompactText(raport),
      wskazowki_specjalisty: toCompactText(wskazowki),
      status: toCompactText(status),
      recording_url: toCompactText(recordingUrl),
      recording_archive_url: toCompactText(recordingArchiveUrl),
      crm_message_id: crmMessageId,
      crm_lead_id: leadId,
    },
  };
}

function resolveKommoWebhookUrl(kind) {
  if (kind === 'crm' && KOMMO_CRM_WEBHOOK_URL) return KOMMO_CRM_WEBHOOK_URL;
  return KOMMO_WEBHOOK_URL;
}

function kommoWebhookConfigured(kind) {
  return Boolean(resolveKommoWebhookUrl(kind));
}

/**
 * Post webhook with exponential-backoff retry (3 attempts, 500 ms → 1 s → 2 s).
 * Throws on final failure so callers can handle / log without crashing the request.
 */
async function postKommoWebhook(payload, kind = 'crm', { retries = 3 } = {}) {
  const url = resolveKommoWebhookUrl(kind);
  const headers = { 'content-type': 'application/json' };
  const idempotencyKey = kommoPayloadIdempotencyKey(payload);
  if (idempotencyKey) {
    headers['idempotency-key'] = idempotencyKey;
    headers['x-idempotency-key'] = idempotencyKey;
  }
  if (KOMMO_WEBHOOK_SECRET_HEADER && KOMMO_WEBHOOK_SECRET) {
    headers[KOMMO_WEBHOOK_SECRET_HEADER] = KOMMO_WEBHOOK_SECRET;
  }
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(8000), // 8 s per attempt
      });
      const bodyText = await response.text();
      return { response, bodyText, attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

/**
 * Fire-and-forget wrapper — posts webhook, writes sync status back to tasks table.
 * Never throws; logs failures silently.
 */
async function syncTaskToKommo(pool, taskRow, actor = null) {
  if (!kommoWebhookConfigured('crm')) return;
  const payload = buildKommoTaskPayload(taskRow, actor);
  try {
    await postKommoWebhook(payload, 'crm');
    await pool.query(
      `UPDATE tasks SET kommo_last_sync_at = NOW(), kommo_last_sync_status = 'ok' WHERE id = $1`,
      [taskRow.id]
    );
    await markKommoTaskSyncSuccess(pool, taskRow.id).catch(() => {});
  } catch {
    await pool.query(
      `UPDATE tasks SET kommo_last_sync_at = NOW(), kommo_last_sync_status = 'error' WHERE id = $1`,
      [taskRow.id]
    ).catch(() => {});
    await recordKommoTaskSyncFailure(pool, {
      taskId: taskRow.id,
      payload,
      actor,
      error: 'background sync failed',
    }).catch(() => {});
  }
}

async function syncPhoneCallToKommo(args) {
  if (!kommoWebhookConfigured('crm')) return null;
  const payload = buildKommoPhoneCallPayload(args);
  return postKommoWebhook(payload, 'crm');
}

module.exports = {
  buildKommoTaskPayload,
  buildKommoKlientPayload,
  buildKommoPhoneCallPayload,
  postKommoWebhook,
  syncTaskToKommo,
  syncPhoneCallToKommo,
  kommoWebhookConfigured,
  ensureKommoTaskSyncQueue,
  getKommoTaskSyncQueueRow,
  markKommoTaskSyncSuccess,
  recordKommoTaskSyncFailure,
  kommoTaskSyncIdempotencyKey,
  kommoPhoneCallIdempotencyKey,
};
