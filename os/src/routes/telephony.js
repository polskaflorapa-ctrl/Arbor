const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { pushToUser } = require('./notifications');
const { appendCrmLeadMessage, appendCrmMessageForContact } = require('../services/crmInbox');
const { sendSmsGateway } = require('../services/smsGateway');
const { ensureIntegrationTestLogsTable, listIntegrationTestLogs, recordIntegrationTestLog } = require('../services/integrationTestLogs');
const {
  buildPolskaFloraLeadNotes,
  buildPolskaFloraVoiceAgentConfig,
  normalizePolskaFloraServiceType,
  SERVICE_LABELS,
} = require('../services/polskaFloraVoiceAgent');
const { getWebrtcKey, getZadarmaRuntimeConfig, zadarmaRequest } = require('../services/zadarma');
const { saveProviderSettings } = require('../services/provider-settings');

const router = express.Router();

const callsListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  status: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const callCreateSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
  phone: z.string().trim().min(3).max(64),
  call_type: z.enum(['inbound', 'outbound']).optional(),
  status: z.string().trim().min(2).max(40).optional(),
  duration_sec: z.coerce.number().int().min(0).optional(),
  task_id: z.coerce.number().int().positive().optional().nullable(),
  lead_name: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const callbacksListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  status: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const callbackCreateSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
  phone: z.string().trim().min(3).max(64),
  task_id: z.coerce.number().int().positive().optional().nullable(),
  lead_name: z.string().max(255).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  due_at: z.string().max(64).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  assigned_user_id: z.coerce.number().int().positive().optional().nullable(),
});

const callbackStatusParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const callbackStatusBodySchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']),
});

const voiceAgentConfigQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
});

const voiceAgentIntakeSchema = z.object({
  provider: z.string().max(40).optional(),
  external_id: z.string().max(120).optional().nullable(),
  call_sid: z.string().max(120).optional().nullable(),
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
  caller_phone: z.string().trim().min(3).max(64),
  customer_name: z.string().trim().max(255).optional().nullable(),
  inspection_address: z.string().trim().max(1000).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  service_type: z.string().trim().max(80).optional().nullable(),
  appointment_at: z.string().trim().max(80).optional().nullable(),
  source: z.enum(['telefon_przychodzacy', 'oddzwonienie']).optional(),
  notes: z.string().max(4000).optional().nullable(),
  transcript: z.string().max(12000).optional().nullable(),
});

const voiceAgentIntegrationQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
});

const integrationTestLogsQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const voiceAgentIntakesQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  filter: z.enum(['all', 'needs_review', 'sms_missing', 'sms_error', 'scheduled']).optional(),
  q: z.string().trim().max(200).optional(),
});

const voiceAgentIntakeParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const voiceAgentIntakeFixSchema = z.object({
  caller_phone: z.string().trim().min(3).max(64).optional().nullable(),
  customer_name: z.string().trim().max(255).optional().nullable(),
  inspection_address: z.string().trim().max(1000).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  service_type: z.string().trim().max(80).optional().nullable(),
  appointment_at: z.string().trim().max(80).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  transcript: z.string().max(12000).optional().nullable(),
  create_missing_inspection: z.boolean().optional(),
});

const voiceAgentIntakeSmsSchema = z.object({
  body: z.string().trim().min(1).max(480).optional().nullable(),
});

const voiceAgentIntegrationSaveSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
  provider: z.string().trim().max(40).optional(),
  provider_account_id: z.string().trim().max(120).optional().nullable(),
  provider_api_key: z.string().trim().max(500).optional().nullable(),
  status: z.enum(['active', 'paused']).optional(),
});

const voiceAgentRetestNotificationsSchema = z.object({
  max_age_days: z.coerce.number().int().min(1).max(90).optional(),
});

const zadarmaSettingsSaveSchema = z.object({
  api_key: z.string().trim().max(500).optional().nullable(),
  api_secret: z.string().trim().max(500).optional().nullable(),
  caller_id: z.string().trim().max(64).optional().nullable(),
});

const zadarmaWebrtcKeySchema = z.object({
  sip: z.string().trim().min(1, 'Podaj SIP login albo numer wewnetrzny PBX.').max(128),
});

const DEFAULT_RETEST_MAX_AGE_DAYS = 14;

const isManagementRole = (user) =>
  user?.rola === 'Dyrektor' || user?.rola === 'Administrator' || user?.rola === 'Kierownik';
const canManageGlobalProviderSettings = (user) =>
  ['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola);

function publicZadarmaSettings(config) {
  const base = env.PUBLIC_BASE_URL ? String(env.PUBLIC_BASE_URL).trim().replace(/\/$/, '') : '';
  return {
    configured: Boolean(config.apiKey && config.apiSecret),
    source: config.source || null,
    api_key_masked: config.apiKeyMasked || null,
    api_secret_masked: config.apiSecretMasked || null,
    caller_id: config.callerId || '',
    updated_at: config.updated_at || null,
    sms_webhook_url: base ? `${base}/api/sms/webhooks/zadarma` : null,
  };
}

router.get('/zadarma/settings', authMiddleware, async (req, res) => {
  try {
    if (!canManageGlobalProviderSettings(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    return res.json(publicZadarmaSettings(await getZadarmaRuntimeConfig()));
  } catch (err) {
    logger.error('telephony.zadarma.settings.get', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/zadarma/settings', authMiddleware, validateBody(zadarmaSettingsSaveSchema), async (req, res) => {
  try {
    if (!canManageGlobalProviderSettings(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const b = req.body || {};
    await saveProviderSettings('zadarma', {
      config: { caller_id: b.caller_id || '' },
      secrets: {
        api_key: b.api_key || '',
        api_secret: b.api_secret || '',
      },
      updatedBy: req.user.id,
    });
    return res.json(publicZadarmaSettings(await getZadarmaRuntimeConfig()));
  } catch (err) {
    logger.error('telephony.zadarma.settings.put', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/zadarma/test', authMiddleware, async (req, res) => {
  try {
    if (!canManageGlobalProviderSettings(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const info = await zadarmaRequest('GET', '/v1/info/balance/', {});
    return res.json({
      ok: true,
      provider: 'zadarma',
      message: 'Zadarma API dziala.',
      info,
      settings: publicZadarmaSettings(await getZadarmaRuntimeConfig()),
    });
  } catch (err) {
    logger.warn('telephony.zadarma.test', { message: err.message, requestId: req.requestId });
    const zadarmaMessage = String(err.message || '');
    const isAuthFailure = /not authorized|unauthori[sz]ed|forbidden|401|403/i.test(zadarmaMessage);
    return res.status(400).json({
      ok: false,
      provider: 'zadarma',
      code: isAuthFailure ? 'ZADARMA_AUTH_FAILED' : 'ZADARMA_TEST_FAILED',
      error: isAuthFailure
        ? 'Zadarma odrzucila klucze API. Sprawdz API key i API secret w panelu Zadarma, zapisz je ponownie i uruchom Test API.'
        : (zadarmaMessage || 'Test Zadarmy nie przeszedl.'),
      settings: publicZadarmaSettings(await getZadarmaRuntimeConfig().catch(() => ({}))),
    });
  }
});

router.post('/zadarma/webrtc-key', authMiddleware, validateBody(zadarmaWebrtcKeySchema), async (req, res) => {
  try {
    if (!canManageGlobalProviderSettings(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const sip = String(req.body?.sip || '').trim();
    const data = await getWebrtcKey({ sip });
    const key = data?.key || data?.webrtc_key || data?.result?.key;
    if (!key) {
      return res.status(502).json({
        ok: false,
        provider: 'zadarma',
        code: 'ZADARMA_WEBRTC_KEY_MISSING',
        error: 'Zadarma nie zwrocila klucza WebRTC. Sprawdz SIP/wewnetrzny numer PBX i integracje WebRTC w panelu Zadarma.',
      });
    }
    return res.json({
      ok: true,
      provider: 'zadarma',
      sip,
      key,
      expires_in_hours: 72,
    });
  } catch (err) {
    logger.warn('telephony.zadarma.webrtc_key', { message: err.message, requestId: req.requestId });
    const zadarmaMessage = String(err.message || '');
    const isAuthFailure = /not authorized|unauthori[sz]ed|forbidden|401|403/i.test(zadarmaMessage);
    return res.status(isAuthFailure ? 400 : 502).json({
      ok: false,
      provider: 'zadarma',
      code: isAuthFailure ? 'ZADARMA_AUTH_FAILED' : 'ZADARMA_WEBRTC_KEY_FAILED',
      error: isAuthFailure
        ? 'Zadarma odrzucila klucze API. Sprawdz API key i API secret, zapisz je ponownie i uruchom Test API.'
        : (zadarmaMessage || 'Nie udalo sie pobrac klucza WebRTC z Zadarmy.'),
    });
  }
});

const telephonyScope = (user, oddzialId) => {
  if (isManagementRole(user)) {
    if (oddzialId) {
      return { where: 'WHERE x.oddzial_id = $1', params: [oddzialId] };
    }
    return { where: '', params: [] };
  }
  return { where: 'WHERE x.oddzial_id = $1', params: [user?.oddzial_id || -1] };
};

const telephonyScopeSimple = (user, oddzialId, alias = 'c') => {
  if (isManagementRole(user)) {
    if (oddzialId) {
      return { where: `WHERE ${alias}.oddzial_id = $1`, params: [oddzialId] };
    }
    return { where: '', params: [] };
  }
  return { where: `WHERE ${alias}.oddzial_id = $1`, params: [user?.oddzial_id || -1] };
};

function callMessageBody(row) {
  const duration = Number(row.duration_sec || 0);
  const parts = [
    `Call ${row.call_type || 'outbound'}: ${row.status || 'answered'}`,
  ];
  if (duration > 0) parts.push(`${duration}s`);
  if (row.notes) parts.push(String(row.notes));
  return parts.join('\n');
}

function callMessageStatus(row) {
  if (row.status === 'missed' || row.status === 'failed') return 'failed';
  return row.call_type === 'inbound' ? 'received' : 'sent';
}

function callbackMessageBody(row) {
  const parts = [`Callback request (${row.priority || 'normal'})`];
  if (row.due_at) parts.push(`Due: ${row.due_at}`);
  if (row.notes) parts.push(String(row.notes));
  return parts.join('\n');
}

let migrationReady = false;
async function ensureTelephonyTables() {
  if (migrationReady) return;
  migrationReady = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telephony_call_logs (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      phone VARCHAR(64) NOT NULL,
      call_type VARCHAR(20) NOT NULL DEFAULT 'outbound',
      status VARCHAR(40) NOT NULL DEFAULT 'missed',
      duration_sec INTEGER NOT NULL DEFAULT 0,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      lead_name VARCHAR(255),
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_call_logs_oddzial_created ON telephony_call_logs(oddzial_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_call_logs_status ON telephony_call_logs(status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_call_logs_task ON telephony_call_logs(task_id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telephony_callbacks (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      phone VARCHAR(64) NOT NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      lead_name VARCHAR(255),
      priority VARCHAR(16) NOT NULL DEFAULT 'normal',
      due_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      notes TEXT,
      assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_callbacks_oddzial_status ON telephony_callbacks(oddzial_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_callbacks_due ON telephony_callbacks(due_at)');
}

async function ensureVoiceAgentIntakesTable() {
  await ensureVoiceAgentInspectionTables();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_agent_intakes (
      id SERIAL PRIMARY KEY,
      provider VARCHAR(40) NOT NULL DEFAULT 'external',
      agent_id VARCHAR(80) NOT NULL DEFAULT 'polska-flora-ania',
      external_id VARCHAR(120),
      call_sid VARCHAR(120),
      oddzial_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      crm_lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
      ogledziny_id INTEGER REFERENCES ogledziny(id) ON DELETE SET NULL,
      caller_phone VARCHAR(64),
      customer_name VARCHAR(255),
      inspection_address TEXT,
      city VARCHAR(120),
      service_type VARCHAR(80),
      appointment_at TIMESTAMPTZ,
      source VARCHAR(40) NOT NULL DEFAULT 'telefon_przychodzacy',
      notes TEXT,
      transcript TEXT,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_voice_agent_intakes_oddzial_created ON voice_agent_intakes(oddzial_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_voice_agent_intakes_external ON voice_agent_intakes(external_id)');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_agent_intakes_external
    ON voice_agent_intakes(agent_id, provider, external_id)
    WHERE external_id IS NOT NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_agent_intakes_call_sid
    ON voice_agent_intakes(agent_id, provider, call_sid)
    WHERE call_sid IS NOT NULL
  `);
  await pool.query('ALTER TABLE voice_agent_intakes ADD COLUMN IF NOT EXISTS ogledziny_id INTEGER REFERENCES ogledziny(id) ON DELETE SET NULL');
}

async function ensureVoiceAgentInspectionTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS klienci (
      id SERIAL PRIMARY KEY,
      imie VARCHAR(100),
      nazwisko VARCHAR(100),
      firma VARCHAR(200),
      telefon VARCHAR(30),
      email VARCHAR(255),
      adres VARCHAR(255),
      miasto VARCHAR(100),
      kod_pocztowy VARCHAR(10),
      notatki TEXT,
      zrodlo VARCHAR(50) DEFAULT 'telefon',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ogledziny (
      id SERIAL PRIMARY KEY,
      klient_id INTEGER REFERENCES klienci(id) ON DELETE SET NULL,
      brygadzista_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      data_planowana TIMESTAMP,
      status VARCHAR(30) DEFAULT 'Zaplanowane',
      adres VARCHAR(255),
      miasto VARCHAR(100),
      notatki TEXT,
      notatki_wyniki TEXT,
      wycena_id INTEGER REFERENCES wyceny(id) ON DELETE SET NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ogledziny_status ON ogledziny(status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ogledziny_data ON ogledziny(data_planowana)');
}

async function ensureVoiceAgentIntegrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_agent_integrations (
      id SERIAL PRIMARY KEY,
      agent_id VARCHAR(80) NOT NULL DEFAULT 'polska-flora-ania',
      oddzial_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      provider VARCHAR(40) NOT NULL DEFAULT 'external',
      provider_account_id VARCHAR(120),
      provider_api_key_masked VARCHAR(80),
      webhook_secret VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      last_test_at TIMESTAMPTZ,
      last_test_status VARCHAR(20),
      last_error TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(agent_id, oddzial_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_voice_agent_integrations_branch ON voice_agent_integrations(oddzial_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_voice_agent_integrations_secret ON voice_agent_integrations(webhook_secret)');
}

async function resolveVoiceAgentBranch(oddzialId) {
  await pool.query('ALTER TABLE branches ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(64)');
  if (Number(oddzialId) > 0) {
    const { rows } = await pool.query(
      'SELECT id, nazwa, miasto, telefon, sms_sender_id FROM branches WHERE id = $1',
      [Number(oddzialId)],
    );
    return rows[0] || null;
  }
  const { rows } = await pool.query(
    'SELECT id, nazwa, miasto, telefon, sms_sender_id FROM branches WHERE COALESCE(aktywny, true) ORDER BY id LIMIT 1',
  );
  return rows[0] || null;
}

function publicVoiceAgentWebhookUrl() {
  const base = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const path = '/api/telephony/voice-agent/polska-flora/intake';
  return base ? `${base}${path}` : path;
}

function generateWebhookSecret() {
  return `vf_${crypto.randomBytes(24).toString('hex')}`;
}

function maskProviderKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const suffix = raw.slice(-4);
  return `****${suffix}`;
}

function publicIntegration(row, { includeSecret = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    agent_id: row.agent_id,
    oddzial_id: row.oddzial_id,
    provider: row.provider,
    provider_account_id: row.provider_account_id,
    provider_api_key_masked: row.provider_api_key_masked,
    status: row.status,
    webhook_url: publicVoiceAgentWebhookUrl(),
    webhook_secret: includeSecret ? row.webhook_secret : undefined,
    last_test_at: row.last_test_at,
    last_test_status: row.last_test_status,
    last_error: row.last_error,
    updated_at: row.updated_at,
  };
}

async function listStaleVoiceAgentBranches({ user, maxAgeDays = DEFAULT_RETEST_MAX_AGE_DAYS } = {}) {
  await ensureVoiceAgentIntegrationsTable();
  await ensureIntegrationTestLogsTable(pool);
  await pool.query('ALTER TABLE branches ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(64)');
  const params = [Number(maxAgeDays)];
  const branchScope = isManagementRole(user)
    ? ''
    : 'AND b.id = $2';
  if (!isManagementRole(user)) params.push(Number(user?.oddzial_id || 0));
  const { rows } = await pool.query(
    `WITH latest_ok_logs AS (
       SELECT DISTINCT ON (oddzial_id)
         oddzial_id,
         integration_type,
         action,
         provider,
         target,
         created_at
       FROM integration_test_logs
       WHERE status = 'ok'
       ORDER BY oddzial_id, created_at DESC
     )
     SELECT
       b.id AS oddzial_id,
       b.nazwa AS oddzial_name,
       b.miasto,
       b.telefon,
       b.sms_sender_id,
       i.id AS integration_id,
       i.provider,
       i.provider_account_id,
       l.created_at AS last_ok_test_at,
       FLOOR(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400)::int AS age_days
     FROM branches b
     JOIN voice_agent_integrations i
       ON i.agent_id = 'polska-flora-ania'
      AND i.oddzial_id = b.id
      AND i.status = 'active'
     JOIN latest_ok_logs l ON l.oddzial_id = b.id
     WHERE COALESCE(b.aktywny, true)
       AND l.created_at < NOW() - ($1::int * INTERVAL '1 day')
       ${branchScope}
     ORDER BY l.created_at ASC, b.nazwa NULLS LAST, b.id`,
    params,
  );
  return rows;
}

async function findVoiceAgentIntegration({ oddzialId, secret } = {}) {
  await ensureVoiceAgentIntegrationsTable();
  if (secret) {
    const { rows } = await pool.query(
      `SELECT *
       FROM voice_agent_integrations
       WHERE agent_id = 'polska-flora-ania' AND webhook_secret = $1 AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [secret],
    );
    return rows[0] || null;
  }
  if (Number(oddzialId) > 0) {
    const { rows } = await pool.query(
      `SELECT *
       FROM voice_agent_integrations
       WHERE agent_id = 'polska-flora-ania' AND oddzial_id = $1
       LIMIT 1`,
      [Number(oddzialId)],
    );
    return rows[0] || null;
  }
  return null;
}

async function requireVoiceAgentSecret(req, res, next) {
  const configured = String(env.VOICE_AGENT_WEBHOOK_SECRET || '').trim();
  const provided = String(req.get('x-voice-agent-secret') || req.body?.secret || '').trim();
  if (!provided) {
    return res.status(401).json({ error: 'Brak sekretu agenta glosowego' });
  }
  if (configured && provided === configured) {
    return next();
  }
  try {
    const integration = await findVoiceAgentIntegration({ secret: provided });
    if (!integration) return res.status(401).json({ error: 'Nieprawidlowy sekret agenta glosowego' });
    req.voiceAgentIntegration = integration;
    if (!req.body.oddzial_id) req.body.oddzial_id = integration.oddzial_id;
    return next();
  } catch (err) {
    logger.error('telephony.voiceAgent.secret', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
}

function voiceAgentLeadTitle(body, serviceType) {
  const name = String(body.customer_name || '').trim() || 'Klient telefoniczny';
  return `${name} - ${SERVICE_LABELS[serviceType] || 'Ogledziny'}`.slice(0, 255);
}

function normalizeVoiceAgentProvider(value) {
  return String(value || 'external').trim().toLowerCase().slice(0, 40) || 'external';
}

function voiceAgentIntakeResponse(row, { duplicate = false, callLogId = null, stage = null, nextActionAt = null } = {}) {
  return {
    ok: true,
    duplicate,
    agent_id: row?.agent_id || 'polska-flora-ania',
    oddzial_id: row?.oddzial_id || null,
    crm_lead_id: row?.crm_lead_id || null,
    klient_id: row?.klient_id || null,
    ogledziny_id: row?.ogledziny_id || null,
    call_log_id: callLogId,
    intake_id: row?.id || null,
    stage: stage || row?.stage || null,
    next_action_at: nextActionAt || row?.next_action_at || null,
  };
}

function voiceAgentQuality(row) {
  const issues = [];
  if (!row?.caller_phone) issues.push('brak_telefonu');
  if (!row?.inspection_address) issues.push('brak_adresu');
  if (!row?.appointment_at) issues.push('brak_terminu');
  if (!row?.crm_lead_id) issues.push('brak_leada_crm');
  if (row?.appointment_at && !row?.ogledziny_id) issues.push('brak_ogledzin');
  if (!row?.notes && !row?.transcript) issues.push('brak_notatki');
  return {
    quality_status: issues.length ? 'needs_review' : 'ok',
    quality_issues: issues,
  };
}

function enrichVoiceAgentIntake(row) {
  if (!row) return null;
  const raw = row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
    ? row.raw_payload
    : {};
  return {
    ...row,
    ...voiceAgentQuality(row),
    sms_status: {
      confirmation_at: raw.last_sms_confirmation_at || null,
      confirmation_id: raw.last_sms_confirmation_id || null,
      confirmation_error: raw.last_sms_confirmation_error || null,
      reminder_at: raw.last_sms_reminder_at || null,
      reminder_for: raw.last_sms_reminder_for || null,
      reminder_id: raw.last_sms_reminder_id || null,
      reminder_error: raw.last_sms_reminder_error || null,
      reminder_attempt_at: raw.last_sms_reminder_attempt_at || null,
    },
  };
}

async function findExistingVoiceAgentIntake({ provider, externalId, callSid }) {
  if (!externalId && !callSid) return null;
  const { rows } = await pool.query(
    `SELECT v.*, l.client_id AS klient_id, l.stage, l.next_action_at
     FROM voice_agent_intakes v
     LEFT JOIN crm_leads l ON l.id = v.crm_lead_id
     WHERE v.agent_id = 'polska-flora-ania'
       AND v.provider = $1
       AND (($2::varchar IS NOT NULL AND v.external_id = $2)
         OR ($3::varchar IS NOT NULL AND v.call_sid = $3))
     ORDER BY v.created_at DESC
     LIMIT 1`,
    [provider, externalId || null, callSid || null],
  );
  return rows[0] || null;
}

async function findVoiceAgentIntakeById(id) {
  const { rows } = await pool.query(
    `SELECT v.*, l.client_id AS klient_id, l.stage, l.next_action_at, o.status AS ogledziny_status
     FROM voice_agent_intakes v
     LEFT JOIN crm_leads l ON l.id = v.crm_lead_id
     LEFT JOIN ogledziny o ON o.id = v.ogledziny_id
     WHERE v.agent_id = 'polska-flora-ania' AND v.id = $1
     LIMIT 1`,
    [Number(id)],
  );
  return rows[0] || null;
}

async function reserveVoiceAgentIntake({ body, branch, provider, serviceType, appointmentAt, inspectionAddress }) {
  const externalId = body.external_id || null;
  const callSid = body.call_sid || null;
  if (!externalId && !callSid) return { row: null, duplicate: false };

  const { rows } = await pool.query(
    `INSERT INTO voice_agent_intakes (
      provider, external_id, call_sid, oddzial_id, caller_phone, customer_name,
      inspection_address, city, service_type, appointment_at, source, notes, transcript, raw_payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING *`,
    [
      provider,
      externalId,
      callSid,
      branch.id,
      body.caller_phone,
      body.customer_name || null,
      inspectionAddress,
      body.city || null,
      serviceType,
      appointmentAt,
      body.source || 'telefon_przychodzacy',
      body.notes || null,
      body.transcript || null,
      JSON.stringify({ ...body, secret: undefined }),
    ],
  );
  if (rows[0]) return { row: rows[0], duplicate: false };
  return { row: await findExistingVoiceAgentIntake({ provider, externalId, callSid }), duplicate: true };
}

function parseAppointment(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatPolskaFloraSmsDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildVoiceAgentSmsConfirmation(row) {
  const when = formatPolskaFloraSmsDate(row?.appointment_at);
  const address = [row?.inspection_address, row?.city].filter(Boolean).join(', ');
  const parts = ['Dzien dobry, potwierdzamy bezplatne ogledziny Polska Flora'];
  if (when) parts.push(`termin: ${when}`);
  if (address) parts.push(`adres: ${address}`);
  return `${parts.join(', ')}. W razie pytan prosimy o kontakt.`;
}

function splitCustomerName(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return { imie: null, nazwisko: null, firma: null };
  const parts = raw.split(' ');
  if (parts.length === 1) return { imie: parts[0], nazwisko: null, firma: null };
  return { imie: parts[0], nazwisko: parts.slice(1).join(' '), firma: null };
}

async function ensureVoiceAgentClient({ customerName, phone, address, city }) {
  await ensureVoiceAgentInspectionTables();
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (normalizedPhone) {
    const existing = await pool.query(
      `SELECT id FROM klienci
       WHERE regexp_replace(COALESCE(telefon, ''), '\\D', '', 'g') = $1
       ORDER BY id DESC
       LIMIT 1`,
      [normalizedPhone],
    );
    if (existing.rows[0]?.id) {
      await pool.query(
        `UPDATE klienci
         SET imie = COALESCE(imie, $2),
             nazwisko = COALESCE(nazwisko, $3),
             firma = COALESCE(firma, $4),
             adres = COALESCE(NULLIF($5, ''), adres),
             miasto = COALESCE(NULLIF($6, ''), miasto),
             updated_at = NOW()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          splitCustomerName(customerName).imie,
          splitCustomerName(customerName).nazwisko,
          splitCustomerName(customerName).firma,
          address || '',
          city || '',
        ],
      );
      return existing.rows[0].id;
    }
  }

  const name = splitCustomerName(customerName);
  const { rows } = await pool.query(
    `INSERT INTO klienci (imie, nazwisko, firma, telefon, adres, miasto, zrodlo, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'voice_agent',NOW(),NOW())
     RETURNING id`,
    [name.imie, name.nazwisko, name.firma, phone || null, address || null, city || null],
  );
  return rows[0]?.id || null;
}

async function createVoiceAgentInspection({ clientId, appointmentAt, address, city, notes }) {
  if (!clientId || !appointmentAt) return null;
  await ensureVoiceAgentInspectionTables();
  const { rows } = await pool.query(
    `INSERT INTO ogledziny (
      klient_id, brygadzista_id, data_planowana, status, adres, miasto, notatki, created_by
    ) VALUES ($1,NULL,$2::timestamptz,'Zaplanowane',$3,$4,$5,NULL)
    RETURNING id`,
    [clientId, appointmentAt, address || null, city || null, notes || null],
  );
  return rows[0]?.id || null;
}

router.get('/voice-agent/polska-flora/config', authMiddleware, validateQuery(voiceAgentConfigQuerySchema), async (req, res) => {
  try {
    const requestedOddzialId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
    const oddzialId = isManagementRole(req.user) ? requestedOddzialId : (req.user?.oddzial_id || requestedOddzialId);
    if (!isManagementRole(req.user) && requestedOddzialId && Number(requestedOddzialId) !== Number(req.user?.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
    const branch = await resolveVoiceAgentBranch(oddzialId);
    return res.json(buildPolskaFloraVoiceAgentConfig({ oddzialId: branch?.id || oddzialId, branch }));
  } catch (err) {
    logger.error('telephony.voiceAgent.config', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get(
  '/voice-agent/polska-flora/integrations/status',
  authMiddleware,
  async (req, res) => {
    try {
      await pool.query('ALTER TABLE branches ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(64)');
      await ensureVoiceAgentIntegrationsTable();
      await ensureVoiceAgentIntakesTable();
      await ensureIntegrationTestLogsTable(pool);
      const params = [];
      const branchWhere = isManagementRole(req.user)
        ? 'WHERE COALESCE(b.aktywny, true)'
        : 'WHERE COALESCE(b.aktywny, true) AND b.id = $1';
      if (!isManagementRole(req.user)) params.push(Number(req.user?.oddzial_id || 0));
      const { rows } = await pool.query(
        `WITH latest_logs AS (
           SELECT DISTINCT ON (oddzial_id)
             oddzial_id, integration_type, action, status AS log_status, provider AS log_provider,
             target AS log_target, message AS log_message, error AS log_error, created_at AS log_created_at
           FROM integration_test_logs
           ORDER BY oddzial_id, created_at DESC
         ),
         intake_counts AS (
           SELECT
             oddzial_id,
             COUNT(*)::int AS intakes_total,
             COUNT(*) FILTER (WHERE (
               COALESCE(caller_phone, '') = ''
               OR COALESCE(inspection_address, '') = ''
               OR appointment_at IS NULL
               OR crm_lead_id IS NULL
               OR (appointment_at IS NOT NULL AND ogledziny_id IS NULL)
               OR (COALESCE(notes, '') = '' AND COALESCE(transcript, '') = '')
             ))::int AS needs_review,
             COUNT(*) FILTER (WHERE (
               COALESCE(raw_payload, '{}'::jsonb)->>'last_sms_confirmation_error' IS NOT NULL
               OR COALESCE(raw_payload, '{}'::jsonb)->>'last_sms_reminder_error' IS NOT NULL
             ))::int AS sms_errors
           FROM voice_agent_intakes
           WHERE agent_id = 'polska-flora-ania'
           GROUP BY oddzial_id
         )
         SELECT
           b.id AS oddzial_id,
           b.nazwa AS oddzial_name,
           b.miasto,
           b.telefon,
           b.sms_sender_id,
           i.id AS integration_id,
           i.provider,
           i.provider_account_id,
           i.status AS integration_status,
           i.last_test_at,
           i.last_test_status,
           i.last_error,
           i.updated_at AS integration_updated_at,
           COALESCE(c.intakes_total, 0)::int AS intakes_total,
           COALESCE(c.needs_review, 0)::int AS needs_review,
           COALESCE(c.sms_errors, 0)::int AS sms_errors,
           l.integration_type AS last_test_type,
           l.action AS last_test_action,
           l.log_status AS last_test_log_status,
           l.log_provider AS last_test_provider,
           l.log_target AS last_test_target,
           l.log_message AS last_test_message,
           l.log_error AS last_test_error,
           l.log_created_at AS last_test_log_at
         FROM branches b
         LEFT JOIN voice_agent_integrations i
           ON i.agent_id = 'polska-flora-ania' AND i.oddzial_id = b.id
         LEFT JOIN intake_counts c ON c.oddzial_id = b.id
         LEFT JOIN latest_logs l ON l.oddzial_id = b.id
         ${branchWhere}
         ORDER BY b.nazwa NULLS LAST, b.id`,
        params,
      );
      return res.json({ items: rows, total: rows.length });
    } catch (err) {
      logger.error('telephony.voiceAgent.integrations.status', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.post(
  '/voice-agent/polska-flora/retests/notifications',
  authMiddleware,
  validateBody(voiceAgentRetestNotificationsSchema),
  async (req, res) => {
    try {
      if (!isManagementRole(req.user)) {
        return res.status(403).json({ error: req.t('errors.auth.forbidden') });
      }
      const maxAgeDays = Number(req.body.max_age_days || DEFAULT_RETEST_MAX_AGE_DAYS);
      const staleBranches = await listStaleVoiceAgentBranches({ user: req.user, maxAgeDays });
      const notifications = [];
      let recipientsTotal = 0;

      for (const branch of staleBranches) {
        const message = [
          `Retest telefonii wymagany: ${branch.oddzial_name || `Oddzial #${branch.oddzial_id}`}.`,
          `Ostatni test OK: ${branch.last_ok_test_at ? new Date(branch.last_ok_test_at).toISOString() : 'brak'}`,
          `Wiek testu: ${Number(branch.age_days || 0)} dni; limit: ${maxAgeDays} dni.`,
          'Wykonaj Test calosci oddzialu w panelu Telefonia.',
        ].join(' ');
        const recipientsResult = await pool.query(
          `SELECT id
             FROM users
            WHERE id <> $1
              AND rola IN ('Prezes', 'Dyrektor', 'Administrator', 'Kierownik')
              AND (
                rola IN ('Prezes', 'Dyrektor', 'Administrator')
                OR oddzial_id = $2
              )`,
          [req.user.id, branch.oddzial_id],
        );
        recipientsTotal += recipientsResult.rows.length;
        for (const recipient of recipientsResult.rows) {
          const inserted = await pool.query(
            `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
             SELECT $1, $2, NULL, 'Retest telefonii', $3, 'Nowe'
             WHERE NOT EXISTS (
               SELECT 1
                 FROM notifications n
                WHERE n.to_user_id = $2
                  AND n.typ = 'Retest telefonii'
                  AND n.status = 'Nowe'
                  AND n.tresc = $3
             )
             RETURNING id, to_user_id, typ, tresc, task_id, status, data_utworzenia`,
            [req.user.id, recipient.id, message],
          );
          if (inserted.rows[0]) notifications.push({
            ...inserted.rows[0],
            oddzial_id: branch.oddzial_id,
            oddzial_name: branch.oddzial_name,
          });
        }
      }

      for (const notification of notifications) {
        pushToUser(notification.to_user_id, {
          event: 'notification',
          notification,
          tab: 'telefonia',
        });
      }

      return res.json({
        ok: true,
        max_age_days: maxAgeDays,
        branches_total: staleBranches.length,
        recipients_total: recipientsTotal,
        notifications_created: notifications.length,
        duplicates_skipped: Math.max(0, recipientsTotal - notifications.length),
        branches: staleBranches,
      });
    } catch (err) {
      logger.error('telephony.voiceAgent.retests.notifications', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.get(
  '/voice-agent/polska-flora/integration',
  authMiddleware,
  validateQuery(voiceAgentIntegrationQuerySchema),
  async (req, res) => {
    try {
      const oddzialId = Number(req.query.oddzial_id);
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== oddzialId) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      const branch = await resolveVoiceAgentBranch(oddzialId);
      if (!branch?.id) return res.status(404).json({ error: 'Oddzial nie znaleziony' });
      const integration = await findVoiceAgentIntegration({ oddzialId });
      return res.json({
        branch,
        integration: publicIntegration(integration, { includeSecret: true }),
        config: buildPolskaFloraVoiceAgentConfig({ oddzialId: branch.id, branch }),
      });
    } catch (err) {
      logger.error('telephony.voiceAgent.integration.get', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.post(
  '/voice-agent/polska-flora/integration',
  authMiddleware,
  validateBody(voiceAgentIntegrationSaveSchema),
  async (req, res) => {
    try {
      const b = req.body;
      const oddzialId = Number(b.oddzial_id);
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== oddzialId) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      const branch = await resolveVoiceAgentBranch(oddzialId);
      if (!branch?.id) return res.status(404).json({ error: 'Oddzial nie znaleziony' });
      await ensureVoiceAgentIntegrationsTable();
      const existing = await findVoiceAgentIntegration({ oddzialId });
      const webhookSecret = existing?.webhook_secret || generateWebhookSecret();
      const maskedKey = b.provider_api_key ? maskProviderKey(b.provider_api_key) : existing?.provider_api_key_masked || null;
      const provider = String(b.provider || existing?.provider || 'external').trim().toLowerCase() || 'external';
      const status = b.status || existing?.status || 'active';
      const { rows } = await pool.query(
        `INSERT INTO voice_agent_integrations (
          agent_id, oddzial_id, provider, provider_account_id, provider_api_key_masked, webhook_secret,
          status, created_by, created_at, updated_by, updated_at
        ) VALUES ('polska-flora-ania',$1,$2,$3,$4,$5,$6,$7,NOW(),$7,NOW())
        ON CONFLICT (agent_id, oddzial_id)
        DO UPDATE SET
          provider = EXCLUDED.provider,
          provider_account_id = EXCLUDED.provider_account_id,
          provider_api_key_masked = COALESCE(EXCLUDED.provider_api_key_masked, voice_agent_integrations.provider_api_key_masked),
          webhook_secret = voice_agent_integrations.webhook_secret,
          status = EXCLUDED.status,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW(),
          last_error = NULL
        RETURNING *`,
        [
          branch.id,
          provider,
          b.provider_account_id || existing?.provider_account_id || null,
          maskedKey,
          webhookSecret,
          status,
          req.user.id,
        ],
      );
      const saved = rows[0];
      return res.status(existing ? 200 : 201).json({
        integration: publicIntegration(saved, { includeSecret: true }),
        config: buildPolskaFloraVoiceAgentConfig({ oddzialId: branch.id, branch }),
      });
    } catch (err) {
      logger.error('telephony.voiceAgent.integration.save', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.post(
  '/voice-agent/polska-flora/integration/test',
  authMiddleware,
  validateBody(voiceAgentIntegrationQuerySchema),
  async (req, res) => {
    try {
      const oddzialId = Number(req.body.oddzial_id);
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== oddzialId) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      const integration = await findVoiceAgentIntegration({ oddzialId });
      if (!integration) return res.status(404).json({ error: 'Najpierw wlacz agenta dla oddzialu' });
      const branch = await resolveVoiceAgentBranch(oddzialId);
      await pool.query(
        `UPDATE voice_agent_integrations
         SET last_test_at = NOW(), last_test_status = 'ok', last_error = NULL, updated_by = $2, updated_at = NOW()
         WHERE id = $1`,
        [integration.id, req.user.id],
      );
      await recordIntegrationTestLog(pool, {
        oddzialId,
        integrationType: 'voice_agent',
        action: 'webhook_config_test',
        status: 'ok',
        provider: integration.provider || null,
        target: integration.webhook_url || '/api/telephony/voice-agent/polska-flora/intake',
        message: 'Konfiguracja webhooka agenta jest gotowa',
        metadata: { agent_id: 'polska-flora-ania', integration_id: integration.id },
        createdBy: req.user.id,
      });
      return res.json({
        ok: true,
        message: 'Konfiguracja agenta jest gotowa do podpiecia u providera.',
        webhook_url: publicVoiceAgentWebhookUrl(),
        expected_header: 'x-voice-agent-secret',
        branch: branch ? { id: branch.id, name: branch.nazwa, phone: branch.telefon } : null,
      });
    } catch (err) {
      logger.error('telephony.voiceAgent.integration.test', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.get(
  '/integration-test-logs',
  authMiddleware,
  validateQuery(integrationTestLogsQuerySchema),
  async (req, res) => {
    try {
      const requestedOddzialId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
      const oddzialId = isManagementRole(req.user) ? requestedOddzialId : Number(req.user?.oddzial_id || 0);
      if (requestedOddzialId && !isManagementRole(req.user) && Number(req.user?.oddzial_id) !== requestedOddzialId) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      const items = await listIntegrationTestLogs(pool, {
        oddzialId,
        limit: req.query.limit || 20,
      });
      return res.json({ items, total: items.length });
    } catch (err) {
      logger.error('telephony.integrationTestLogs.list', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.get(
  '/voice-agent/polska-flora/intakes',
  authMiddleware,
  validateQuery(voiceAgentIntakesQuerySchema),
  async (req, res) => {
    try {
      await ensureVoiceAgentIntakesTable();
      const oddzialId = Number(req.query.oddzial_id);
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== oddzialId) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      const limit = Number(req.query.limit || 20);
      const offset = Number(req.query.offset || 0);
      const filter = req.query.filter || 'all';
      const q = String(req.query.q || '').trim();
      const params = [oddzialId];
      const baseWhereParts = [
        `v.agent_id = 'polska-flora-ania'`,
        `v.oddzial_id = $1`,
      ];
      const whereParts = [
        `v.agent_id = 'polska-flora-ania'`,
        `v.oddzial_id = $1`,
      ];
      if (filter === 'needs_review') {
        whereParts.push(`(
          COALESCE(v.caller_phone, '') = ''
          OR COALESCE(v.inspection_address, '') = ''
          OR v.appointment_at IS NULL
          OR v.crm_lead_id IS NULL
          OR (v.appointment_at IS NOT NULL AND v.ogledziny_id IS NULL)
          OR (COALESCE(v.notes, '') = '' AND COALESCE(v.transcript, '') = '')
        )`);
      } else if (filter === 'sms_missing') {
        whereParts.push(`(
          COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_confirmation_at' IS NULL
          AND COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_reminder_at' IS NULL
        )`);
      } else if (filter === 'sms_error') {
        whereParts.push(`(
          COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_confirmation_error' IS NOT NULL
          OR COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_reminder_error' IS NOT NULL
        )`);
      } else if (filter === 'scheduled') {
        whereParts.push('v.appointment_at IS NOT NULL');
      }
      if (q) {
        params.push(`%${q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
        const idx = params.length;
        const qWhere = `(
          COALESCE(v.customer_name, '') ILIKE $${idx} ESCAPE E'\\\\'
          OR COALESCE(v.caller_phone, '') ILIKE $${idx} ESCAPE E'\\\\'
          OR COALESCE(v.inspection_address, '') ILIKE $${idx} ESCAPE E'\\\\'
          OR COALESCE(v.city, '') ILIKE $${idx} ESCAPE E'\\\\'
          OR COALESCE(v.service_type, '') ILIKE $${idx} ESCAPE E'\\\\'
          OR COALESCE(v.notes, '') ILIKE $${idx} ESCAPE E'\\\\'
        )`;
        baseWhereParts.push(qWhere);
        whereParts.push(qWhere);
      }
      const needsReviewSql = `(
          COALESCE(v.caller_phone, '') = ''
          OR COALESCE(v.inspection_address, '') = ''
          OR v.appointment_at IS NULL
          OR v.crm_lead_id IS NULL
          OR (v.appointment_at IS NOT NULL AND v.ogledziny_id IS NULL)
          OR (COALESCE(v.notes, '') = '' AND COALESCE(v.transcript, '') = '')
        )`;
      const smsMissingSql = `(
          COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_confirmation_at' IS NULL
          AND COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_reminder_at' IS NULL
        )`;
      const smsErrorSql = `(
          COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_confirmation_error' IS NOT NULL
          OR COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_reminder_error' IS NOT NULL
        )`;
      const whereSql = `WHERE ${whereParts.join(' AND ')}`;
      const baseWhereSql = `WHERE ${baseWhereParts.join(' AND ')}`;
      const fromSql = `FROM voice_agent_intakes v
         LEFT JOIN crm_leads l ON l.id = v.crm_lead_id
         LEFT JOIN ogledziny o ON o.id = v.ogledziny_id`;
      const summaryResult = await pool.query(
        `SELECT
           COUNT(*)::int AS all_count,
           COUNT(*) FILTER (WHERE ${needsReviewSql})::int AS needs_review,
           COUNT(*) FILTER (WHERE ${smsMissingSql})::int AS sms_missing,
           COUNT(*) FILTER (WHERE ${smsErrorSql})::int AS sms_error,
           COUNT(*) FILTER (WHERE v.appointment_at IS NOT NULL)::int AS scheduled
         ${fromSql}
         ${baseWhereSql}`,
        params,
      );
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total
         ${fromSql}
         ${whereSql}`,
        params,
      );
      const rowsResult = await pool.query(
        `SELECT
           v.id,
           v.provider,
           v.external_id,
           v.call_sid,
           v.oddzial_id,
           v.crm_lead_id,
           v.ogledziny_id,
           l.client_id AS klient_id,
           v.caller_phone,
           v.customer_name,
           v.inspection_address,
           v.city,
           v.service_type,
           v.appointment_at,
           v.source,
           v.notes,
           v.transcript,
           v.raw_payload,
           v.created_at,
           l.stage AS crm_stage,
           o.status AS ogledziny_status
         ${fromSql}
         ${whereSql}
         ORDER BY v.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return res.json({
        items: rowsResult.rows.map(enrichVoiceAgentIntake),
        total: countResult.rows[0]?.total || 0,
        summary: {
          all: Number(summaryResult.rows[0]?.all_count || 0),
          needs_review: Number(summaryResult.rows[0]?.needs_review || 0),
          sms_missing: Number(summaryResult.rows[0]?.sms_missing || 0),
          sms_error: Number(summaryResult.rows[0]?.sms_error || 0),
          scheduled: Number(summaryResult.rows[0]?.scheduled || 0),
        },
        limit,
        offset,
        filter,
      });
    } catch (err) {
      logger.error('telephony.voiceAgent.intakes.list', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.patch(
  '/voice-agent/polska-flora/intakes/:id',
  authMiddleware,
  validateParams(voiceAgentIntakeParamsSchema),
  validateBody(voiceAgentIntakeFixSchema),
  async (req, res) => {
    try {
      await ensureTelephonyTables();
      await ensureVoiceAgentIntakesTable();
      const existing = await findVoiceAgentIntakeById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Rozmowa agenta nie znaleziona' });
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(existing.oddzial_id)) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }

      const b = req.body;
      const merged = {
        ...existing,
        caller_phone: b.caller_phone !== undefined ? b.caller_phone : existing.caller_phone,
        customer_name: b.customer_name !== undefined ? b.customer_name : existing.customer_name,
        inspection_address: b.inspection_address !== undefined ? b.inspection_address : existing.inspection_address,
        city: b.city !== undefined ? b.city : existing.city,
        service_type: b.service_type !== undefined ? normalizePolskaFloraServiceType(b.service_type) : existing.service_type,
        appointment_at: b.appointment_at !== undefined ? parseAppointment(b.appointment_at) : existing.appointment_at,
        notes: b.notes !== undefined ? b.notes : existing.notes,
        transcript: b.transcript !== undefined ? b.transcript : existing.transcript,
      };

      const notes = buildPolskaFloraLeadNotes({
        customer_name: merged.customer_name,
        caller_phone: merged.caller_phone,
        service_type: merged.service_type,
        inspection_address: merged.inspection_address,
        city: merged.city,
        appointment_at: merged.appointment_at,
        source: merged.source,
        notes: merged.notes,
        transcript: merged.transcript,
      });
      const clientId = merged.klient_id || await ensureVoiceAgentClient({
        customerName: merged.customer_name,
        phone: merged.caller_phone,
        address: merged.inspection_address,
        city: merged.city,
      });

      let crmLeadId = merged.crm_lead_id;
      if (crmLeadId) {
        await pool.query(
          `UPDATE crm_leads
           SET title = $2,
               phone = COALESCE(NULLIF($3, ''), phone),
               notes = $4,
               stage = CASE WHEN $5::timestamptz IS NOT NULL THEN 'Oględziny' ELSE stage END,
               next_action_at = COALESCE($5::timestamptz, next_action_at),
               client_id = COALESCE($6, client_id),
               updated_by = $7,
               updated_at = NOW()
           WHERE id = $1`,
          [
            crmLeadId,
            voiceAgentLeadTitle(merged, merged.service_type),
            merged.caller_phone || '',
            notes,
            merged.appointment_at,
            clientId,
            req.user.id,
          ],
        );
      } else {
        const leadResult = await pool.query(
          `INSERT INTO crm_leads (
            title, oddzial_id, owner_user_id, stage, source, value, phone, notes, tags, next_action_at,
            client_id, created_by, created_at, updated_by, updated_at
          ) VALUES ($1,$2,NULL,$3,'voice_agent',0,$4,$5,$6::jsonb,$7,$8,$9,NOW(),$9,NOW())
          RETURNING id`,
          [
            voiceAgentLeadTitle(merged, merged.service_type),
            existing.oddzial_id,
            merged.appointment_at ? 'Oględziny' : 'Lead',
            merged.caller_phone || null,
            notes,
            JSON.stringify(['voice-agent', 'polska-flora', merged.service_type]),
            merged.appointment_at,
            clientId,
            req.user.id,
          ],
        );
        crmLeadId = leadResult.rows[0]?.id || null;
      }

      let ogledzinyId = merged.ogledziny_id;
      if (b.create_missing_inspection && !ogledzinyId && merged.appointment_at) {
        ogledzinyId = await createVoiceAgentInspection({
          clientId,
          appointmentAt: merged.appointment_at,
          address: merged.inspection_address,
          city: merged.city,
          notes,
        });
      }

      await pool.query(
        `UPDATE voice_agent_intakes
         SET crm_lead_id = $2,
             ogledziny_id = $3,
             caller_phone = $4,
             customer_name = $5,
             inspection_address = $6,
             city = $7,
             service_type = $8,
             appointment_at = $9,
             notes = $10,
             transcript = $11,
             raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $12::jsonb
         WHERE id = $1`,
        [
          existing.id,
          crmLeadId,
          ogledzinyId,
          merged.caller_phone || null,
          merged.customer_name || null,
          merged.inspection_address || null,
          merged.city || null,
          merged.service_type || null,
          merged.appointment_at || null,
          merged.notes || null,
          merged.transcript || null,
          JSON.stringify({ manual_fix_at: new Date().toISOString(), manual_fix_by: req.user.id }),
        ],
      );

      const saved = await findVoiceAgentIntakeById(existing.id);
      return res.json({ ok: true, intake: enrichVoiceAgentIntake({ ...saved, klient_id: saved?.klient_id || clientId }) });
    } catch (err) {
      logger.error('telephony.voiceAgent.intakes.fix', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.post(
  '/voice-agent/polska-flora/intakes/:id/sms',
  authMiddleware,
  validateParams(voiceAgentIntakeParamsSchema),
  validateBody(voiceAgentIntakeSmsSchema),
  async (req, res) => {
    try {
      await ensureVoiceAgentIntakesTable();
      const intake = await findVoiceAgentIntakeById(req.params.id);
      if (!intake) return res.status(404).json({ error: 'Rozmowa agenta nie znaleziona' });
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(intake.oddzial_id)) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      if (!intake.caller_phone) {
        return res.status(400).json({ error: 'Brak numeru telefonu klienta.' });
      }
      if (!intake.appointment_at) {
        return res.status(400).json({ error: 'Brak terminu ogledzin do potwierdzenia.' });
      }

      const body = (req.body.body || buildVoiceAgentSmsConfirmation(intake)).trim().slice(0, 480);
      const smsResult = await sendSmsGateway({
        to: intake.caller_phone,
        body,
        oddzialId: intake.oddzial_id,
      });
      const messageId = smsResult.sid || smsResult.id || smsResult.external_id || null;
      if (!smsResult.ok) {
        await pool.query(
          `UPDATE voice_agent_intakes
           SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $2::jsonb
           WHERE id = $1`,
          [
            intake.id,
            JSON.stringify({
              last_sms_confirmation_at: new Date().toISOString(),
              last_sms_confirmation_error: smsResult.error || 'sms_failed',
            }),
          ],
        );
        return res.status(502).json({ error: smsResult.error || 'Nie udalo sie wyslac SMS.' });
      }

      if (intake.crm_lead_id) {
        await appendCrmLeadMessage({
          leadId: intake.crm_lead_id,
          channel: 'sms',
          direction: 'outbound',
          recipientHandle: intake.caller_phone,
          subject: 'Potwierdzenie ogledzin SMS',
          body,
          status: 'sent',
          externalMessageId: messageId,
          templateKey: 'polska_flora_ogledziny_confirmation',
          metadata: {
            source: 'voice_agent.sms_confirmation',
            intake_id: intake.id,
            ogledziny_id: intake.ogledziny_id || null,
            provider: smsResult.provider || null,
          },
          createdBy: req.user.id,
        });
      }

      await pool.query(
        `UPDATE voice_agent_intakes
         SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [
          intake.id,
          JSON.stringify({
            last_sms_confirmation_at: new Date().toISOString(),
            last_sms_confirmation_id: messageId,
          }),
        ],
      );

      return res.json({
        ok: true,
        provider: smsResult.provider || null,
        sid: messageId,
        text: body,
      });
    } catch (err) {
      logger.error('telephony.voiceAgent.intakes.sms', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.post(
  '/voice-agent/polska-flora/intake',
  requireVoiceAgentSecret,
  validateBody(voiceAgentIntakeSchema),
  async (req, res) => {
    try {
      await ensureTelephonyTables();
      await ensureVoiceAgentInspectionTables();
      await ensureVoiceAgentIntakesTable();
      const b = req.body;
      const branch = await resolveVoiceAgentBranch(b.oddzial_id);
      if (!branch?.id) return res.status(400).json({ error: 'Nie znaleziono oddzialu dla agenta glosowego' });

      const serviceType = normalizePolskaFloraServiceType(b.service_type);
      const appointmentAt = parseAppointment(b.appointment_at);
      const inspectionAddress = String(b.inspection_address || b.address || '').trim() || null;
      const provider = normalizeVoiceAgentProvider(b.provider);
      const reservation = await reserveVoiceAgentIntake({
        body: b,
        branch,
        provider,
        serviceType,
        appointmentAt,
        inspectionAddress,
      });
      if (reservation.duplicate) {
        return res.status(200).json(voiceAgentIntakeResponse(reservation.row, { duplicate: true }));
      }
      const notes = buildPolskaFloraLeadNotes({
        ...b,
        service_type: serviceType,
        inspection_address: inspectionAddress,
        appointment_at: appointmentAt || b.appointment_at || null,
      });
      const title = voiceAgentLeadTitle(b, serviceType);
      const clientId = await ensureVoiceAgentClient({
        customerName: b.customer_name,
        phone: b.caller_phone,
        address: inspectionAddress,
        city: b.city,
      });
      const ogledzinyId = await createVoiceAgentInspection({
        clientId,
        appointmentAt,
        address: inspectionAddress,
        city: b.city,
        notes,
      });

      const leadResult = await pool.query(
        `INSERT INTO crm_leads (
          title, oddzial_id, owner_user_id, stage, source, value, phone, notes, tags, next_action_at,
          client_id, created_by, created_at, updated_by, updated_at
        ) VALUES ($1,$2,NULL,$3,$4,0,$5,$6,$7::jsonb,$8,$9,NULL,NOW(),NULL,NOW())
        RETURNING *`,
        [
          title,
          branch.id,
          appointmentAt ? 'Oględziny' : 'Lead',
          'voice_agent',
          b.caller_phone,
          notes,
          JSON.stringify(['voice-agent', 'polska-flora', serviceType]),
          appointmentAt,
          clientId,
        ],
      );
      const lead = leadResult.rows[0];

      await appendCrmLeadMessage({
        leadId: lead.id,
        channel: 'phone',
        direction: 'inbound',
        senderName: b.customer_name || null,
        senderHandle: b.caller_phone,
        subject: 'Rozmowa z agentem glosowym Ania',
        body: notes,
        status: 'received',
        externalMessageId: b.external_id || b.call_sid || null,
        templateKey: 'polska_flora_voice_agent',
        metadata: {
          source: 'voice_agent.polska_flora',
          agent_id: 'polska-flora-ania',
          call_sid: b.call_sid || null,
          service_type: serviceType,
          appointment_at: appointmentAt,
          ogledziny_id: ogledzinyId,
        },
      });

      const callLogResult = await pool.query(
        `INSERT INTO telephony_call_logs (
          oddzial_id, phone, call_type, status, duration_sec, task_id, lead_name, notes, created_by
        ) VALUES ($1,$2,'inbound','answered',0,NULL,$3,$4,NULL)
        RETURNING *`,
        [branch.id, b.caller_phone, b.customer_name || null, notes],
      );

      const intakeResult = await pool.query(
        reservation.row?.id
          ? `UPDATE voice_agent_intakes
             SET crm_lead_id = $2,
                 ogledziny_id = $3,
                 caller_phone = $4,
                 customer_name = $5,
                 inspection_address = $6,
                 city = $7,
                 service_type = $8,
                 appointment_at = $9,
                 source = $10,
                 notes = $11,
                 transcript = $12,
                 raw_payload = $13::jsonb
             WHERE id = $1
             RETURNING *`
          : `INSERT INTO voice_agent_intakes (
              provider, external_id, call_sid, oddzial_id, crm_lead_id, ogledziny_id, caller_phone, customer_name,
              inspection_address, city, service_type, appointment_at, source, notes, transcript, raw_payload
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
        RETURNING *`,
        reservation.row?.id
          ? [
              reservation.row.id,
              lead.id,
              ogledzinyId,
              b.caller_phone,
              b.customer_name || null,
              inspectionAddress,
              b.city || null,
              serviceType,
              appointmentAt,
              b.source || 'telefon_przychodzacy',
              b.notes || null,
              b.transcript || null,
              JSON.stringify({ ...b, secret: undefined }),
            ]
          : [
              provider,
              b.external_id || null,
              b.call_sid || null,
              branch.id,
              lead.id,
              ogledzinyId,
              b.caller_phone,
              b.customer_name || null,
              inspectionAddress,
              b.city || null,
              serviceType,
              appointmentAt,
              b.source || 'telefon_przychodzacy',
              b.notes || null,
              b.transcript || null,
              JSON.stringify({ ...b, secret: undefined }),
            ],
      );

      return res.status(201).json(voiceAgentIntakeResponse(
        {
          ...intakeResult.rows[0],
          klient_id: clientId,
          crm_lead_id: lead.id,
          ogledziny_id: ogledzinyId,
          oddzial_id: branch.id,
        },
        {
          callLogId: callLogResult.rows[0]?.id || null,
          stage: lead.stage,
          nextActionAt: lead.next_action_at,
        },
      ));
    } catch (err) {
      logger.error('telephony.voiceAgent.intake', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

router.get('/calls', authMiddleware, validateQuery(callsListQuerySchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const oddzialId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
    const statusFilter = String(req.query.status || '').trim();
    const { where, params } = telephonyScope(req.user, oddzialId);
    const statusSql = statusFilter ? `${where ? `${where} AND` : 'WHERE'} x.status = $${params.length + 1}` : where;
    const statusParams = statusFilter ? [...params, statusFilter] : params;

    const rowsResult = await pool.query(
      `
      SELECT * FROM (
        SELECT
          c.id,
          c.oddzial_id,
          c.phone,
          c.call_type,
          c.status,
          c.duration_sec,
          c.task_id,
          NULL::integer AS lead_id,
          c.lead_name,
          c.notes,
          c.created_by,
          c.created_at,
          'manual'::text AS source
        FROM telephony_call_logs c
        UNION ALL
        SELECT
          -p.id AS id,
          COALESCE(t.oddzial_id, u.oddzial_id) AS oddzial_id,
          p.client_number AS phone,
          'outbound'::text AS call_type,
          COALESCE(p.status, 'unknown') AS status,
          COALESCE(p.recording_duration_sec, 0) AS duration_sec,
          p.task_id,
          p.lead_id,
          COALESCE(l.title, NULL)::text AS lead_name,
          COALESCE(p.raport, p.error_message) AS notes,
          p.user_id AS created_by,
          p.created_at,
          'system'::text AS source
        FROM phone_call_conversations p
        LEFT JOIN tasks t ON t.id = p.task_id
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN crm_leads l ON l.id = p.lead_id
      ) x
      ${statusSql}
      ORDER BY x.created_at DESC
      `,
      statusParams,
    );
    const rows = rowsResult.rows;
    if (req.query.limit != null) {
      const lim = Number(req.query.limit);
      const off = Number(req.query.offset || 0);
      return res.json({ items: rows.slice(off, off + lim), total: rows.length, limit: lim, offset: off });
    }
    return res.json(rows);
  } catch (err) {
    logger.error('telephony.calls.list', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/calls', authMiddleware, validateBody(callCreateSchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const b = req.body;
    if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(b.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
    const { rows } = await pool.query(
      `
      INSERT INTO telephony_call_logs (
        oddzial_id, phone, call_type, status, duration_sec, task_id, lead_name, notes, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        b.oddzial_id,
        b.phone,
        b.call_type || 'outbound',
        b.status || 'answered',
        b.duration_sec || 0,
        b.task_id || null,
        b.lead_name || null,
        b.notes || null,
        req.user.id,
      ],
    );
    try {
      const row = rows[0];
      await appendCrmMessageForContact({
        oddzialId: row.oddzial_id,
        phone: row.phone,
        channel: 'phone',
        direction: row.call_type === 'inbound' ? 'inbound' : 'outbound',
        senderName: row.call_type === 'inbound' ? row.lead_name : null,
        senderHandle: row.call_type === 'inbound' ? row.phone : null,
        recipientHandle: row.call_type === 'inbound' ? null : row.phone,
        body: callMessageBody(row),
        status: callMessageStatus(row),
        externalMessageId: `telephony_call_${row.id}`,
        metadata: { source: 'telephony.call_log', call_log_id: row.id, task_id: row.task_id || null },
        createdBy: req.user.id,
      });
    } catch (crmErr) {
      logger.warn('telephony.crmInbox.call', { message: crmErr.message });
    }
    return res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('telephony.calls.create', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/callbacks', authMiddleware, validateQuery(callbacksListQuerySchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const oddzialId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
    const statusFilter = String(req.query.status || '').trim();
    const { where, params } = telephonyScopeSimple(req.user, oddzialId, 'c');
    const statusSql = statusFilter ? `${where ? `${where} AND` : 'WHERE'} c.status = $${params.length + 1}` : where;
    const statusParams = statusFilter ? [...params, statusFilter] : params;
    if (req.query.limit != null) {
      const lim = Number(req.query.limit);
      const off = Number(req.query.offset || 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM telephony_callbacks c ${statusSql}`, statusParams);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(
        `
        SELECT c.*
        FROM telephony_callbacks c
        ${statusSql}
        ORDER BY COALESCE(c.due_at, c.created_at) ASC
        LIMIT $${statusParams.length + 1} OFFSET $${statusParams.length + 2}
        `,
        [...statusParams, lim, off],
      );
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const { rows } = await pool.query(
      `
      SELECT c.*
      FROM telephony_callbacks c
      ${statusSql}
      ORDER BY COALESCE(c.due_at, c.created_at) ASC
      `,
      statusParams,
    );
    return res.json(rows);
  } catch (err) {
    logger.error('telephony.callbacks.list', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/callbacks', authMiddleware, validateBody(callbackCreateSchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const b = req.body;
    if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(b.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
    const { rows } = await pool.query(
      `
      INSERT INTO telephony_callbacks (
        oddzial_id, phone, task_id, lead_name, priority, due_at, status, notes, assigned_user_id, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9)
      RETURNING *
      `,
      [
        b.oddzial_id,
        b.phone,
        b.task_id || null,
        b.lead_name || null,
        b.priority || 'normal',
        b.due_at || null,
        b.notes || null,
        b.assigned_user_id || null,
        req.user.id,
      ],
    );
    try {
      const row = rows[0];
      await appendCrmMessageForContact({
        oddzialId: row.oddzial_id,
        phone: row.phone,
        channel: 'phone',
        direction: 'outbound',
        recipientHandle: row.phone,
        body: callbackMessageBody(row),
        status: 'queued',
        externalMessageId: `telephony_callback_${row.id}`,
        templateKey: 'callback',
        metadata: { source: 'telephony.callback', callback_id: row.id, task_id: row.task_id || null },
        createdBy: req.user.id,
      });
    } catch (crmErr) {
      logger.warn('telephony.crmInbox.callback', { message: crmErr.message });
    }
    return res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('telephony.callbacks.create', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.patch(
  '/callbacks/:id/status',
  authMiddleware,
  validateParams(callbackStatusParamsSchema),
  validateBody(callbackStatusBodySchema),
  async (req, res) => {
    try {
      await ensureTelephonyTables();
      const id = Number(req.params.id);
      const nextStatus = req.body.status;
      const currentR = await pool.query('SELECT * FROM telephony_callbacks WHERE id = $1', [id]);
      if (!currentR.rows.length) {
        return res.status(404).json({ error: 'Callback nie znaleziony' });
      }
      const current = currentR.rows[0];
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(current.oddzial_id)) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      const closedAt = nextStatus === 'done' || nextStatus === 'cancelled' ? new Date().toISOString() : null;
      const { rows } = await pool.query(
        `
        UPDATE telephony_callbacks
        SET status = $1, updated_by = $2, updated_at = NOW(), closed_at = $3
        WHERE id = $4
        RETURNING *
        `,
        [nextStatus, req.user.id, closedAt, id],
      );
      return res.json(rows[0]);
    } catch (err) {
      logger.error('telephony.callbacks.patch', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

module.exports = router;
