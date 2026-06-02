const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../config/logger');

const APP_TYPES = new Set(['webhook', 'widget', 'api']);

function normalizeAppType(value) {
  const type = String(value || '').trim().toLowerCase();
  return APP_TYPES.has(type) ? type : 'webhook';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function publicToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function ensureCrmIntegrationTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_integration_apps (
      id            SERIAL PRIMARY KEY,
      oddzial_id    INTEGER REFERENCES branches(id) ON DELETE CASCADE,
      name          VARCHAR(160) NOT NULL,
      type          VARCHAR(32) NOT NULL DEFAULT 'webhook',
      token         VARCHAR(96) NOT NULL UNIQUE,
      active        BOOLEAN NOT NULL DEFAULT true,
      config        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_apps_oddzial ON crm_integration_apps(oddzial_id, active)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_integration_events (
      id              SERIAL PRIMARY KEY,
      app_id          INTEGER REFERENCES crm_integration_apps(id) ON DELETE SET NULL,
      event_type      VARCHAR(80) NOT NULL,
      status          VARCHAR(32) NOT NULL,
      lead_id         INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
      external_id     VARCHAR(255),
      idempotency_key VARCHAR(255),
      payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE crm_integration_events ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_events_app_created ON crm_integration_events(app_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_events_external ON crm_integration_events(external_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_events_idempotency ON crm_integration_events(app_id, event_type, idempotency_key) WHERE idempotency_key IS NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_events_external_event ON crm_integration_events(app_id, event_type, external_id) WHERE external_id IS NOT NULL');
}

function mapApp(row, { includeToken = false } = {}) {
  return {
    id: row.id,
    oddzial_id: row.oddzial_id,
    name: row.name,
    type: normalizeAppType(row.type),
    active: row.active !== false,
    token: includeToken ? row.token : undefined,
    webhook_path: `/api/webhooks/crm/${row.token}`,
    config: row.config || {},
    event_count: Number(row.event_count || 0),
    last_event_at: row.last_event_at || null,
    last_event_status: row.last_event_status || null,
    last_event_type: row.last_event_type || null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

async function listIntegrationApps({ oddzialId = null, includeInactive = false } = {}) {
  await ensureCrmIntegrationTables();
  const params = [];
  const where = [];
  if (oddzialId) {
    params.push(oddzialId);
    where.push(`a.oddzial_id = $${params.length}`);
  }
  if (!includeInactive) where.push('a.active = true');
  const { rows } = await pool.query(
    `SELECT a.*,
            COALESCE(stats.event_count, 0)::int AS event_count,
            stats.last_event_at,
            last_event.status AS last_event_status,
            last_event.event_type AS last_event_type
     FROM crm_integration_apps a
     LEFT JOIN (
       SELECT app_id, COUNT(*) AS event_count, MAX(created_at) AS last_event_at
       FROM crm_integration_events
       GROUP BY app_id
     ) stats ON stats.app_id = a.id
     LEFT JOIN LATERAL (
       SELECT status, event_type
       FROM crm_integration_events e
       WHERE e.app_id = a.id
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 1
     ) last_event ON true
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.active DESC, a.updated_at DESC, a.id DESC`,
    params
  );
  return rows.map((row) => mapApp(row));
}

async function createIntegrationApp({ oddzialId, name, type, config, userId }) {
  await ensureCrmIntegrationTables();
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO crm_integration_apps (
      oddzial_id, name, type, token, active, config, created_by, created_at, updated_by, updated_at
    ) VALUES ($1,$2,$3,$4,true,$5::jsonb,$6,$7,$8,$9)
    RETURNING *`,
    [
      oddzialId || null,
      String(name || '').trim().slice(0, 160) || 'CRM integration',
      normalizeAppType(type),
      publicToken(),
      JSON.stringify(safeObject(config)),
      userId || null,
      now,
      userId || null,
      now,
    ]
  );
  return mapApp(rows[0], { includeToken: true });
}

async function getIntegrationAppById(id) {
  await ensureCrmIntegrationTables();
  const { rows } = await pool.query('SELECT * FROM crm_integration_apps WHERE id = $1', [id]);
  return rows[0] ? mapApp(rows[0]) : null;
}

async function updateIntegrationApp({ id, active, userId }) {
  await ensureCrmIntegrationTables();
  const { rows } = await pool.query(
    `UPDATE crm_integration_apps
     SET active = $2,
         updated_by = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, active, userId || null]
  );
  return rows[0] ? mapApp(rows[0]) : null;
}

async function listIntegrationEvents({ oddzialId = null, limit = 100 } = {}) {
  await ensureCrmIntegrationTables();
  const params = [];
  let where = '';
  if (oddzialId) {
    params.push(oddzialId);
    where = `WHERE a.oddzial_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  const { rows } = await pool.query(
    `SELECT e.*, a.name AS app_name, a.oddzial_id
     FROM crm_integration_events e
     LEFT JOIN crm_integration_apps a ON a.id = e.app_id
     ${where}
     ORDER BY e.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function logIntegrationEvent({
  appId,
  eventType,
  status,
  leadId = null,
  externalId = null,
  idempotencyKey = null,
  payload = {},
  error = null,
}) {
  await ensureCrmIntegrationTables();
  const { rows } = await pool.query(
    `INSERT INTO crm_integration_events (
       app_id, event_type, status, lead_id, external_id, idempotency_key, payload, error, created_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NOW())
     RETURNING *`,
    [
      appId || null,
      String(eventType || 'webhook.received').slice(0, 80),
      status,
      leadId,
      externalId,
      idempotencyKey,
      JSON.stringify(safeObject(payload)),
      error,
    ]
  );
  return rows[0];
}

async function findIdempotentIntegrationEvent({ appId, eventType, externalId = null, idempotencyKey = null }) {
  if (!externalId && !idempotencyKey) return null;
  const params = [appId, eventType];
  const checks = [];
  if (idempotencyKey) {
    params.push(idempotencyKey);
    checks.push(`idempotency_key = $${params.length}`);
  }
  if (externalId) {
    params.push(externalId);
    checks.push(`external_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT id, status, lead_id, external_id, idempotency_key, event_type
     FROM crm_integration_events
     WHERE app_id = $1
       AND event_type = $2
       AND (${checks.join(' OR ')})
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function ingestWebhook({ token, payload, idempotencyKey = null }) {
  await ensureCrmIntegrationTables();
  const app = (await pool.query('SELECT * FROM crm_integration_apps WHERE token = $1 AND active = true', [token])).rows[0];
  if (!app) return { status: 404, body: { error: 'integration not found' } };
  const body = safeObject(payload);
  const appConfig = safeObject(app.config);
  const headerIdempotencyKey = String(idempotencyKey || '').trim();
  const bodyIdempotencyKey = String(body.idempotency_key || body.idempotencyKey || '').trim();
  const stableIdempotencyKey = (headerIdempotencyKey || bodyIdempotencyKey).slice(0, 255) || null;
  const externalId = String(body.external_id || body.id || stableIdempotencyKey || '').trim().slice(0, 255) || null;
  const eventType = String(body.event_type || body.type || 'lead.created').trim().slice(0, 80);
  const channel = String(body.channel || appConfig.channel || 'webchat').trim().toLowerCase().slice(0, 32) || 'webchat';
  const source = String(body.source || appConfig.source || app.name || 'webhook').trim().slice(0, 50) || 'webhook';
  try {
    const previous = await findIdempotentIntegrationEvent({
      appId: app.id,
      eventType,
      externalId,
      idempotencyKey: stableIdempotencyKey,
    });
    if (previous?.status === 'ok') {
      return {
        status: 200,
        body: {
          ok: true,
          duplicate: true,
          idempotent_replay: true,
          lead_id: previous.lead_id || null,
          event_type: previous.event_type || eventType,
        },
      };
    }

    const leadTitle = String(body.title || body.name || body.client_name || '').trim();
    const messageText = String(body.message || body.body || '').trim();
    let leadId = Number(body.lead_id || 0) || null;

    if (!leadId && leadTitle) {
      const { rows } = await pool.query(
        `INSERT INTO crm_leads (
          title, oddzial_id, owner_user_id, stage, source, value, phone, email, notes, tags,
          created_at, updated_at
        ) VALUES ($1,$2,$3,'Lead',$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
        RETURNING id`,
        [
          leadTitle,
          app.oddzial_id,
          null,
          source,
          Number(body.value || 0) || 0,
          String(body.phone || '').trim() || null,
          String(body.email || '').trim() || null,
          String(body.notes || '').trim() || null,
          JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 16) : []),
        ]
      );
      leadId = rows[0]?.id || null;
    }

    if (leadId && messageText) {
      await pool.query(
        `INSERT INTO crm_lead_messages (
          lead_id, channel, direction, sender_name, sender_handle, body, status, external_message_id, metadata, created_at
        ) VALUES ($1,$2,'inbound',$3,$4,$5,'received',$6,$7::jsonb,NOW())`,
        [
          leadId,
          channel,
          String(body.sender_name || body.client_name || '').trim() || null,
          String(body.sender_handle || body.phone || body.email || '').trim() || null,
          messageText,
          externalId,
          JSON.stringify({ source: 'crm.integration.webhook', app_id: app.id }),
        ]
      );
      await pool.query('UPDATE crm_leads SET updated_at = NOW() WHERE id = $1', [leadId]);
    }

    await logIntegrationEvent({
      appId: app.id,
      eventType,
      status: 'ok',
      leadId,
      externalId,
      idempotencyKey: stableIdempotencyKey,
      payload: body,
    });
    return { status: 202, body: { ok: true, lead_id: leadId, event_type: eventType, idempotency_key: stableIdempotencyKey } };
  } catch (err) {
    logger.warn('crm.integrations.ingest', { message: err.message, app_id: app.id });
    await logIntegrationEvent({
      appId: app.id,
      eventType,
      status: 'error',
      externalId,
      idempotencyKey: stableIdempotencyKey,
      payload: body,
      error: err.message,
    });
    return { status: 500, body: { error: 'webhook processing failed' } };
  }
}

module.exports = {
  createIntegrationApp,
  ensureCrmIntegrationTables,
  getIntegrationAppById,
  ingestWebhook,
  listIntegrationApps,
  listIntegrationEvents,
  updateIntegrationApp,
};
