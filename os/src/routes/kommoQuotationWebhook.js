/**
 * F1.1 — webhook z Kommo (status „Do wyceny”): utworzenie rekordu quotations do przypisania.
 * Zabezpieczenie: nagłówek X-Arbor-Webhook-Secret lub body.secret === KOMMO_QUOTATION_WEBHOOK_SECRET
 */
const crypto = require('crypto');
const dns = require('dns');
const express = require('express');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const pool = require('../config/database');
const logger = require('../config/logger');
const { geocodeAddressPoland } = require('../services/geocodeNominatim');
const {
  cleanupTemporaryUpload,
  persistUploadedFile,
  uploadStorageMode,
} = require('../services/upload-storage');
const { getUploadsRoot } = require('../config/uploadPaths');
const { distanceMeters } = require('../utils/geo');
const { DEFAULT_KOMMO_MAPPING, mergeWithDefaults } = require('./kommoConfig');

const router = express.Router();

// Porównanie w stałym czasie — odporne na timing attacks.
// Wymaga równej długości buforów; przy różnej długości zwracamy false po wcześniejszym sprawdzeniu.
function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function checkSecret(req) {
  const expected = (process.env.KOMMO_QUOTATION_WEBHOOK_SECRET || '').trim();
  // FAIL-CLOSED: brak skonfigurowanego sekretu = odrzucamy. Inaczej publiczny INSERT.
  if (!expected) {
    logger.warn('kommoQuotationWebhook: KOMMO_QUOTATION_WEBHOOK_SECRET is not set — rejecting request');
    return false;
  }
  const h = (req.get('x-arbor-webhook-secret') || '').trim();
  const b = String((req.body && req.body.secret) || '').trim();
  return timingSafeEq(h, expected) || timingSafeEq(b, expected);
}

async function ensureTaskInboundTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_kommo_inbound_events (
      id SERIAL PRIMARY KEY,
      event_key VARCHAR(160) NOT NULL UNIQUE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'received',
      incoming_status VARCHAR(64),
      applied_status VARCHAR(64),
      conflict_reason TEXT,
      payload_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_task_kommo_inbound_events_task_created
      ON task_kommo_inbound_events (task_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_task_kommo_inbound_events_status_created
      ON task_kommo_inbound_events (status, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_documents (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      nazwa VARCHAR(240) NOT NULL,
      sciezka TEXT NOT NULL,
      mime_type VARCHAR(120),
      rozmiar_bytes INTEGER,
      kategoria VARCHAR(80) NOT NULL DEFAULT 'inne',
      status VARCHAR(40) NOT NULL DEFAULT 'roboczy',
      opis TEXT,
      wersja INTEGER NOT NULL DEFAULT 1,
      source_provider VARCHAR(40),
      source_external_id VARCHAR(160),
      remote_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source_provider, source_external_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_task_documents_task ON task_documents (task_id, created_at DESC)');
}

function stableEventKey(payload) {
  const explicit = payload.event_id || payload.kommo_event_id || payload.id || payload.uuid || payload.request_id;
  if (explicit) return String(explicit).trim().slice(0, 160);
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function parseTaskId(payload) {
  const direct = payload.task_id ?? payload.task?.id ?? payload.arbor_task_id;
  if (direct != null && direct !== '') {
    const n = Number(direct);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  const candidates = [
    payload.external_id,
    payload.task?.external_id,
    payload.kommo?.lead?.external_id,
    payload.lead?.external_id,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const match = String(candidate).match(/task:(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function normalizeTaskStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const plain = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_');
  const map = new Map([
    ['nowe', 'Nowe'],
    ['lead', 'Nowe'],
    ['wycena_terenowa', 'Wycena_Terenowa'],
    ['ogledziny', 'Wycena_Terenowa'],
    ['do_zatwierdzenia', 'Do_Zatwierdzenia'],
    ['do_realizacji', 'Do_Zatwierdzenia'],
    ['zaplanowane', 'Zaplanowane'],
    ['plan_ekipy', 'Zaplanowane'],
    ['w_realizacji', 'W_Realizacji'],
    ['realizacja', 'W_Realizacji'],
    ['zakonczone', 'Zakonczone'],
    ['wygrane', 'Zakonczone'],
    ['anulowane', 'Anulowane'],
    ['przegrane', 'Anulowane'],
  ]);
  return map.get(plain) || null;
}

function parseKommoStatusMap() {
  try {
    const parsed = JSON.parse(process.env.KOMMO_STATUS_MAP_JSON || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function kommoAccountKey(payload = {}) {
  return firstText(
    payload.account_key,
    payload.kommo_account_key,
    payload.account_id,
    payload.kommo_account_id,
    payload.account?.id,
    payload.kommo?.account?.id,
    payload.kommo?.account_id,
    'default'
  );
}

async function loadKommoMappingConfig(payload = {}) {
  const accountKey = kommoAccountKey(payload) || 'default';
  try {
    const result = await pool.query(
      `SELECT account_key, status_map, field_aliases, options
         FROM kommo_account_mappings
        WHERE account_key = $1 OR account_key = 'default'
        ORDER BY CASE WHEN account_key = $1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [accountKey]
    );
    return mergeWithDefaults(result.rows[0] || { account_key: accountKey });
  } catch (error) {
    logger.warn('kommo.mapping_config fallback', { accountKey, message: error.message });
    return mergeWithDefaults({ account_key: accountKey });
  }
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function firstText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeKommoAttachment(item) {
  const url = firstText(item?.url, item?.link, item?.download_url, item?.href, typeof item === 'string' ? item : null);
  const name = firstText(item?.name, item?.filename, item?.file_name, url ? String(url).split('/').pop() : null, 'Kommo zalacznik');
  const externalId = firstText(item?.id, item?.uuid, item?.external_id)
    || (url ? crypto.createHash('sha256').update(url).digest('hex').slice(0, 40) : null);
  if (!url && !name) return null;
  return {
    url,
    name: String(name).slice(0, 240),
    mime_type: firstText(item?.mime_type, item?.content_type, item?.type),
    size: firstNumber(item?.size, item?.bytes, item?.file_size),
    external_id: externalId ? String(externalId).slice(0, 160) : null,
  };
}

function collectKommoAttachments(payload, task, lead) {
  return [
    ...(Array.isArray(payload.attachments) ? payload.attachments : []),
    ...(Array.isArray(payload.files) ? payload.files : []),
    ...(Array.isArray(task.attachments) ? task.attachments : []),
    ...(Array.isArray(task.files) ? task.files : []),
    ...(Array.isArray(lead.attachments) ? lead.attachments : []),
    ...(Array.isArray(lead.files) ? lead.files : []),
  ].map(normalizeKommoAttachment).filter(Boolean);
}

function safeAttachmentName(value, fallback = 'kommo-attachment.bin') {
  const raw = String(value || fallback).trim().replace(/\\/g, '/').split('/').pop() || fallback;
  return raw
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || fallback;
}

function kommoAttachmentMaxBytes() {
  const value = Number(process.env.KOMMO_ATTACHMENT_MAX_BYTES || 10 * 1024 * 1024);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 10 * 1024 * 1024;
}

function assertDownloadableAttachmentUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Kommo attachment URL must use http/https.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local')
  ) {
    throw new Error('Kommo attachment URL points to a local host.');
  }
  return parsed;
}

function ipv4ToNumber(address) {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

function isBlockedPrivateIp(address) {
  const ipType = net.isIP(address);
  if (!ipType) return false;

  if (ipType === 4) {
    const n = ipv4ToNumber(address);
    if (n == null) return true;
    const inRange = (base, bits) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToNumber(base) & mask);
    };
    return (
      inRange('0.0.0.0', 8) ||
      inRange('10.0.0.0', 8) ||
      inRange('100.64.0.0', 10) ||
      inRange('127.0.0.0', 8) ||
      inRange('169.254.0.0', 16) ||
      inRange('172.16.0.0', 12) ||
      inRange('192.168.0.0', 16) ||
      inRange('224.0.0.0', 4) ||
      inRange('240.0.0.0', 4)
    );
  }

  const normalized = String(address || '').toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

async function assertDownloadableAttachmentNetwork(parsed) {
  const hostname = parsed.hostname;
  if (isBlockedPrivateIp(hostname)) {
    throw new Error('Kommo attachment URL resolves to a private or reserved IP.');
  }

  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error('Kommo attachment URL hostname did not resolve.');
  }
  const blocked = addresses.find((entry) => isBlockedPrivateIp(entry.address));
  if (blocked) {
    throw new Error('Kommo attachment URL resolves to a private or reserved IP.');
  }
}

async function fetchKommoAttachmentUrl(startUrl, { maxRedirects = 3, timeoutMs = 10000 } = {}) {
  let current = assertDownloadableAttachmentUrl(startUrl);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertDownloadableAttachmentNetwork(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current.toString(), {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.('location');
      if (!location) throw new Error('Kommo attachment redirect is missing Location header.');
      if (redirect === maxRedirects) throw new Error('Kommo attachment has too many redirects.');
      current = assertDownloadableAttachmentUrl(new URL(location, current).toString());
      continue;
    }

    return { response, finalUrl: current };
  }
  throw new Error('Kommo attachment has too many redirects.');
}

async function downloadKommoAttachmentToStorage(taskId, attachment) {
  if (!attachment?.url) return null;
  const { response, finalUrl: parsed } = await fetchKommoAttachmentUrl(attachment.url);
  const maxBytes = kommoAttachmentMaxBytes();
  if (!response.ok) {
    throw new Error(`Kommo attachment download failed: HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Kommo attachment is too large: ${contentLength} bytes.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`Kommo attachment is too large: ${buffer.length} bytes.`);
  }

  const fileName = safeAttachmentName(attachment.name || decodeURIComponent(path.basename(parsed.pathname || '')));
  const folder = `kommo/task-${taskId}`;
  const mimetype = response.headers?.get?.('content-type') || attachment.mime_type || 'application/octet-stream';
  let filePath;
  let tmpDir;
  let stored;

  if (uploadStorageMode() === 'local') {
    const dir = path.join(getUploadsRoot(), folder);
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, fileName);
  } else {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arbor-kommo-'));
    filePath = path.join(tmpDir, fileName);
  }

  try {
    fs.writeFileSync(filePath, buffer);
    stored = await persistUploadedFile(
      {
        path: filePath,
        filename: fileName,
        originalname: attachment.name || fileName,
        mimetype,
        size: buffer.length,
      },
      { folder, fileName }
    );
    cleanupTemporaryUpload(stored);
    return {
      url: stored.url,
      mime_type: mimetype,
      size: buffer.length,
      storage_backend: stored.backend,
      storage_key: stored.key || null,
    };
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

function collectCustomFields(payload) {
  const fields = {};
  const sources = [
    payload.custom_fields,
    payload.custom_fields_values,
    payload.task?.custom_fields,
    payload.task?.custom_fields_values,
    payload.lead?.custom_fields,
    payload.lead?.custom_fields_values,
    payload.kommo?.lead?.custom_fields,
    payload.kommo?.lead?.custom_fields_values,
  ].filter(Boolean);
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const field of source) {
        const key = normalizeKey(field.field_name || field.name || field.code || field.field_code || field.field_id);
        if (!key) continue;
        const values = Array.isArray(field.values) ? field.values : [];
        const value = firstText(
          field.value,
          values[0]?.value,
          values[0]?.enum,
          values[0]?.enum_code,
          values[0]?.text
        );
        if (value != null) fields[key] = value;
      }
    } else if (typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        fields[normalizeKey(key)] = Array.isArray(value) ? firstText(value[0]) : value;
      }
    }
  }
  return fields;
}

function fieldValue(fields, names) {
  for (const name of names) {
    const key = normalizeKey(name);
    if (fields[key] != null && fields[key] !== '') return fields[key];
  }
  return null;
}

function statusFromKommoId(payload, mapping = DEFAULT_KOMMO_MAPPING) {
  const statusId = firstText(
    payload.status_id,
    payload.kommo_status_id,
    payload.lead?.status_id,
    payload.kommo?.lead?.status_id
  );
  if (!statusId) return null;
  return normalizeTaskStatus(mapping.status_map?.[statusId] || parseKommoStatusMap()[statusId]);
}

function statusFromPayload(payload, mapping = DEFAULT_KOMMO_MAPPING) {
  return statusFromKommoId(payload, mapping) || normalizeTaskStatus(
    payload.status
      ?? payload.arbor_status
      ?? payload.task?.status
      ?? payload.kommo_status_name
      ?? payload.lead?.status_name
      ?? payload.kommo?.lead?.status_name
  );
}

function aliases(mapping, key, fallback = []) {
  const configured = mapping?.field_aliases?.[key];
  return Array.isArray(configured) && configured.length ? configured : fallback;
}

function extractKommoTaskPatch(payload, mapping = DEFAULT_KOMMO_MAPPING) {
  const fields = collectCustomFields(payload);
  const lead = payload.lead || payload.kommo?.lead || {};
  const task = payload.task || {};
  const contact = payload.contact || payload.kommo?.contact || lead.contact || {};
  const address = firstText(
    payload.adres,
    payload.address,
    task.adres,
    task.address,
    lead.adres,
    lead.address,
    fieldValue(fields, aliases(mapping, 'adres', ['adres', 'address', 'adres realizacji', 'adres uslugi']))
  );
  const city = firstText(
    payload.miasto,
    payload.city,
    task.miasto,
    task.city,
    lead.miasto,
    lead.city,
    fieldValue(fields, aliases(mapping, 'miasto', ['miasto', 'city']))
  );
  const lat = firstNumber(payload.lat, payload.latitude, task.lat, task.pin_lat, fieldValue(fields, aliases(mapping, 'pin_lat', ['lat', 'latitude'])));
  const lng = firstNumber(
    payload.lng,
    payload.lon,
    payload.longitude,
    task.lng,
    task.pin_lng,
    fieldValue(fields, aliases(mapping, 'pin_lng', ['lng', 'lon', 'longitude']))
  );
  const attachments = collectKommoAttachments(payload, task, lead);
  const kommoLeadId = firstText(payload.kommo_lead_id, payload.lead_id, lead.id, payload.external_id, lead.external_id);
  const notes = [
    firstText(payload.notatki, payload.notes, task.notatki, lead.notes, fieldValue(fields, aliases(mapping, 'notatki_wewnetrzne', ['notatki', 'notes', 'opis']))),
    attachments.length ? `Kommo zalaczniki:\n${attachments.map((x) => `- ${[x.name, x.url].filter(Boolean).join(' | ')}`).join('\n')}` : null,
    kommoLeadId ? `Kommo lead: ${kommoLeadId}` : null,
  ].filter(Boolean).join('\n\n') || null;

  return {
    klient_nazwa: firstText(
      payload.klient_nazwa,
      payload.name,
      task.klient_nazwa,
      lead.klient_nazwa,
      lead.name,
      contact.name,
      fieldValue(fields, aliases(mapping, 'klient_nazwa', ['klient', 'klient nazwa', 'nazwa klienta', 'name']))
    ),
    klient_telefon: firstText(
      payload.telefon,
      payload.phone,
      task.klient_telefon,
      lead.phone,
      contact.phone,
      fieldValue(fields, aliases(mapping, 'klient_telefon', ['telefon', 'phone']))
    ),
    klient_email: firstText(
      payload.email,
      task.klient_email,
      lead.email,
      contact.email,
      fieldValue(fields, aliases(mapping, 'klient_email', ['email', 'e-mail']))
    ),
    adres: address,
    miasto: city,
    typ_uslugi: firstText(
      payload.typ_uslugi,
      payload.service_type,
      task.typ_uslugi,
      lead.service_type,
      fieldValue(fields, aliases(mapping, 'typ_uslugi', ['typ uslugi', 'zakres', 'zakres prac', 'service']))
    ),
    opis: firstText(payload.opis, task.opis, lead.description, fieldValue(fields, aliases(mapping, 'opis', ['opis prac', 'description']))),
    wartosc_planowana: firstNumber(
      payload.wartosc_planowana,
      payload.value,
      task.wartosc_planowana,
      lead.price,
      lead.value,
      fieldValue(fields, aliases(mapping, 'wartosc_planowana', ['wartosc', 'budzet', 'price', 'value']))
    ),
    priorytet: firstText(payload.priorytet, task.priorytet, fieldValue(fields, aliases(mapping, 'priorytet', ['priorytet', 'priority']))),
    data_planowana: firstText(payload.data_planowana, payload.planned_at, task.data_planowana, fieldValue(fields, aliases(mapping, 'data_planowana', ['data planowana', 'termin']))),
    oddzial_id: firstNumber(payload.oddzial_id, task.oddzial_id, fieldValue(fields, aliases(mapping, 'oddzial_id', ['oddzial id', 'branch id']))),
    ekipa_id: firstNumber(payload.ekipa_id, task.ekipa_id, fieldValue(fields, aliases(mapping, 'ekipa_id', ['ekipa id', 'team id']))),
    pin_lat: lat,
    pin_lng: lng,
    notatki_wewnetrzne: notes,
    attachments,
  };
}

async function persistKommoTaskAttachments(taskId, attachments = [], options = {}) {
  const saved = [];
  for (const attachment of attachments) {
    if (!attachment.url) continue;
    let storedCopy = null;
    if (options.copy_attachment_binaries_to_storage) {
      try {
        storedCopy = await downloadKommoAttachmentToStorage(taskId, attachment);
      } catch (error) {
        logger.warn('kommo.task-sync attachment_copy', {
          taskId,
          url: attachment.url,
          message: error.message,
        });
      }
    }
    const sourceExternalId = attachment.external_id
      || crypto.createHash('sha256').update(attachment.url).digest('hex').slice(0, 40);
    const result = await pool.query(
      `INSERT INTO task_documents (
         task_id, nazwa, sciezka, mime_type, rozmiar_bytes, kategoria, status,
         opis, source_provider, source_external_id, remote_url
       ) VALUES ($1,$2,$3,$4,$5,'kommo','roboczy',$6,'kommo',$7,$8)
       ON CONFLICT (source_provider, source_external_id) DO UPDATE SET
         task_id = EXCLUDED.task_id,
         nazwa = EXCLUDED.nazwa,
         sciezka = EXCLUDED.sciezka,
         mime_type = EXCLUDED.mime_type,
         rozmiar_bytes = EXCLUDED.rozmiar_bytes,
         remote_url = EXCLUDED.remote_url,
         updated_at = NOW()
       RETURNING id, nazwa, sciezka, source_external_id`,
      [
        taskId,
        attachment.name || 'Kommo zalacznik',
        storedCopy?.url || attachment.url,
        storedCopy?.mime_type || attachment.mime_type || null,
        storedCopy?.size || attachment.size || null,
        storedCopy ? 'Import z Kommo; kopia w storage ARBOR' : 'Import z Kommo',
        sourceExternalId,
        attachment.url,
      ]
    );
    if (result.rows[0]) saved.push(result.rows[0]);
  }
  return saved;
}

function canApplyInboundStatus(current, next) {
  if (!next || current === next) return { ok: true };
  const closed = new Set(['Zakonczone', 'Anulowane']);
  if (closed.has(String(current || ''))) {
    return { ok: false, reason: `Zlecenie jest juz zamkniete (${current}); Kommo nie moze zmienic statusu na ${next}.` };
  }
  return { ok: true };
}

async function recordInboundEvent({ eventKey, taskId, status, incomingStatus = null, appliedStatus = null, conflictReason = null, payload }) {
  const result = await pool.query(
    `INSERT INTO task_kommo_inbound_events (
       event_key, task_id, status, incoming_status, applied_status, conflict_reason, payload_json, processed_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
     ON CONFLICT (event_key) DO NOTHING
     RETURNING *`,
    [
      eventKey,
      taskId,
      status,
      incomingStatus,
      appliedStatus,
      conflictReason,
      JSON.stringify(payload || {}),
    ]
  );
  return result.rows[0] || null;
}

async function pickOddzialId(pool, lat, lng, requestedId) {
  if (requestedId) {
    const r = await pool.query(`SELECT id FROM branches WHERE id = $1 AND COALESCE(aktywny, true)`, [requestedId]);
    if (r.rows[0]) return r.rows[0].id;
  }
  const { rows } = await pool.query(
    `SELECT id, lat, lng FROM branches WHERE COALESCE(aktywny, true) AND lat IS NOT NULL AND lng IS NOT NULL`
  );
  if (!rows.length) {
    const fb = await pool.query(`SELECT id FROM branches ORDER BY id LIMIT 1`);
    return fb.rows[0]?.id || 1;
  }
  if (lat == null || lng == null) return rows[0].id;
  let best = rows[0].id;
  let bestD = Infinity;
  for (const b of rows) {
    const d = distanceMeters(lat, lng, b.lat, b.lng);
    if (d != null && d < bestD) {
      bestD = d;
      best = b.id;
    }
  }
  return best;
}

router.post('/kommo/quotation-lead', express.json({ limit: '2mb' }), async (req, res) => {
  if (!checkSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const b = req.body || {};
  const klient_nazwa = String(b.klient_nazwa || b.name || b.title || '').trim() || null;
  const adres = String(b.adres || b.address || '').trim() || null;
  const miasto = String(b.miasto || b.city || '').trim() || null;
  const klient_telefon = String(b.telefon || b.phone || '').trim() || null;
  const klient_email = String(b.email || '').trim() || null;
  const kommo_sales_notes = String(b.opis || b.notes || '').trim() || null;
  const kommo_lead_external_id = String(b.kommo_lead_id || b.external_id || '').trim() || null;
  const wartosc_szacunkowa_lead = b.wartosc_szacunkowa != null ? Number(b.wartosc_szacunkowa) : null;
  const priorytet = String(b.priorytet || 'Normalny').trim() || 'Normalny';
  const oddzialReq = b.oddzial_id != null ? Number(b.oddzial_id) : null;

  let lat = b.lat != null ? Number(b.lat) : null;
  let lng = b.lng != null ? Number(b.lng) : null;
  let geocode_status = lat != null && lng != null ? 'provided' : 'pending';
  if (lat == null && adres) {
    const geo = await geocodeAddressPoland({ adres, miasto });
    if (geo.status === 'ok') {
      lat = geo.lat;
      lng = geo.lng;
      geocode_status = 'ok';
    } else {
      geocode_status = 'failed';
    }
  }

  try {
    const oddzial_id = await pickOddzialId(pool, lat, lng, oddzialReq);
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO quotations (
        crm_lead_id, kommo_lead_external_id, wyceniajacy_id, oddzial_id,
        klient_nazwa, klient_telefon, klient_email, adres, miasto, lat, lng,
        kommo_sales_notes, status, geocode_status, wartosc_szacunkowa_lead, priorytet,
        created_by, created_at, updated_at
      ) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OczekujePrzypisania',$12,$13,$14,NULL,$15,$15)
      RETURNING *`,
      [
        b.crm_lead_id ? Number(b.crm_lead_id) : null,
        kommo_lead_external_id,
        oddzial_id,
        klient_nazwa,
        klient_telefon,
        klient_email,
        adres,
        miasto,
        lat,
        lng,
        kommo_sales_notes,
        geocode_status,
        wartosc_szacunkowa_lead,
        priorytet,
        now,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('kommoQuotationWebhook', { message: e.message });
    res.status(500).json({ error: 'Nie udało się utworzyć wyceny z leada' });
  }
});

// ─── POST /api/webhooks/kommo/task-update ─────────────────────────────────────
// Inbound: Kommo → arbor-os  (bidirectional EPIC 8)
// Payload: { secret?, task_id, status?, ekipa_id?, data_planowana?, notatki? }
// This is called by a Kommo automation / Make.com scenario when a lead changes.

async function handleKommoTaskSync(req, res) {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
  await ensureTaskInboundTables();

  const payload = req.body || {};
  const taskId = parseTaskId(payload);
  const eventKey = stableEventKey(payload);
  const mappingConfig = await loadKommoMappingConfig(payload);
  const incomingStatus = statusFromPayload(payload, mappingConfig);
  const taskPatch = extractKommoTaskPatch(payload, mappingConfig);
  if (!taskId) return res.status(400).json({ error: 'Wymagane pole: task_id lub external_id task:<id>' });

  const duplicate = await pool.query('SELECT * FROM task_kommo_inbound_events WHERE event_key = $1', [eventKey]);
  if (duplicate.rows[0]) {
    return res.status(200).json({ ok: true, duplicate: true, event: duplicate.rows[0] });
  }

  try {
    const current = await pool.query('SELECT id, status, ekipa_id, oddzial_id FROM tasks WHERE id = $1', [taskId]);
    if (!current.rows.length) {
      const event = await recordInboundEvent({
        eventKey,
        taskId,
        status: 'error',
        incomingStatus,
        conflictReason: 'Zlecenie nie istnieje',
        payload,
      });
      return res.status(404).json({ error: 'Zlecenie nie istnieje', event });
    }

    const currentTask = current.rows[0];
    const statusDecision = canApplyInboundStatus(currentTask.status, incomingStatus);
    if (!statusDecision.ok) {
      const event = await recordInboundEvent({
        eventKey,
        taskId,
        status: 'conflict',
        incomingStatus,
        appliedStatus: currentTask.status,
        conflictReason: statusDecision.reason,
        payload,
      });
      await pool.query(
        `UPDATE tasks SET
           kommo_last_sync_at = NOW(),
           kommo_last_sync_status = 'conflict',
           kommo_last_sync_error = $1,
           updated_at = NOW()
         WHERE id = $2`,
        [statusDecision.reason, taskId]
      );
      return res.status(409).json({ ok: false, status: 'conflict', error: statusDecision.reason, event });
    }

    const sets = [
      'kommo_last_sync_at = NOW()',
      "kommo_last_sync_status = 'inbound_ok'",
      'kommo_last_sync_error = NULL',
    ];
    const params = [];
    if (incomingStatus) {
      params.push(incomingStatus);
      sets.push(`status = $${params.length}`);
    }
    const scalarColumns = [
      'klient_nazwa',
      'klient_telefon',
      'klient_email',
      'adres',
      'miasto',
      'typ_uslugi',
      'opis',
      'wartosc_planowana',
      'priorytet',
      'data_planowana',
      'ekipa_id',
      'pin_lat',
      'pin_lng',
    ];
    for (const column of scalarColumns) {
      const value = taskPatch[column];
      if (value == null || value === '') continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    let finalOddzialId = taskPatch.oddzial_id;
    if (!finalOddzialId && (taskPatch.pin_lat != null || taskPatch.adres)) {
      finalOddzialId = await pickOddzialId(pool, taskPatch.pin_lat, taskPatch.pin_lng, null).catch(() => null);
    }
    if (finalOddzialId) {
      params.push(finalOddzialId);
      sets.push(`oddzial_id = $${params.length}`);
    }
    if (taskPatch.notatki_wewnetrzne) {
      params.push(String(taskPatch.notatki_wewnetrzne).slice(0, 4000));
      sets.push(`notatki_wewnetrzne = CONCAT_WS(E'\\n\\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $${params.length})`);
    }
    if (mappingConfig.options?.auto_geocode !== false && (taskPatch.pin_lat == null || taskPatch.pin_lng == null) && taskPatch.adres) {
      const geo = await geocodeAddressPoland({ adres: taskPatch.adres, miasto: taskPatch.miasto }).catch(() => null);
      if (geo?.status === 'ok') {
        params.push(geo.lat);
        sets.push(`pin_lat = COALESCE(pin_lat, $${params.length})`);
        params.push(geo.lng);
        sets.push(`pin_lng = COALESCE(pin_lng, $${params.length})`);
      }
    }
    params.push(taskId);
    const r = await pool.query(
      `UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, status, ekipa_id, oddzial_id, data_planowana, kommo_last_sync_status`,
      params
    );

    const event = await recordInboundEvent({
      eventKey,
      taskId,
      status: 'applied',
      incomingStatus,
      appliedStatus: r.rows[0]?.status || currentTask.status,
      payload,
    });
    const attachments = mappingConfig.options?.save_remote_attachments_as_documents === false
      ? []
      : await persistKommoTaskAttachments(taskId, taskPatch.attachments, mappingConfig.options).catch((error) => {
        logger.warn('kommo.task-sync attachments', { taskId, message: error.message });
        return [];
      });
    logger.info('kommo.task-sync applied', { taskId, incomingStatus, ekipaId: taskPatch.ekipa_id });
    return res.json({ ok: true, status: 'applied', task: r.rows[0], event, attachments });
  } catch (e) {
    logger.error('kommo.task-sync error', { message: e.message });
    await recordInboundEvent({
      eventKey,
      taskId,
      status: 'error',
      incomingStatus,
      conflictReason: e.message,
      payload,
    }).catch(() => {});
    return res.status(500).json({ error: e.message });
  }
}

// Inbound: Kommo -> ARBOR task.sync. Stary task-update zostaje jako alias dla scenariuszy Make.com.
router.post('/kommo/task-sync', handleKommoTaskSync);
router.post('/kommo/task-update', handleKommoTaskSync);

module.exports = router;
