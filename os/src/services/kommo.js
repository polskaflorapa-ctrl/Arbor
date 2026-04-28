/**
 * Payload + webhook Kommo (CRM: zlecenie / klient; CMR osobno w web/server).
 * Zmienne środowiska jak w web/.env.example — bez wpisu w env.js (wszystko opcjonalne).
 */

const KOMMO_WEBHOOK_URL =
  (process.env.KOMMO_WEBHOOK_URL || process.env.KOMMO_CMR_WEBHOOK_URL || '').trim();
const KOMMO_CRM_WEBHOOK_URL = (process.env.KOMMO_CRM_WEBHOOK_URL || '').trim();
const KOMMO_WEBHOOK_SECRET_HEADER = (process.env.KOMMO_WEBHOOK_SECRET_HEADER || '').trim();
const KOMMO_WEBHOOK_SECRET = (process.env.KOMMO_WEBHOOK_SECRET || '').trim();

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
const KOMMO_TAGS = parseCsvStrings(process.env.KOMMO_TAGS || 'CMR,Arbor');
const KOMMO_CRM_TAGS = parseCsvStrings(process.env.KOMMO_CRM_TAGS || 'Arbor,CRM');
const KOMMO_CF_ORDER_ID = toNum(process.env.KOMMO_CF_ORDER_ID);
const KOMMO_CF_BRANCH_ID = toNum(process.env.KOMMO_CF_BRANCH_ID);
const KOMMO_CF_STATUS_ID = toNum(process.env.KOMMO_CF_STATUS_ID);
const KOMMO_CF_LOAD_DATE_ID = toNum(process.env.KOMMO_CF_LOAD_DATE_ID);
const KOMMO_CF_PHONE_ID = toNum(process.env.KOMMO_CF_PHONE_ID);
const KOMMO_CF_GOODS_SUMMARY_ID = toNum(process.env.KOMMO_CF_GOODS_SUMMARY_ID);
const KOMMO_CF_KLIENT_RECORD_ID = toNum(process.env.KOMMO_CF_KLIENT_RECORD_ID);

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

function buildKommoTaskPayload(row, actor = null) {
  const client = toCompactText(row.klient_nazwa);
  const leadName = ['Zlecenie', `#${row.id}`, client].filter(Boolean).join(' · ');
  const addr = [toCompactText(row.adres), toCompactText(row.miasto)].filter(Boolean).join(', ');
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
      wartosc_planowana: row.wartosc_planowana != null ? Number(row.wartosc_planowana) : null,
      notatki_wewnetrzne: toCompactText(row.notatki_wewnetrzne),
      sync_meta: {
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

function resolveKommoWebhookUrl(kind) {
  if (kind === 'crm' && KOMMO_CRM_WEBHOOK_URL) return KOMMO_CRM_WEBHOOK_URL;
  return KOMMO_WEBHOOK_URL;
}

function kommoWebhookConfigured(kind) {
  return Boolean(resolveKommoWebhookUrl(kind));
}

async function postKommoWebhook(payload, kind = 'crm') {
  const url = resolveKommoWebhookUrl(kind);
  const headers = { 'content-type': 'application/json' };
  if (KOMMO_WEBHOOK_SECRET_HEADER && KOMMO_WEBHOOK_SECRET) {
    headers[KOMMO_WEBHOOK_SECRET_HEADER] = KOMMO_WEBHOOK_SECRET;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  return { response, bodyText };
}

module.exports = {
  buildKommoTaskPayload,
  buildKommoKlientPayload,
  postKommoWebhook,
  kommoWebhookConfigured,
};
